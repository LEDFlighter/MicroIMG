import os
import time
import logging
import threading
from waitress import serve
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from smartcard.System import readers
from smartcard.Exceptions import NoCardException, CardConnectionException
import smartcard.scard as scard

# Verzeichnis des aktuellen Skripts festlegen
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
from smartcard.System import readers
from smartcard.Exceptions import NoCardException, CardConnectionException

app = Flask(__name__)
CORS(app)  # Erlaubt Anfragen direkt aus deiner lokalen HTML-Datei (Cross-Origin)
last_printed_chunk = None
was_tag_present = False
waiting_reported = False
reader_lock = threading.Lock()
cancel_requested = False

def reset_nfc_hardware():
    """Erzwingt den Release des PC/SC Treibers nach einem abgebrochenen Transfer."""
    try:
        # Nur das Scope-Argument übergeben
        hresult, hcontext = scard.SCardEstablishContext(scard.SCARD_SCOPE_USER)
        if hresult == 0:
            scard.SCardReleaseContext(hcontext)
            print("🔄 PC/SC Treiber-Kontext erfolgreich zurückgesetzt.")
        else:
            print(f"⚠️ SCardEstablishContext Fehlercode: {hresult}")
    except Exception as e:
        print(f"⚠️ Hinweis beim Hardware-Reset: {e}")

@app.route('/cancel', methods=['POST'])
def handle_cancel():
    global cancel_requested, was_tag_present, last_printed_chunk
    cancel_requested = True
    
    # State zurücksetzen, damit der nächste Read als "neuer Tag" erkannt wird
    was_tag_present = False
    last_printed_chunk = None

    # Falls der Schreibvorgang eine aktive 'conn' hinterlassen hat, 
    # trennen wir sie hier mit Aufhebung der Feldspannung (UNPOWER)
    try:
        r_list = readers()
        if r_list:
            reader = r_list[0]
            conn = reader.createConnection()
            # Verbinden und direkt mit UNPOWER trennen, um das RF-Feld zu resetten
            conn.connect()
            conn.disconnect()
    except Exception as e:
        print(f"ℹ️ Hardware-Reset bei Abbruch: {e}")

    print("🛑 Schreibvorgang abgebrochen – Hardware zurückgesetzt.")
    return jsonify({"success": True, "message": "Schreibvorgang abgebrochen."})

def build_ndef_text_payload(text_string):
    """Baut eine NDEF Text Message auf.
    Unterstützt sowohl Short Records (<255 Bytes) als auch Long Records (>=255 Bytes).
    """
    payload_bytes = text_string.encode('utf-8')
    lang_code = b'en'
    status_byte = len(lang_code) & 0x3F  # UTF-8 + Lang-Length (2)
    
    # Record Body: Status + 'en' + Text-Daten
    record_payload = bytes([status_byte]) + lang_code + payload_bytes
    payload_len = len(record_payload)

    # NDEF Header (TNF=1 Well Known)
    if payload_len <= 255:
        # Short Record (SR Flag 0x10 gesetzt) -> Header: 0xD1, TypeLen: 1, PayloadLen: 1 Byte, Type: 'T' (0x54)
        ndef_record = bytes([0xD1, 0x01, payload_len, 0x54]) + record_payload
    else:
        # Long Record (SR Flag nicht gesetzt -> 0xC1) -> PayloadLen: 4 Bytes (Big-Endian)
        len_bytes = payload_len.to_bytes(4, byteorder='big')
        ndef_record = bytes([0xC1, 0x01]) + len_bytes + bytes([0x54]) + record_payload

    # TLV (Tag-Length-Value) Envelope
    ndef_len = len(ndef_record)
    if ndef_len <= 254:
        tlv_header = bytes([0x03, ndef_len])
    else:
        # Long TLV: Tag 0x03, 0xFF als Marker, dann 2 Bytes Länge
        tlv_header = bytes([0x03, 0xFF, (ndef_len >> 8) & 0xFF, ndef_len & 0xFF])

    # Terminator Tag 0xFE
    return tlv_header + ndef_record + bytes([0xFE])


def write_to_tag(connection, chunk_str):
    raw_bytes = build_ndef_text_payload(chunk_str)
    total_len = len(raw_bytes)

    # NTAG216 max Kapazität ab Page 4
    max_bytes = (223 - 4 + 1) * 4  # 880 Bytes
    if total_len > max_bytes:
        print(f"❌ Fehler: Chunk mit NDEF-Header ({total_len} Bytes) ist zu groß für NTAG216 (max {max_bytes} Bytes)!")
        return False

    # Auf 4-Byte Blöcke auffüllen
    padding = (4 - (total_len % 4)) % 4
    padded_bytes = raw_bytes + b'\x00' * padding
    
    pages_to_write = len(padded_bytes) // 4

    for i in range(pages_to_write):
        page = 4 + i
        page_data = list(padded_bytes[i * 4 : (i + 1) * 4])
        
        # Stelle sicher, dass alle Daten im Integertyp 0-255 für pyscard sind
        write_cmd = [0xFF, 0xD6, 0x00, page & 0xFF, 0x04] + [int(b) & 0xFF for b in page_data]
        
        data, sw1, sw2 = connection.transmit(write_cmd)
        if sw1 != 0x90:
            print(f"❌ Schreibfehler auf Page {page}: SW1={hex(sw1)} SW2={hex(sw2)}")
            return False

    return True

def read_text_from_tag(connection):
    """
    Liest die Pages ab Page 4 aus, extrahiert den NDEF Text Payload
    und stoppt beim Terminator-Byte 0xFE.
    """
    raw_data = bytearray()

    # --- QUICK CHECK ---
    # Wir versuchen zuerst NUR Page 4 zu lesen.
    # Wenn kein Tag auf dem Reader liegt, bricht das hier SOFORT ab (kein Blockieren).
    quick_cmd = [0xFF, 0xB0, 0x00, 0x04, 0x04]
    try:
        data, sw1, sw2 = connection.transmit(quick_cmd)
        if sw1 != 0x90:
            # Kein Tag vorhanden oder Lesefehler -> sofort beenden!
            return None
    except Exception:
        # Pyscard-Fehler (z.B. CardNotPresentException)
        return None

    # --- TAG GEFUNDEN -> JETZT LESEN ---
    # NTAG216 hat Pages von 4 bis 223
    for page in range(4, 224):
        read_cmd = [0xFF, 0xB0, 0x00, page, 0x04]
        try:
            data, sw1, sw2 = connection.transmit(read_cmd)
        except Exception as e:
            # Verbindung während des Lesens abgebrochen (Tag abgenommen)
            print(f"⚠️ Verbindung abgebrochen auf Page {page}: {e}")
            break

        if sw1 != 0x90:
            # Sobald SW1 nicht 0x90 ist, wurde der Tag wahrscheinlich während des Scans abgezogen
            print(f"❌ Lesefehler auf Page {page}: SW1={hex(sw1)} SW2={hex(sw2)}")
            break

        term_found = False
        for b in data:
            if b == 0xFE:  # NDEF Terminator Byte erreicht
                term_found = True
                break
            raw_data.append(b)

        if term_found:
            break

    if not raw_data:
        return None

    # --- NDEF EXTRAKTION ---
    try:
        raw_bytes = bytes(raw_data)

        # Suche nach dem Typ-Identifier 'T' (0x54) im NDEF Record
        t_index = raw_bytes.find(b'T')
        if t_index != -1 and t_index + 1 < len(raw_bytes):
            status_byte = raw_bytes[t_index + 1]
            lang_len = status_byte & 0x3F  # Länge des Sprachcodes (z. B. 2 für 'en')
            text_start = t_index + 2 + lang_len
            
            if text_start < len(raw_bytes):
                text_bytes = raw_bytes[text_start:]
                return text_bytes.decode('utf-8', errors='ignore')

        # Fallback: Versuche Rohdaten als UTF-8 zu dekodieren
        return raw_bytes.decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"❌ Fehler beim Dekodieren des NDEF-Texts: {e}")
        return None

# Neu: Route zum Ausliefern deiner HTML-Oberfläche
@app.route('/')
def index():
    # Passe den Dateinamen an, falls deine HTML-Datei anders heißt (z.B. index.html)
    html_path = os.path.join(BASE_DIR, 'nfctool25_latest_TagWrite_python_server.html')
    if os.path.exists(html_path):
        return send_file(html_path)
    return "❌ HTML-Datei nicht gefunden! Bitte Dateiname im Python-Skript prüfen.", 404
    
@app.route('/read-chunk', methods=['GET'])
def handle_read_chunk():
    global last_printed_chunk, was_tag_present, cancel_requested

    # 1. Abbruch-Flag zurücksetzen
    cancel_requested = False

    # 2. Hardware-Sperre holen (warten, bis der Reader frei ist)
    got_lock = reader_lock.acquire(blocking=True, timeout=1.0)
    if not got_lock:
        return jsonify({'success': False, 'error': 'Hardware beschäftigt'}), 200

    try:
        r_list = readers()
        if not r_list:
            was_tag_present = False
            last_printed_chunk = None
            return jsonify({'success': False, 'error': 'Kein Reader angeschlossen'}), 200

        reader = r_list[0]
        conn = None

        # 3. ENDLOSSCHLEIFE: Wartet unendlich lange, bis ein Tag erkannt wird
        while not cancel_requested:
            try:
                conn = reader.createConnection()
                conn.connect()
                # Verbindung erfolgreich -> Tag liegt auf!
                break
            except Exception:
                # Kein Tag auf dem Leser oder Verbindung fehlgeschlagen
                try:
                    conn.disconnect()
                except Exception:
                    pass
                time.sleep(0.2)  # Kurze Entlastung für die CPU (200ms)

        # Abfangen, falls während des Wartens abgebrochen wurde
        if cancel_requested or not conn:
            return jsonify({'success': False, 'error': 'Lesevorgang abgebrochen'}), 200

        # 4. Daten vom aufgelegten Tag einlesen
        chunk_text = read_text_from_tag(conn)

        if chunk_text:
            if not was_tag_present or last_printed_chunk != chunk_text:
                print('\n==================================================')
                print('🎴 Tag erkannt! Lese Daten...')
                print(f'✅ Erfolgreich gelesen! Vorschau: {chunk_text[:40]}...')
                print('==================================================')
                last_printed_chunk = chunk_text
                was_tag_present = True

            return jsonify({'success': True, 'data': chunk_text}), 200
        else:
            was_tag_present = True
            return jsonify({'success': False, 'error': 'Keine gültigen Daten auf dem Tag'}), 200

    except Exception as e:
        if was_tag_present:
            print(f'⚠️ Lesefehler: {e}')
            was_tag_present = False
            last_printed_chunk = None
        return jsonify({'success': False, 'error': str(e)}), 200

    finally:
        reader_lock.release()
        
@app.route('/check-tag', methods=['GET'])
def handle_check_tag():
    try:
        available_readers = readers()
        if not available_readers:
            return jsonify({'present': False}), 200

        reader = available_readers[0]
        conn = reader.createConnection()
        conn.connect()
        # Verbindung geklappt -> Tag liegt noch auf dem Leser!
        return jsonify({'present': True}), 200
    except Exception:
        # Keine Karte da oder gerade abgenommen
        return jsonify({'present': False}), 200

@app.route('/write-chunks', methods=['POST'])
def handle_write_chunks():
    global cancel_requested
    cancel_requested = False
    
    data = request.json
    chunks = data.get("chunks", [])

    if not chunks:
        return jsonify({"success": False, "error": "Keine Chunks übergeben"}), 400

    print(f"\n🚀 Empfange {len(chunks)} Chunk(s) zum Schreiben...")

    for idx, chunk_str in enumerate(chunks):
        if cancel_requested:
            print("🛑 Schreibvorgang durch Benutzer abgebrochen.")
            return jsonify({"success": False, "error": "Vorgang abgebrochen."}), 400

        print(f"\n==================================================")
        print(f"👉 CHUNK [{idx + 1}/{len(chunks)}]")
        print(f"   Vorschau: {chunk_str[:40]}...")
        print(f"==================================================")

        written = False
        waiting_reported = False

        while not written:
            if cancel_requested:
                print("🛑 Schreibvorgang durch Benutzer abgebrochen.")
                return jsonify({"success": False, "error": "Vorgang abgebrochen."}), 400

            got_lock = reader_lock.acquire(blocking=True, timeout=0.3)
            if not got_lock:
                continue

            conn = None
            try:
                available_readers = readers()
                if not available_readers:
                    if not waiting_reported:
                        print("⚠️ Kein NFC-Reader gefunden!")
                        waiting_reported = True
                    time.sleep(0.5)
                    continue

                reader = available_readers[0]
                conn = reader.createConnection()
                conn.connect()

                waiting_reported = False
                print("🎴 Tag erkannt!")

                if cancel_requested:
                    print("🛑 Schreibvorgang DIREKT vor Hardware-Zugriff gestoppt.")
                    return jsonify({"success": False, "error": "Vorgang abgebrochen."}), 400

                print("✍️ Schreibe auf den Tag...")
                if write_to_tag(conn, chunk_str):
                    
                    # --- 1. READ-AFTER-WRITE VERIFIZIERUNG ---
                    print("🔍 Verifiziere Daten auf dem Tag...")
                    read_back = read_text_from_tag(conn)

                    if read_back and read_back.strip() == chunk_str.strip():
                        print(f"✅ Chunk {idx + 1}/{len(chunks)} VERIFIZIERT & GESCHRIEBEN!")
                        written = True
                    else:
                        print("❌ Verifizierung fehlgeschlagen! Daten auf dem Tag stimmen nicht überein.")
                        time.sleep(1)
                        continue
                else:
                    print("❌ Schreibvorgang fehlgeschlagen!")
                    time.sleep(1)
                    continue

            except NoCardException:
                if not waiting_reported:
                    print("⌛ Warte auf NFC-Tag...")
                    waiting_reported = True
            except Exception as e:
                print(f"⚠️ Hinweis beim Schreiben: {e}")
            finally:
                if conn is not None:
                    try:
                        conn.disconnect()
                    except Exception:
                        pass
                reader_lock.release()

            time.sleep(0.2)

        # --- 2. PAUSE: Warten, bis der eben beschriebene Tag ANGEHOBEN wird ---
        if idx < len(chunks) - 1:  # Nur nötig, wenn noch weitere Chunks folgen
            print("👉 Bitte Tag jetzt vom Leser ENTFERNEN...")
            tag_removed = False
            while not tag_removed and not cancel_requested:
                got_lock = reader_lock.acquire(blocking=True, timeout=0.3)
                if got_lock:
                    try:
                        available_readers = readers()
                        if available_readers:
                            test_conn = available_readers[0].createConnection()
                            test_conn.connect()
                            test_conn.disconnect()
                            # Wenn die Verbindung klappt, liegt der alte Tag noch auf!
                            time.sleep(0.3)
                    except Exception:
                        # NoCardException -> Tag wurde erfolgreich entfernt!
                        tag_removed = True
                        print("✅ Tag entfernt! Bereit für den nächsten Tag.")
                    finally:
                        reader_lock.release()

    print("\n🎉 ALLE CHUNKS ERFOLGREICH BESCHRIEBEN!")
    return jsonify({"success": True, "message": "Alle Chunks geschrieben"}), 200

if __name__ == "__main__":
    print("=" * 60)
    print(" 🌐 MicroIMG Server gestartet!")
    print(" 👉 Öffne im Browser: http://127.0.0.1:5000")
    print("=" * 60)
    serve(app, host='0.0.0.0', port=5000, threads=6)
