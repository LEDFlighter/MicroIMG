let masterImg = null, currentMode = 'ZIP', currentMaxRes = 64, forcedOrientation = 'landscape';
let offsetX = 0.5, offsetY = 0.5, isDragging = false, lastX, lastY;
let activePointers = new Map();
let startDistance = 0;
let startZoom = 1;
let nfcAbortController = null;
const canvas = document.getElementById('mainCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const frame = document.getElementById('canvasFrame');

function toggleTheme() {
    document.body.classList.toggle('light-theme');
}

function setMode(m) {
    currentMode = m;
    const btnZip = document.getElementById('btn-ZIP');
    const btnG4 = document.getElementById('btn-G4');
    const btnDP = document.getElementById('btn-DP');

    if (btnZip) btnZip.classList.toggle('active', m === 'ZIP');
    if (btnG4) btnG4.classList.toggle('active', m === 'G4');
    if (btnDP) btnDP.classList.toggle('active', m === 'DP');

    updateEngine();
}

function setOrientation(o) {
    forcedOrientation = o;
    const btnLand = document.getElementById('fmt-landscape');
    const btnPort = document.getElementById('fmt-portrait');

    if (btnLand) btnLand.classList.toggle('active', o === 'landscape');
    if (btnPort) btnPort.classList.toggle('active', o === 'portrait');

    updateEngine();
}

function forceUpdate() {
    updateEngine();
}

if (frame) {
    frame.style.touchAction = "none";

    frame.onpointerdown = (e) => {
        frame.setPointerCapture(e.pointerId);
        activePointers.set(e.pointerId, e);

        if (activePointers.size === 1) {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
        } else if (activePointers.size === 2) {
            const pts = Array.from(activePointers.values());
            startDistance = getDistance(pts[0], pts[1]);
            startZoom = parseFloat(document.getElementById('zoomSelect').value) / 100;
            isDragging = false;
        }
    };

    frame.onpointermove = (e) => {
        if (!masterImg) return;

        if (activePointers.has(e.pointerId)) {
            activePointers.set(e.pointerId, e);
        }

        // ----- PINCH ZOOM -----
        if (activePointers.size === 2) {
            const pts = Array.from(activePointers.values());
            const newDistance = getDistance(pts[0], pts[1]);

            let scale = newDistance / startDistance;
            let newZoom = startZoom * scale;
            newZoom = Math.max(0.1, Math.min(20, newZoom));

            document.getElementById('zoomSelect').value = newZoom * 100;
            updateEngine();
            return;
        }

        // ----- DRAG PAN -----
        if (isDragging && activePointers.size === 1) {
            const zoom = document.getElementById('zoomSelect').value / 100;

            offsetX -= (e.clientX - lastX) / (350 * zoom);
            offsetY -= (e.clientY - lastY) / (350 * zoom);

            offsetX = Math.max(0, Math.min(1, offsetX));
            offsetY = Math.max(0, Math.min(1, offsetY));

            lastX = e.clientX;
            lastY = e.clientY;

            updateEngine();
        }
    };

    frame.onpointerup = (e) => {
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) isDragging = false;
    };

    frame.onpointercancel = frame.onpointerup;
}

const imgInput = document.getElementById('imgInput');
if (imgInput) {
    imgInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => { 
            masterImg = new Image(); 
            masterImg.onload = () => updateEngine(); 
            masterImg.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    };
}

// ==========================================
// BIT-PACKING & BINÄRE HILFSFUNKTIONEN
// ==========================================

function packPixels(pixels, bitsPerPixel) {
    const pixelsPerByte = Math.floor(8 / bitsPerPixel);
    const packed = new Uint8Array(Math.ceil(pixels.length / pixelsPerByte));
    const mask = (1 << bitsPerPixel) - 1;

    for (let i = 0; i < pixels.length; i++) {
        const byteIndex = Math.floor(i / pixelsPerByte);
        const bitShift = 8 - bitsPerPixel - ((i % pixelsPerByte) * bitsPerPixel);
        packed[byteIndex] |= (pixels[i] & mask) << bitShift;
    }
    return packed;
}

function unpackPixels(packed, totalPixels, bitsPerPixel) {
    const pixelsPerByte = Math.floor(8 / bitsPerPixel);
    const pixels = new Uint8Array(totalPixels);
    const mask = (1 << bitsPerPixel) - 1;

    for (let i = 0; i < totalPixels; i++) {
        const byteIndex = Math.floor(i / pixelsPerByte);
        const bitShift = 8 - bitsPerPixel - ((i % pixelsPerByte) * bitsPerPixel);
        pixels[i] = (packed[byteIndex] >> bitShift) & mask;
    }
    return pixels;
}

function createZipPayloadBuffer(w, h, bitsPerPixel, packedBytes) {
    const buffer = new Uint8Array(5 + packedBytes.length);
    const view = new DataView(buffer.buffer);
    
    view.setUint16(0, w, false);          // Big-Endian Width
    view.setUint16(2, h, false);          // Big-Endian Height
    buffer[4] = bitsPerPixel & 0xFF;      // Bit-Tiefe (z.B. 1, 2, 4, 8)
    
    buffer.set(packedBytes, 5);
    return buffer;
}

async function compressData(binaryData) {
    // Nimmt ein Uint8Array entgegen und nutzt pako/Deflate für binäre Kompression
    const compressed = pako.deflate(binaryData);
    let binaryStr = "";
    const len = compressed.byteLength;
    for (let i = 0; i < len; i++) {
        binaryStr += String.fromCharCode(compressed[i]);
    }
    return btoa(binaryStr);
}

function decompressData(base64Str) {
    return new Promise((resolve, reject) => {
        try {
            let cleanBase64 = base64Str.replace(/[^A-Za-z0-9+/=]/g, "");
            while (cleanBase64.length % 4 !== 0) {
                cleanBase64 += "=";
            }

            const binaryString = atob(cleanBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const decompressed = pako.inflate(bytes);
            resolve(decompressed); // Gibt Uint8Array zurück
        } catch (err) {
            reject(new Error("Base64/ZIP Entpacken fehlgeschlagen: " + err.message));
        }
    });
}

// ==========================================
// HAUPT-ENGINE (BILDVERARBEITUNG)
// ==========================================

async function updateEngine() {
    if (!masterImg) return;
    currentMaxRes = +document.getElementById('size').value;
    const levels = +document.getElementById('tolerance').value;
    const con = +document.getElementById('contrast').value;
    const zoom = +document.getElementById('zoomSelect').value / 100;
    const cap = +document.getElementById('tagSelect').value - 15;

    let ratio = masterImg.width / masterImg.height;
    let w, h;
    const isLandscape = (forcedOrientation === 'landscape');

    // 1. Gleichmäßige Skalierungsberechnung (verhindert minimale Rundungsabweichungen)
    if (isLandscape) {
        w = currentMaxRes;
        h = Math.round(w / ratio);
    } else {
        h = currentMaxRes;
        w = Math.round(h * ratio);
    }

    // 2. Interne Pixel-Auflösung setzen
    canvas.width = w; 
    canvas.height = h;

    // 3. CSS-Größe zurücksetzen, damit CSS/Container die Skalierung übernimmt
    canvas.style.width = '';
    canvas.style.height = '';

    // 4. Glättung deaktivieren (hält das Bild beim Hochskalieren im UI scharf)
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
    }

    // Debug-Logs (zeigen die interne Auflösung und die CSS-Größe des Containers)
    console.log("Canvas-Interne Größe:", canvas.width, canvas.height);
    console.log("Canvas-CSS-Größe:", canvas.style.width, canvas.style.height);
    console.log("Verhältnis X/Y:", (canvas.width / canvas.height).toFixed(4));

    const sW = masterImg.width / zoom;
    const sH = masterImg.height / zoom;
    const sX = (masterImg.width * (offsetX ?? 0.5)) - (sW / 2);
    const sY = (masterImg.height * (offsetY ?? 0.5)) - (sH / 2);

    ctx.clearRect(0, 0, w, h);
    ctx.filter = `contrast(${con}%) grayscale(100%)`;
    
    ctx.drawImage(masterImg, sX, sY, sW, sH, 0, 0, w, h);
    
    const imgData = ctx.getImageData(0,0,w,h), d = imgData.data;
    let pixels = [];
    const step = 255 / (levels - 1); 
    
    for (let i = 0; i < d.length; i += 4) {
        let avg = (d[i] + d[i+1] + d[i+2]) / 3;
        let level = Math.round(avg / step);
        d[i] = d[i+1] = d[i+2] = Math.round(level * step);
        pixels.push(level);
    }
    ctx.putImageData(imgData,0,0);
    
    let code = "";
    if(currentMode === 'ZIP') {
        // Bits pro Pixel ermitteln (z.B. levels=4 -> 2 Bits, levels=16 -> 4 Bits)
        const bitsPerPixel = Math.max(1, Math.ceil(Math.log2(levels)));
        const packedBytes = packPixels(pixels, bitsPerPixel);
        const payloadBuffer = createZipPayloadBuffer(w, h, bitsPerPixel, packedBytes);
        
        const compressed = await compressData(payloadBuffer);
        code = `ZIP:${compressed}`;
    } else if(currentMode === 'G4') {
        code = `G4:W${w}H${h}:${encodeRLE_Raw(pixels)}`;
    } else {
        code = `DP:W${w}H${h}:${pixels.map(x=>x.toString(16)).join('').toUpperCase()}`;
    }

    const numTags = Math.ceil(code.length / cap);
    const tagText = numTags === 1 ? "TAG" : "TAGS";
    
    const hue = Math.max(0, 140 - (numTags * 15)); 
    const statsColor = `hsl(${hue}, 80%, 50%)`;

    document.getElementById('liveStats').innerHTML = `
        <b>${w}x${h}px</b> | ${code.length} B | 
        <span style="color: ${statsColor}; font-weight: 900; transition: color 0.3s;">
            ${numTags} ${tagText}
        </span>`;
    return code;
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {}).catch(err => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function getDistance(p1, p2) {
    const dx = p2.clientX - p1.clientX;
    const dy = p2.clientY - p1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Kopieren fehlgeschlagen', err);
    }
    document.body.removeChild(textArea);
}

function clearDecode() {
    const input = document.getElementById('inputRaw');
    if (input) input.value = "";

    const preview = document.getElementById('rePreview');
    if (preview) preview.innerHTML = '';

    const clearBtn = document.querySelector('.btn-clear');
    if (clearBtn) clearBtn.style.display = "none";
    
    console.log("Recovery-Bereich wurde erfolgreich genullt! 🧹✨");
}

function encodeRLE_Raw(p) {
    let res = "";
    for (let i=0; i<p.length; i++) {
        let c=1; while(i+1<p.length && p[i+1]===p[i] && c<15) { c++; i++; }
        res += c.toString(16).toUpperCase() + p[i].toString(16).toUpperCase();
    }
    return res;
}

async function finalizeBatch() {
    const code = await updateEngine();
    if (!code) return;

    const cap = +document.getElementById('tagSelect').value - 15;
    const container = document.getElementById('chunksContainer');
    if (!container) return;

    container.innerHTML = "";
    
    const numTags = Math.ceil(code.length / cap);
    let allChunksText = ""; 

    for (let j = 0, i = 1; j < code.length; j += cap, i++) {
        allChunksText += `P${i}/${numTags}#${code.substring(j, j + cap)}\n`;
    }

    if (numTags > 1) {
        const copyAllBtn = document.createElement('button');
        copyAllBtn.className = "btn-main";
        copyAllBtn.style.background = "linear-gradient(135deg, #3b82f6, #2563eb)";
        copyAllBtn.style.marginBottom = "15px";
        copyAllBtn.innerHTML = "📋 ALL CHUNKS TO DECODE & COPY";
        
        copyAllBtn.onclick = async () => {
            const cleanText = allChunksText.trim();

            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(cleanText);
                } else {
                    throw new Error("Clipboard API nicht verfügbar");
                }
            } catch (err) {
                console.warn("Clipboard API fehlgeschlagen, nutze Fallback:", err);
                if (typeof copyToClipboard === 'function') {
                    copyToClipboard(cleanText);
                }
            }

            const inputRaw = document.getElementById('inputRaw');
            if (inputRaw) {
                if ('value' in inputRaw) {
                    inputRaw.value = cleanText;
                }
                inputRaw.innerText = cleanText;
                inputRaw.textContent = cleanText;

                inputRaw.dispatchEvent(new Event('input', { bubbles: true }));
                inputRaw.dispatchEvent(new Event('change', { bubbles: true }));
            }
            
            const wrapper = document.getElementById('accordionWrapper');
            if (wrapper) {
                wrapper.classList.add('closed');
            }

            const toggleHint = document.getElementById('toggleHint');
            if (toggleHint) {
                toggleHint.style.display = "block";
                toggleHint.innerHTML = "Chunks wieder anzeigen...";
            }
        };
        container.appendChild(copyAllBtn);
    }

    const accordionWrapper = document.createElement('div');
    accordionWrapper.id = "accordionWrapper";
    accordionWrapper.className = "accordion-content";
    
    for (let j = 0, i = 1; j < code.length; j += cap, i++) {
        let c = code.substring(j, j + cap);
        let chunkData = `P${i}/${numTags}#${c}`;
        
        accordionWrapper.innerHTML += `
            <div class="chunk-card">
                <div style="display:flex; justify-content:space-between; color:var(--primary); margin-bottom:5px;">
                    <span>TAG ${i}/${numTags}</span>
                    <button onclick="copyToClipboard('${chunkData}')" style="font-size:0.6rem; cursor:pointer; background:var(--primary); border:none; color:white; border-radius:4px; padding:2px 6px;">COPY</button>
                </div>
                <div style="font-family:monospace; font-size:0.55rem; word-break:break-all; opacity:0.7;">${chunkData}</div>
            </div>`;
    }
    
    container.appendChild(accordionWrapper);

    const toggleHint = document.createElement('div');
    toggleHint.id = "toggleHint";
    toggleHint.className = "toggle-hint";
    toggleHint.innerHTML = "Chunks wieder anzeigen...";
    toggleHint.onclick = () => {
        accordionWrapper.classList.toggle('closed');
        toggleHint.innerHTML = accordionWrapper.classList.contains('closed') ? "Chunks wieder anzeigen..." : "Chunks einklappen...";
    };
    container.appendChild(toggleHint);
}

let isWriting = false;
let currentAbortController = null;

async function writeBatchToNfc() {
    const btnWrite = document.getElementById('btnCancelWrite').style.display = 'inline-block';
    const cancelBtn = document.getElementById('btnCancel');

    try {
        const code = await updateEngine();
        const cap = +document.getElementById('tagSelect').value - 15;
        
        let chunks = []; 
        const total = Math.ceil(code.length / cap);
        for (let j = 0; j < code.length; j += cap) {
            const chunkIndex = chunks.length + 1;
            const payload = code.substring(j, j + cap);
            chunks.push(`P${chunkIndex}/${total}#${payload}`);
        }

        currentAbortController = new AbortController();
        isWriting = true;

        if (btnWrite) btnWrite.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'block';

        const response = await fetch('/write-chunks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chunks: chunks }),
            signal: currentAbortController.signal
        });

        const result = await response.json();

        if (result.success) {
            alert("✨ Alle Tags erfolgreich beschrieben!");
        } else {
            alert("⚠️ Hinweis: " + (result.error || result.message));
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log("Schreibvorgang lokal storniert.");
        } else {
            console.error("Fehler beim Senden:", e);
            alert("⚠️ Verbindungsfehler zum NFC-Server.");
        }
    } finally {
        isWriting = false;
        currentAbortController = null;
        if (btnWrite) btnWrite.style.display = 'block';
        if (cancelBtn) cancelBtn.style.display = 'none';
    }
}

async function cancelNFCoperation() {
    console.log("🛑 Sende Abbruch-Signal an den Server...");

    if (typeof currentAbortController !== 'undefined' && currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }

    isWriting = false;

    // Haupt-Aktions-Buttons wieder anzeigen / aktivieren
    const btnWrite = document.getElementById('btnWrite');
    const btnRead = document.getElementById('btnRead');

    if (btnWrite) btnWrite.style.display = 'block';
    if (btnRead) {
        btnRead.disabled = false;
        const origText = btnRead.getAttribute('data-orig-text');
        if (origText) btnRead.innerHTML = origText;
    }

    // Beide Abbrechen-Buttons ausblenden
    cancelWriteBtn = document.getElementById('btnCancelWrite');
    btnDEEP = document.getElementById('btnCancelRead');

    if (cancelWriteBtn) cancelWriteBtn.style.display = 'none';
    if (btnDEEP) btnDEEP.style.display = 'none';

    try {
        await fetch('/cancel', { method: 'POST' });
    } catch (e) {
        console.warn("Server-Cancel fehlgeschlagen:", e);
    }
}

// Aliase für Abwärtskompatibilität
cancelWrite = cancelNFCoperation;
const cancelRead = cancelNFCoperation;

async function readFromNfc() { 
    console.log("🔍 Starte NFC-Leseversuch..."); 

    // Abbrechen-Button für Read anzeigen
    const btnDEEP = document.getElementById('btnCancelRead');
    if (btnDEEP) btnDEEP.style.display = 'inline-block';

    if (typeof isWriting !== 'undefined' && isWriting) { 
        console.warn("Lese-Vorgang abgebrochen: Schreib-Modus ist noch aktiv."); 
        return; 
    } 

    // Globalen Controller für den Lese-Vorgang initialisieren/nutzen
    if (typeof currentAbortController === 'undefined' || !currentAbortController) {
        currentAbortController = new AbortController();
    }
    const signal = currentAbortController.signal;

    const btnRead = document.getElementById('btnRead') || document.querySelector('button[onclick*="readFromNfc"]'); 
    const statusDiv = document.getElementById('statusMessage'); 
    const inputRaw = document.getElementById('inputRaw'); 
    const previewZone = document.getElementById('rePreview');

    let originalBtnText = ""; 
    if (btnRead) { 
        originalBtnText = btnRead.getAttribute('data-orig-text') || btnRead.innerHTML;
        btnRead.setAttribute('data-orig-text', originalBtnText);
        btnRead.disabled = true; 
        btnRead.innerHTML = "⏳ Warte auf NFC-Tag..."; 
    } 

    // Abbrechen-Button während des Lesens anzeigen
    if (btnDEEP) btnDEEP.style.display = 'inline-block';

    if (statusDiv) { 
        statusDiv.textContent = "📡 Bereit. Halte einen NFC-Tag an den Leser..."; 
        statusDiv.style.color = "#3b82f6"; 
    } 

    let shouldContinueReading = false;

    try { 
        // Signal an den Fetch-Request hängen
        const response = await fetch('/read-chunk', { signal }); 
        const result = await response.json(); 

        if (signal.aborted) return;

        if (!response.ok) {
            if (statusDiv) {
                statusDiv.textContent = `❌ ${result.error || 'Hardwarezugriff nicht verfügbar.'}`;
                statusDiv.style.color = "#ef4444";
            }
            if (previewZone) {
                previewZone.innerHTML = `
                    <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; padding: 12px; border-radius: 8px; color: #f87171; text-align: center;">
                        ⚠️ <strong>Hardware-Fehler:</strong> ${result.error || 'Kein NFC-Leser gefunden oder Smartcard-Library fehlt.'}
                    </div>`;
            }
            return;
        }

        if (result.success && result.data) { 
            const chunkData = result.data.trim(); 

            if (inputRaw) {  
                const existingLines = inputRaw.value.split('\n').map(l => l.trim()).filter(Boolean); 
                if (!existingLines.includes(chunkData)) { 
                    existingLines.push(chunkData); 
                    inputRaw.value = existingLines.join('\n'); 
                } 
            }  

            const rawText = inputRaw ? inputRaw.value.trim() : "";  
            const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);  
              
            const parsedChunks = lines.map(line => {  
                const hashIdx = line.indexOf('#');  
                if (hashIdx === -1) return null;  

                const header = line.substring(0, hashIdx);  
                const payload = line.substring(hashIdx + 1);  

                const match = header.match(/^P(\d+)\/(\d+)$/i);  
                return match ? {   
                    index: parseInt(match[1], 10),   
                    total: parseInt(match[2], 10),   
                    payload: payload,   
                    raw: line   
                } : null;  
            }).filter(Boolean);

            if (parsedChunks.length === 0) { 
                if (previewZone) { 
                    previewZone.innerHTML = ` 
                        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; padding: 12px; border-radius: 8px; color: #fbbf24; text-align: center;"> 
                            ℹ️ ${lines.length} Zeile(n) gelesen, aber noch kein gültiger Header (PX/Y#) gefunden... 
                        </div>`; 
                } 
            } else { 
                const expectedTotals = [...new Set(parsedChunks.map(c => c.total))]; 
                 
                if (expectedTotals.length > 1) { 
                    if (previewZone) { 
                        previewZone.innerHTML = ` 
                            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; padding: 12px; border-radius: 8px; color: #f87171; text-align: center;"> 
                                ⚠️ <strong>Konflikt erkannt:</strong> Es wurden Chunks von unterschiedlichen Sets vermischt. 
                            </div>`; 
                    } 
                    if (statusDiv) { 
                        statusDiv.textContent = "❌ Ungültige Chunk-Kombination!"; 
                        statusDiv.style.color = "#ef4444"; 
                    } 
                    return; 
                } 

                const totalExpected = expectedTotals[0]; 
                const foundIndices = new Set(parsedChunks.map(c => c.index)); 

                let isComplete = true; 
                for (let i = 1; i <= totalExpected; i++) { 
                    if (!foundIndices.has(i)) { 
                        isComplete = false; 
                        break; 
                    } 
                } 

                if (!isComplete) { 
                    if (previewZone) { 
                        previewZone.innerHTML = ` 
                            <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; padding: 12px; border-radius: 8px; color: #60a5fa; text-align: center;"> 
                                ⏳ Fortschritt: ${foundIndices.size} von ${totalExpected} eindeutigen Chunks erfasst. Nächsten Tag auflegen... 
                            </div>`; 
                    } 
                    if (statusDiv) { 
                        statusDiv.textContent = `✅ Chunk erfasst (${foundIndices.size}/${totalExpected}). Bereit für nächsten Tag.`; 
                        statusDiv.style.color = "#10b981"; 
                    } 

                    shouldContinueReading = true; 

                } else { 
                    if (previewZone) { 
                        previewZone.innerHTML = ` 
                            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; padding: 12px; border-radius: 8px; color: #34d399; text-align: center;"> 
                                🚀 Alle ${totalExpected} Chunks komplett! Baue Datenstrom zusammen... 
                            </div>`; 
                    } 
                    if (statusDiv) { 
                        statusDiv.textContent = "🎉 Alle Tags erfolgreich eingelesen!"; 
                        statusDiv.style.color = "#10b981"; 
                    } 

                    const chunkMap = {};  
                    parsedChunks.forEach(c => { chunkMap[c.index] = c; });  

                    let orderedParts = [];   
                    for (let i = 1; i <= totalExpected; i++) {   
                        let cleanPayload = chunkMap[i].payload.replace(/\s+/g, '');   
                        cleanPayload = cleanPayload.replace(/^P\d+\/\d+#?/, '').replace(/^ZIP:?/i, '');  
                        orderedParts.push(cleanPayload);   
                    }   

                    const rawBase64 = orderedParts.join('').replace(/[^A-Za-z0-9+/=]/g, '');   
                    const finalPayload = `P1/${totalExpected}#ZIP:${rawBase64}`;  

                    if (inputRaw) {  
                        inputRaw.value = finalPayload;  
                    }  

                    if (typeof universalDecode === 'function') {  
                        universalDecode();  
                    }  
                } 
            } 

        } else { 
            const errorMsg = result.error || result.message || "Kein Tag erkannt"; 
            if (statusDiv) { 
                statusDiv.textContent = `⚠️ ${errorMsg}`; 
                statusDiv.style.color = "#f59e0b"; 
            } 
        } 
    } catch (e) { 
        if (e.name === 'AbortError') {
            console.log("NFC-Fetch storniert.");
            if (statusDiv) {
                statusDiv.textContent = "⏹️ Lesevorgang abgebrochen.";
                statusDiv.style.color = "#f59e0b";
            }
        } else {
            console.error("Fehler beim Abrufen vom NFC-Server:", e); 
            if (statusDiv) { 
                statusDiv.textContent = "❌ Server-Verbindungsfehler"; 
                statusDiv.style.color = "#ef4444"; 
            } 
        }
    } finally { 
        // Wenn die Leseschleife NICHT fortgesetzt wird oder abgebrochen wurde:
        if (!shouldContinueReading || (signal && signal.aborted)) { 
            // 1. Lese-Button wieder aktivieren und Ur-Text wiederherstellen
            if (btnRead) {
                btnRead.disabled = false; 
                btnRead.innerHTML = btnRead.getAttribute('data-orig-text') || originalBtnText; 
            }

            // 2. Abbrechen-Button für das Lesen definitiv ausblenden
            const cancelReadBtn = document.getElementById('btnCancelRead');
            if (cancelReadBtn) {
                cancelReadBtn.style.display = 'none';
            }

            // 3. Controller zurücksetzen
            currentAbortController = null;
        } 
    }

    // Bei aktivem Loop und ohne Abbruch nach 300ms erneut feuern
    if (shouldContinueReading && !signal.aborted) {
        setTimeout(readFromNfc, 300);
    }
}

// ==========================================
// UNIVERSAL DECODER (ZIP, G4, DP)
// ==========================================

async function universalDecode() {
    let rawArea = document.getElementById('inputRaw').value.trim();

    if (!rawArea) return;

    if (!rawArea.startsWith("P1/")) {
        const previewZone = document.getElementById('rePreview');
        if (previewZone) {
            previewZone.innerHTML = `<div style="color: #fbbf24; text-align: center; padding: 10px;">
                ℹ️ Wichtiger erster Chunk (P1) fehlt am Anfang.
            </div>`;
        }
        return;
    }
    
    try {
        let cleanData = rawArea.replace(/P\d+\/\d+#/g, "").replace(/\s/g, "");
        
        let w, h, px = [];

        // ----- FALL 1: NEUER BINÄRER ZIP-MODUS -----
        if (cleanData.includes("ZIP:")) {
            let zipBody = cleanData.split("ZIP:")[1];
            zipBody = zipBody.replace(/[^A-Za-z0-9+/=]/g, '');
            
            // 1. Binär entpacken (liefert Uint8Array)
            const decompressedBytes = await decompressData(zipBody);
            
            // 2. Binäre Metadaten lesen (Bytes 0-4)
            const view = new DataView(decompressedBytes.buffer, decompressedBytes.byteOffset, decompressedBytes.byteLength);
            w = view.getUint16(0, false);
            h = view.getUint16(2, false);
            const bitsPerPixel = decompressedBytes[4];
            
            // 3. Bit-Unpacking durchführen
            const packedBytes = decompressedBytes.subarray(5);
            const totalPixels = w * h;
            px = Array.from(unpackPixels(packedBytes, totalPixels, bitsPerPixel));
            
        } else {
            // ----- FALL 2: ALT-MODI (G4, DP) -----
            let content = cleanData;
            const parts = content.split(':');
            const metaPart = parts.find(p => p.includes('W') && p.includes('H'));
            if (!metaPart) throw new Error("Keine Metadaten im Chunk-Stream gefunden.");

            w = parseInt(metaPart.match(/W(\d+)/)[1]);
            h = parseInt(metaPart.match(/H(\d+)/)[1]);
            const data = parts[parts.length - 1]; 

            if (content.includes("G4")) {
                for (let i = 0; i < data.length; i += 2) {
                    let c = parseInt(data[i], 16); 
                    let v = parseInt(data[i+1], 16);
                    if (!isNaN(c) && !isNaN(v)) {
                        for (let k = 0; k < c; k++) px.push(v);
                    }
                }
            } else {
                for (let i = 0; i < data.length; i++) {
                    let v = parseInt(data[i], 16);
                    if (!isNaN(v)) px.push(v);
                }
            }
        }
        
        // ----- CANVAS RENDERING & BRIGHTNESS MATCHING -----
        const cv = document.createElement('canvas'); 
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        const img = cx.createImageData(w, h);

        const maxLevel = px.length > 0 ? Math.max(...px) : 0; 
        const lumaFactor = maxLevel > 0 ? (255 / maxLevel) : 255;

        for (let j = 0; j < px.length && j < w * h; j++) {
            let idx = j * 4;
            let v = Math.round(px[j] * lumaFactor);
            img.data[idx] = img.data[idx+1] = img.data[idx+2] = v; 
            img.data[idx+3] = 255;
        }
        
        cx.putImageData(img, 0, 0);
        
        // --- PREVIEW ---
		const previewZone = document.getElementById('rePreview');
		if (previewZone) {
			previewZone.innerHTML = '';

			const title = document.createElement('h4');
			title.textContent = `✨ jMX REKONSTRUKTION ERFOLGREICH (${w}x${h})`;
			previewZone.appendChild(title);

			cv.style.cssText = "width:100%; max-width:350px; image-rendering:pixelated; border-radius:12px; display:block; margin:0 auto 15px auto;";
			previewZone.appendChild(cv);

			const dlBtn = document.createElement('button');
			dlBtn.type = "button";
			dlBtn.className = "btn-main btn-emerald";
			dlBtn.textContent = "💾 BILD SPEICHERN (PNG)";

			// Stoppt das Event in der Capture-Phase vor allen anderen Skripten
			dlBtn.addEventListener('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation(); // Verhindert, dass andere Event-Listener auf demselben Element oder darüber feuern

				const defaultScale = 20;
				const userInput = window.prompt(`Skalierungsfaktor für den Export wählen:\n(1 = Originalgröße ${w}x${h}px)`, defaultScale);
        
				if (userInput === null) return;

				let scale = parseInt(userInput, 10);
				if (isNaN(scale) || scale < 1) {
					scale = defaultScale;
				}

				const exportCv = document.createElement('canvas');
				exportCv.width = w * scale;
				exportCv.height = h * scale;
				const exportCx = exportCv.getContext('2d');

				exportCx.imageSmoothingEnabled = false;
				exportCx.webkitImageSmoothingEnabled = false;
				exportCx.mozImageSmoothingEnabled = false;

				exportCx.drawImage(cv, 0, 0, w, h, 0, 0, exportCv.width, exportCv.height);

				const link = document.createElement('a');
				link.download = `MicroIMG_Decode_${exportCv.width}x${exportCv.height}_${Date.now()}.png`;
				link.href = exportCv.toDataURL("image/png");
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
			}, true); // <- "true" aktiviert Capture-Phase (fängt das Event als Erstes ab)

			previewZone.appendChild(dlBtn);
		}

        const clearBtn = document.querySelector('.btn-clear');
        if (clearBtn) clearBtn.style.display = "inline-block";
        
    } catch(e) { 
        console.error("Decode Error:", e);
        alert("Fehler bei Dekodierung: " + e.message); 
    }
}
