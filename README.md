🇬🇧 English Version

# 🔬 MicroIMG

> Ultra-low-capacity image compression & multi-chunk NFC transfer pipeline.

**MicroIMG** is a specialized framework designed to compress images down to a few hundred bytes for storage on severely space-constrained NFC media (e.g., NTAG216 chips) while preserving clear PixelArt aesthetics. For higher-resolution images, MicroIMG automatically slices the payload into sequential chunks (`P1/N#...`), allowing lossless multi-tag assembly right in the browser via a smooth, non-blocking hardware interface.

## 🚀 Key Features

* **Aggressive Data Compression:** Reduces image data to tiny payloads without losing essential PixelArt details.
* **Smart Multi-Chunk Assembly:** Automatically splits larger payloads across multiple NFC tags and reconstructs them in the browser — regardless of the order in which the tags are scanned.
* **Zero-Spam Hardware Handshake:** Features a dual-endpoint architecture (`/read-chunk` for payload scanning and `/check-tag` for lightweight presence checks) to protect hardware and avoid continuous polling spam.
* **Non-Blocking Scan Workflow:** Seamlessly handles tag removal detection (`waitingForTagRemoval`), ensuring each chunk is captured exactly once.
* **Visual Flash Feedback:** Provides instant visual UI feedback on successful reads, complementing physical NFC reader buzzers.

## 🛠 Architecture & Workflow

1. **Compression & Encoding:** Images are compressed and wrapped into NDEF-compatible strings formatted with chunk headers (e.g., `P1/3#ZIP:...`).
2. **Python Bridge (Backend):** A lightweight Flask service using `pyscard` interfaces directly with PC/SC readers (e.g., ACR1252U) to read pages synchronously and check card presence.
3. **Browser Engine (Frontend):** Manages the guided scan loop, handles payload buffering, triggers UI feedback, and executes `universalDecode()` once all chunks are collected.

## 💻 Tech Stack

* **Frontend:** Vanilla JavaScript (ES6+, Async/Await), CSS3
* **Backend Bridge:** Python 3, Flask, PySCard (PC/SC Wrapper)
* **Hardware:** ACR1252U / NTAG216 NFC Chips

## 📄 Format Specification

Payloads are written across $N$ tags using structured headers:

* **Tag 1:** `P1/3#ZIP:...` *(Contains format metadata and the initial payload)*
* **Tag 2:** `P2/3#...` *(Payload chunk 2)*
* **Tag 3:** `P3/3#...` *(Payload chunk 3)*

During the scanning process, MicroIMG strips duplicate sequence headers and seamlessly concatenates the payload into a single unified stream for decoding.

🇩🇪 Deutsche Version

# 🔬 MicroIMG

> Bildkomprimierung für minimale Speicherkapazitäten & Multi-Chunk NFC-Übertragung.

**MicroIMG** ist ein spezialisiertes Framework zur Komprimierung von Bildern auf wenige hundert Bytes, um diese auf extrem speicherbegrenzten NFC-Medien (wie NTAG216-Chips) abzulegen. Trotz der starken Datenreduktion bleibt eine klare PixelArt-Ästhetik erhalten. Für höhere Auflösungen zerlegt MicroIMG den Payload automatisch in fortlaufende Chunks (`P1/N#...`), die im Browser reibungslos und sequenzunabhängig wieder zusammengesetzt werden.

## 🚀 Kernfunktionen

* **Aggressive Datenkomprimierung:** Reduziert Bilddaten auf kleinste Payloads bei maximalem Erhalt der PixelArt-Details.
* **Intelligentes Multi-Chunking:** Teilt größere Payloads automatisch auf mehrere NFC-Tags auf und fügt sie im Browser nahtlos zusammen – unabhängig von der Reihenfolge beim Auflegen.
* **Ressourcenschonender Hardware-Handshake:** Nutzt eine getrennte Endpunkt-Architektur (`/read-chunk` für Nutzdaten, `/check-tag` für Presence-Checks), um Reader-Hardware (z. B. ACR1252U) und Systemressourcen zu schonen.
* **Blockierungsfreier Scan-Workflow:** Erkennung des Abnehmens von Tags (`waitingForTagRemoval`) verhindert doppeltes Einlesen und Dauer-Polling.
* **Optisches Flash-Feedback:** Sofortige visuelle Rückmeldung im Browser-UI bei erfolgreichem Einlesen eines Chunks als Ergänzung zum physischen Reader-Summer.

## 🛠 Architektur & Ablauf

1. **Komprimierung & Encoding:** Bilder werden stark komprimiert und in NDEF-konforme Strings mit Chunk-Headern verpackt (z. B. `P1/3#ZIP:...`).
2. **Python-Bridge (Backend):** Ein schlanker Flask-Dienst liest über `pyscard` die Pages des NFC-Tags aus und stellt synchrone, ressourcenschonende Schnittstellen bereit.
3. **Browser-Engine (Frontend):** Steuert den geführten Scan-Ablauf, verwaltet den Chunk-Puffer, löst das visuelle Feedback aus und übergibt das Gesamtergebnis an `universalDecode()`.

## 💻 Tech-Stack

* **Frontend:** Vanilla JavaScript (ES6+, Async/Await), CSS3
* **Backend-Bridge:** Python 3, Flask, PySCard (PC/SC Wrapper)
* **Hardware:** ACR1252U / NTAG216 NFC-Chips

## 📄 Format-Spezifikation

Die Daten werden nach folgendem Muster auf $N$ Tags verteilt:

* **Tag 1:** `P1/3#ZIP:...` *(Enthält Format-Metadaten und den ersten Nutzdaten-Teil)*
* **Tag 2:** `P2/3#...` *(Nutzdaten-Chunk 2)*
* **Tag 3:** `P3/3#...` *(Nutzdaten-Chunk 3)*

Beim Einlesevorgang entfernt MicroIMG die Folge-Header automatisch und fügt die Fragmente im Speicher z
