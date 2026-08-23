🇬🇧 English Version
🔬 MicroIMG

    Ultra-low-capacity image compression & multi-chunk NFC transfer pipeline.

MicroIMG is a specialized framework designed to compress images down to a few hundred bytes for storage on severely space-constrained NFC media (e.g., NTAG216 chips) while preserving clear PixelArt aesthetics. For higher-resolution images, MicroIMG automatically slices the payload into sequential chunks (P1/N#ZIP:...), allowing lossless multi-tag assembly right in the browser via a smooth, non-blocking hardware interface.
🚀 Key Features

    Aggressive Data Compression: Reduces image data to tiny payloads without losing essential PixelArt details.

    Smart Multi-Chunk Assembly: Automatically splits larger payloads across multiple NFC tags and reconstructs them in the browser — regardless of the order in which the tags are scanned.

    Robust Format Normalization: Automatically sanitizes, validates, and aligns incoming chunk headers (P1/N#ZIP:...), ensuring resilient decoding even when tags contain legacy or raw NDEF fragments.

    Non-Blocking Hardware Handshake: Features thread-safe Python locking mechanisms and dedicated scan loops to protect PC/SC hardware and eliminate polling spam.

    Interruptible Workflow: Includes client- and backend-side cancellation handling to gracefully abort pending scan loops at any time.

🛠 Architecture & Workflow

    Compression & Encoding: Images are compressed into NDEF-compatible strings formatted with standardized chunk headers (P1/N#ZIP:...).

    Python Bridge (Backend): A lightweight Flask service using pyscard interfaces directly with PC/SC readers (e.g., ACR1252U), utilizing thread locks for safe hardware access and graceful cancellation.

    Browser Engine (Frontend): Manages guided multi-tag scanning, buffers raw chunks, provides visual status updates, and executes decodeAndPreview() or universalDecode() once the stream is full.

💻 Tech Stack

    Frontend: Modularized Vanilla JavaScript (ES6+, Async/Await), CSS3

    Backend Bridge: Python 3, Flask, PySCard (PC/SC Wrapper)

    Hardware: ACR1252U / NTAG216 NFC Chips

📄 Format Specification

Payloads are written across N tags using structured headers:

    Tag 1: P1/3#ZIP:... (Contains sequence metadata, format identifiers, and initial Base64 payload)

    Tag 2: P2/3#... (Payload chunk 2)

    Tag 3: P3/3#... (Payload chunk 3)

During scanning, MicroIMG strips sequence headers from subsequent chunks, verifies Base64 integrity, enforces the ZIP: prefix on the primary segment, and reconstructs a single unified stream for decoding.
📝 Recent Update Notes

    Clean Code & Modularization: Completely refactored index.html by extracting all inline CSS and client-side JavaScript into clean, maintainable assets within static/.

    Cancellation Support: Introduced a dedicated UI "Cancel" button tied to backend flag routines (cancel_requested), allowing instant cancellation of long-polling NFC read loops.

    GUI & UX Overhaul: Refined visual feedback banners, progress counters, and integrated a custom retro pixel-art favicon.

    Backend & Hardware Locks: Implemented reader_lock controls in Python to prevent concurrent hardware access collisions during active polling.

    Header & Regex Sanitization: Overhauled chunk assembly logic in script.js to strictly enforce P1/N#ZIP: formatting, preventing missing colons or stripped characters from breaking image reconstruction.

🇩🇪 Deutsche Version
🔬 MicroIMG

    Bildkomprimierung für minimale Speicherkapazitäten & Multi-Chunk NFC-Übertragung.

MicroIMG ist ein spezialisiertes Framework zur Komprimierung von Bildern auf wenige hundert Bytes, um diese auf extrem speicherbegrenzten NFC-Medien (wie NTAG216-Chips) abzulegen. Trotz der starken Datenreduktion bleibt eine klare PixelArt-Ästhetik erhalten. Für höhere Auflösungen zerlegt MicroIMG den Payload automatisch in fortlaufende Chunks (P1/N#ZIP:...), die im Browser reibungslos und sequenzunabhängig wieder zusammengesetzt werden.
🚀 Kernfunktionen

    Aggressive Datenkomprimierung: Reduziert Bilddaten auf kleinste Payloads bei maximalem Erhalt der PixelArt-Details.

    Intelligentes Multi-Chunking: Teilt größere Payloads automatisch auf mehrere NFC-Tags auf und fügt sie im Browser nahtlos zusammen – unabhängig von der Reihenfolge beim Auflegen.

    Robuste Format-Normalisierung: Automatische Säuberung und Bereinigung von Chunk-Headern (P1/N#ZIP:...), um auch bei Altlasten oder abweichenden Tag-Formaten eine fehlerfreie Rekonstruktion zu garantieren.

    Blockierungsfreier Hardware-Handshake: Threadsichere Python-Sperrmechanismen und dedizierte Scan-Schleifen schonen den PC/SC-Reader und verhindern Polling-Spam.

    Steuerbarer Abbrech-Workflow: Client- und backend-seitige Abbruch-Funktionen ermöglichen das jederzeitige, saubere Beenden laufender Lese-Schleifen.

🛠 Architektur & Ablauf

    Komprimierung & Encoding: Bilder werden stark komprimiert und in NDEF-konforme Strings mit standardisierten Chunk-Headern verpackt (P1/N#ZIP:...).

    Python-Bridge (Backend): Ein schlanker Flask-Dienst Steuert über pyscard den NFC-Leser an. Reader-Locks verhindern Hardware-Kollisionen, während Abbruch-Flags langwierige Schleifen unterbrechen.

    Browser-Engine (Frontend): Steuert den geführten Scan-Ablauf, verwaltet den Chunk-Puffer, löst visuelles Feedback aus und übergibt den vollständigen Datenstrom an decodeAndPreview() bzw. universalDecode().

💻 Tech-Stack

    Frontend: Modulares Vanilla JavaScript (ES6+, Async/Await), CSS3

    Backend-Bridge: Python 3, Flask, PySCard (PC/SC Wrapper)

    Hardware: ACR1252U / NTAG216 NFC-Chips

📄 Format-Spezifikation

Die Daten werden nach folgendem Muster auf N Tags verteilt:

    Tag 1: P1/3#ZIP:... (Enthält Sequenz-Metadaten, Format-Kennung und den ersten Base64-Teil)

    Tag 2: P2/3#... (Nutzdaten-Chunk 2)

    Tag 3: P3/3#... (Nutzdaten-Chunk 3)

Beim Einlesevorgang entfernt MicroIMG die Folge-Header automatisch, säubert den Base64-Datenstrom, erzwingt den ZIP:-Präfix vor dem ersten Segment und fügt die Fragmente nahtlos im Speicher zusammen.
📝 Änderungsprotokoll (Update Notes)

    Clean Code & Modularisierung: Vollständige Bereinigung der index.html. Sämtliche Styles und JS-Funktionen wurden sauber in Dateien unter static/ ausgelagert.

    Abbruch-Funktion: Einbau eines "Abbruch"-Buttons in der UI samt Backend-Anbindung (cancel_requested), um blockierende NFC-Schleifen sofort und kontrolliert zu beenden.

    GUI- & UX-Verbesserungen: Überarbeitung der Statusmeldungen, Fortschrittsanzeigen und Einbindung eines eigens generierten PixelArt-Favicons.

    Backend- & Hardware-Locks: Integration von reader_lock im Python-Backend zur Vermeidung von Thread-Kollisionen bei dauerhaftem Lese-Polling.

    Härtung der Parsing-Logik: Überarbeitung der Regex- und Zusammenbau-Schleifen in script.js zur unumstößlichen Formatierung von P1/N#ZIP:, wodurch Parsing-Fehler und fehlende Zeichen beim Bild-Decode ausgeschlossen werden.
