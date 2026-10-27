'use strict';
const $ = id => document.getElementById(id);
const native = window.Android;
const codec = window.MicroCodec;
let source = null, chunks = [], stream = '', decodedImage = null, activeMode = null;
let importedImage = null, exportTarget = null, exportReturnFocus = null;
let nfcAvailable = false, nfcEnabled = false, collector = new codec.Collector();
let offsetX = 0.5, offsetY = 0.5, zoom = 1, renderPending = false;
const pointers = new Map();
let lastPoint = null, pinchDistance = 0, pinchZoom = 1;

function notice(message, error = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
    $('notice').hidden = !message;
}
function selectTab(reading) {
    $('createPanel').hidden = reading;
    $('readPanel').hidden = !reading;
    $('createTab').classList.toggle('active', !reading);
    $('readTab').classList.toggle('active', reading);
    $('createTab').setAttribute('aria-selected', String(!reading));
    $('readTab').setAttribute('aria-selected', String(reading));
}
function updateButtons() {
    $('write').disabled = !chunks.length || !nfcAvailable || !nfcEnabled || !!activeMode;
    $('read').disabled = !nfcAvailable || !nfcEnabled || !!activeMode;
    $('read').textContent = activeMode === 'read' ? 'NFC · Lesen aktiv' : 'NFC · Tags lesen';
    $('editor').disabled = !!activeMode;
    $('imageSettings').disabled = !!importedImage;
    $('imageSettings').hidden = !!importedImage;
    $('createPanel').classList.toggle('imported', !!importedImage);
    $('exportChunks').disabled = !chunks.length || !!activeMode;
    $('exportPreview').disabled = !stream || !!activeMode;
    $('decode').disabled = !!activeMode;
    $('raw').disabled = !!activeMode;
    $('reset').disabled = !!activeMode;
}
function setOperation(mode, message = '') {
    activeMode = mode;
    $('operation').hidden = !mode;
    document.body.classList.toggle('operating', !!mode);
    $('operationTitle').textContent = mode === 'write' ? 'NFC · Schreiben & Prüfen' : 'NFC · Tags lesen';
    $('operationMessage').textContent = message;
    $('writeMeter').hidden = mode !== 'write';
    updateButtons();
}
function saveText(name, text) {
    save(name, 'text/plain', codecBase64(new TextEncoder().encode(text)));
}
function codecBase64(bytes) {
    let binary = '';
    for(let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}
function save(name, mime, base64) {
    if(native) native.save(name, mime, base64);
    else {
        const link = document.createElement('a');
        link.href = `data:${mime};base64,${base64}`;
        link.download = name;
        link.click();
    }
}
function exportDimensions(canvas, scale) {
    const maxScale = Math.floor(4096 / Math.max(canvas.width, canvas.height));
    if(!Number.isInteger(scale) || scale < 1)
        throw new Error('Bitte eine positive ganze Zahl eingeben.');
    if(scale > maxScale)
        throw new Error(`Für dieses Bild ist höchstens Faktor ${maxScale} möglich (max. 4096 Pixel pro Seite).`);
    return {width: canvas.width * scale, height: canvas.height * scale, maxScale};
}
function exportCanvas(canvas, scale = 1) {
    const size = exportDimensions(canvas, scale);
    const output = document.createElement('canvas');
    output.width = size.width;
    output.height = size.height;
    const ctx = output.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, output.width, output.height);
    save(`MicroIMG_${output.width}x${output.height}.png`, 'image/png', output.toDataURL('image/png').split(',')[1]);
}
function updateExportSize() {
    if(!exportTarget) return;
    try {
        const size = exportDimensions(exportTarget, +$('exportScale').value);
        $('exportSize').textContent = `${size.width} × ${size.height} Pixel`;
        $('exportError').hidden = true;
        $('confirmExport').disabled = false;
    } catch(error) {
        $('exportSize').textContent = '';
        $('exportError').textContent = error.message;
        $('exportError').hidden = false;
        $('confirmExport').disabled = true;
    }
}
function openExport(canvas, returnFocus) {
    const maxScale = Math.floor(4096 / Math.max(canvas.width, canvas.height));
    if(maxScale < 1) { notice('Dieses Bild überschreitet die maximale PNG-Seitenlänge von 4096 Pixeln.', true); return; }
    // Freeze the chosen image while subsequent NFC scans can update the decoded canvas.
    exportTarget = document.createElement('canvas');
    exportTarget.width = canvas.width; exportTarget.height = canvas.height;
    exportTarget.getContext('2d').drawImage(canvas, 0, 0);
    exportReturnFocus = returnFocus;
    $('exportScale').max = String(maxScale);
    $('exportScale').value = String(Math.max(1, Math.min(+$('exportScale').value || 8, maxScale)));
    $('exportHint').textContent = `1 = Originalgröße · Ganzzahliger Faktor bis ${maxScale} · Scharfe Pixel ohne Glättung.`;
    $('pngExport').hidden = false;
    updateExportSize();
    $('exportScale').focus();
    $('exportScale').select();
}
function closeExport() {
    $('pngExport').hidden = true;
    exportTarget = null;
    if(exportReturnFocus) exportReturnFocus.focus();
}
function drawPixels(canvas, image) {
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d'), data = ctx.createImageData(image.width, image.height);
    const factor = image.maxLevel ? 255 / image.maxLevel : 0;
    for(let i = 0; i < image.pixels.length; i++) {
        const value = Math.round(image.pixels[i] * factor);
        data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = value;
        data.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
}
function queueRender() {
    if(renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => { renderPending = false; render(); });
}
function selectedCapacity() {
    return $('capacity').value === 'custom' ? +$('customCapacity').value : +$('capacity').value;
}
function presentImage(image, code) {
    const nextChunks = codec.split(code, selectedCapacity());
    drawPixels($('preview'), image);
    stream = code;
    chunks = nextChunks;
    $('preview').hidden = false;
    $('emptyPreview').hidden = true;
    $('gestureHint').hidden = !!importedImage;
    $('pixelStat').textContent = `${image.width} × ${image.height}`;
    $('byteStat').textContent = stream.length.toLocaleString('de-DE');
    $('tagStat').textContent = chunks.length;
    $('chunkDetails').hidden = false;
    $('chunkSummary').textContent = `${chunks.length} Tag-Code${chunks.length > 1 ? 's' : ''} anzeigen`;
    if($('chunkDetails').open) showChunks();
    updateButtons();
}
function render() {
    $('levelsValue').textContent = $('levels').value;
    $('contrastValue').textContent = `${$('contrast').value} %`;
    zoom = +$('zoom').value / 100;
    $('zoomValue').textContent = zoom.toFixed(1).replace('.', ',') + ' ×';
    $('customCapacityLabel').hidden = $('capacity').value !== 'custom';
    for(const button of document.querySelectorAll('[data-format]')) {
        const selected = button.dataset.format === $('format').value;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    }
    if(!source && !importedImage) return;
    try {
        if(importedImage) { presentImage(importedImage.image, importedImage.stream); return; }
        const resolution = +$('resolution').value, levels = +$('levels').value;
        const scale = resolution / Math.max(source.width, source.height);
        const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
        const cropW = source.width / zoom, cropH = source.height / zoom;
        const cropX = Math.max(0, Math.min(source.width - cropW, source.width * offsetX - cropW / 2));
        const cropY = Math.max(0, Math.min(source.height - cropH, source.height * offsetY - cropH / 2));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data, gray = new Float32Array(width * height);
        const contrast = +$('contrast').value / 100, step = 255 / (levels - 1), dither = $('dither').value;
        for(let i = 0; i < gray.length; i++)
            gray[i] = Math.max(0, Math.min(255, ((rgba[i * 4] * .2126 + rgba[i * 4 + 1] * .7152 + rgba[i * 4 + 2] * .0722) - 127.5) * contrast + 127.5));
        const pixels = new Uint8Array(gray.length);
        let maxLevel = 0;
        for(let y = 0; y < height; y++) {
            for(let x = 0; x < width; x++) {
                const i = y * width + x, level = Math.max(0, Math.min(levels - 1, Math.round(gray[i] / step)));
                pixels[i] = level;
                maxLevel = Math.max(maxLevel, level);
                const error = gray[i] - level * step;
                if(dither === 'atkinson') {
                    if(x + 1 < width) gray[i + 1] += error / 8;
                    if(x + 2 < width) gray[i + 2] += error / 8;
                    if(y + 1 < height) {
                        if(x > 0) gray[i + width - 1] += error / 8;
                        gray[i + width] += error / 8;
                        if(x + 1 < width) gray[i + width + 1] += error / 8;
                    }
                    if(y + 2 < height) gray[i + width * 2] += error / 8;
                } else if(dither === 'floyd') {
                    if(x + 1 < width) gray[i + 1] += error * 7 / 16;
                    if(y + 1 < height) {
                        if(x > 0) gray[i + width - 1] += error * 3 / 16;
                        gray[i + width] += error * 5 / 16;
                        if(x + 1 < width) gray[i + width + 1] += error / 16;
                    }
                }
            }
        }
        presentImage({width, height, pixels, maxLevel}, codec.encode(width, height, pixels, levels, $('format').value));
    } catch(error) {
        stream = ''; chunks = [];
        updateButtons();
        notice(error.message, true);
    }
}
function showChunks() {
    const container = $('chunkList');
    container.textContent = '';
    for(let i = 0; i < chunks.length; i++) {
        const item = document.createElement('div'), label = document.createElement('strong'), code = document.createElement('code');
        item.className = 'chunk';
        label.textContent = `Tag ${i + 1}/${chunks.length} · ${codec.ndefSize(chunks[i])} Byte NDEF`;
        code.textContent = chunks[i];
        item.append(label, code);
        container.append(item);
    }
}
function setSource(image, name = 'Bilddatei') {
    source = image;
    importedImage = null;
    $('sourceInfo').textContent = name;
    offsetX = offsetY = .5;
    $('zoom').value = '100';
    zoom = 1;
    notice('');
    render();
}
$('imageInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if(!file) return;
    if(file.size > 32 * 1024 * 1024) { notice('Bitte ein Bild mit höchstens 32 MB auswählen.', true); return; }
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => {
        try {
            if(image.naturalWidth * image.naturalHeight > 100000000) throw new Error('Bitte ein Bild mit höchstens 100 Megapixeln auswählen.');
            const downscale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * downscale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * downscale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            setSource(canvas, file.name);
        } catch(error) { notice(error.message, true); }
        finally { URL.revokeObjectURL(url); $('imageInput').value = ''; }
    };
    image.onerror = () => { URL.revokeObjectURL(url); notice('Dieses Bildformat konnte nicht geöffnet werden. Bitte PNG, JPEG oder WebP verwenden.', true); $('imageInput').value = ''; };
    image.src = url;
});
function loadCode(text, name = 'Eingefügter MicroIMG-Text') {
    const imported = codec.importText(text);
    codec.split(imported.stream, selectedCapacity());
    importedImage = imported;
    source = null;
    offsetX = offsetY = .5;
    $('zoom').value = '100';
    $('sourceInfo').textContent = `${name} · Originalcode geladen. Zum Bearbeiten eine Bilddatei öffnen.`;
    render();
    notice(`MicroIMG importiert: ${imported.image.width} × ${imported.image.height} Pixel, ${chunks.length} ${chunks.length === 1 ? 'Tag' : 'Tags'}. Bereit zum Schreiben.`);
}
function closeImport() {
    $('codeImport').hidden = true;
    $('openImport').focus();
}
$('openImport').onclick = () => {
    $('importError').hidden = true;
    $('codeImport').hidden = false;
    $('codeImport').firstElementChild.scrollTop = 0;
    $('codeText').focus();
};
$('dismissImport').onclick = closeImport;
$('pasteImport').onclick = () => {
    if(native) native.pasteCode();
    else if(navigator.clipboard && navigator.clipboard.readText)
        navigator.clipboard.readText().then(text => window.onNativeEvent({type: 'paste', text})).catch(() => window.onNativeEvent({type: 'paste', error: 'Bitte den Text direkt in das Textfeld einfügen.'}));
    else window.onNativeEvent({type: 'paste', error: 'Bitte den Text direkt in das Textfeld einfügen.'});
};
$('applyImport').onclick = () => {
    try {
        loadCode($('codeText').value);
        closeImport();
        $('codeText').value = '';
    } catch(error) {
        $('importError').textContent = error.message;
        $('importError').hidden = false;
    }
};
$('demo').onclick = () => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e5e5e5'; ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(94, 24, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#777'; ctx.beginPath(); ctx.moveTo(0, 78); ctx.lineTo(42, 25); ctx.lineTo(90, 80); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.moveTo(42, 96); ctx.lineTo(91, 42); ctx.lineTo(128, 83); ctx.lineTo(128, 96); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(27, 44); ctx.lineTo(42, 25); ctx.lineTo(59, 45); ctx.lineTo(43, 39); ctx.fill();
    setSource(canvas, 'Beispielbild');
};
$('rotate').onclick = () => {
    if(!source) return;
    const canvas = document.createElement('canvas'); canvas.width = source.height; canvas.height = source.width;
    const ctx = canvas.getContext('2d'); ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(source, 0, 0);
    setSource(canvas);
};
for(const id of ['resolution', 'levels', 'dither', 'contrast', 'zoom', 'format', 'capacity', 'customCapacity'])
    $(id).addEventListener('input', queueRender);
for(const button of document.querySelectorAll('[data-format]'))
    button.onclick = () => { $('format').value = button.dataset.format; render(); };
function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#f8fafc' : '#0b0f1a';
    $('theme').setAttribute('aria-pressed', String(theme === 'light'));
    try { localStorage.setItem('microimgTheme', theme); } catch(ignored) { }
}
$('theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
$('chunkDetails').addEventListener('toggle', () => { if($('chunkDetails').open) showChunks(); });
$('createTab').onclick = () => selectTab(false);
$('readTab').onclick = () => selectTab(true);
$('exportChunks').onclick = () => saveText('MicroIMG_Tags.txt', chunks.join('\n'));
$('exportPreview').onclick = () => openExport($('preview'), $('exportPreview'));
$('exportScale').addEventListener('input', updateExportSize);
$('dismissExport').onclick = closeExport;
$('confirmExport').onclick = () => {
    try { exportCanvas(exportTarget, +$('exportScale').value); closeExport(); }
    catch(error) { $('exportError').textContent = error.message; $('exportError').hidden = false; }
};
$('copyChunks').onclick = () => {
    if(native) native.copy(chunks.join('\n'));
    else navigator.clipboard.writeText(chunks.join('\n')).catch(error => notice(error.message, true));
    notice('Tag-Codes kopiert.');
};
$('write').onclick = () => {
    render();
    if(!chunks.length) return;
    $('confirmSummary').textContent = `${chunks.length} ${chunks.length === 1 ? 'Tag' : 'verschiedene Tags'} benötigt · ${$('pixelStat').textContent} Pixel · ${stream.length} Byte Bildcode.`;
    $('confirm').hidden = false;
    $('dismissConfirm').focus();
};
$('dismissConfirm').onclick = () => { $('confirm').hidden = true; $('write').focus(); };
$('confirmWrite').onclick = () => {
    $('confirm').hidden = true;
    if(native && chunks.length) {
        notice('');
        $('writeMeter').max = chunks.length; $('writeMeter').value = 0;
        setOperation('write', `Tag 1 von ${chunks.length} anhalten.`);
        native.write(JSON.stringify(chunks));
    }
};
$('confirm').addEventListener('keydown', event => {
    if(event.key === 'Escape') $('dismissConfirm').click();
    if(event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === $('dismissConfirm') ? $('confirmWrite') : $('dismissConfirm')).focus();
    }
});
function trapDialogFocus(event, dialog, close) {
    if(event.key === 'Escape') { event.preventDefault(); close(); }
    if(event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), textarea:not(:disabled), input:not(:disabled)')];
    const first = controls[0], last = controls[controls.length - 1];
    if(event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if(!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
$('codeImport').addEventListener('keydown', event => trapDialogFocus(event, $('codeImport'), closeImport));
$('pngExport').addEventListener('keydown', event => trapDialogFocus(event, $('pngExport'), closeExport));
$('read').onclick = () => {
    if(collector.complete && collector.total > 1) { notice('Das Bild ist vollständig. Für ein neues Bild zuerst die gesammelten Tags zurücksetzen.'); return; }
    if(collector.complete) { collector = new codec.Collector(); updateCollection(); }
    notice('');
    setOperation('read', 'Tag an die Rückseite des Smartphones halten.');
    if(native) native.read();
};
$('cancel').onclick = () => { if(native) native.cancel(); setOperation(null); };
$('hardware').onclick = () => { if(native) native.nfcSettings(); };
function updateCollection() {
    $('raw').value = collector.lines();
    $('readProgress').hidden = !collector.total;
    $('reset').hidden = !collector.total || (collector.complete && collector.total === 1);
    $('readCount').textContent = `${collector.parts.size} / ${collector.total} Tags gelesen`;
    $('readMeter').max = collector.total || 1;
    $('readMeter').value = collector.parts.size;
    const missing = collector.missing;
    $('missing').textContent = missing.length ? `Noch offen: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}.` : 'Alle Tags vorhanden.';
    try { localStorage.setItem('microimgRead', collector.lines()); } catch(ignored) { }
}
function showDecoded(data, keepReading = false) {
    decodedImage = codec.decode(data);
    drawPixels($('decoded'), decodedImage);
    $('decodedSize').textContent = `${decodedImage.width} × ${decodedImage.height}`;
    $('decodedCard').hidden = false;
    if(keepReading) {
        setOperation('read', 'Bild gelesen. Tag entfernen und direkt den nächsten Tag anhalten.');
        notice('Bild wiederhergestellt. Bereit für den nächsten Tag.');
    } else {
        if(activeMode === 'read' && native) native.stopRead();
        setOperation(null);
        notice('Alle Bilddaten vorhanden. Das Bild wurde wiederhergestellt.');
    }
}
function acceptChunk(text) {
    const pending = collector.complete && collector.total === 1 ? new codec.Collector() : collector;
    pending.add(text);
    if(pending.complete) showDecoded(pending.stream(), activeMode === 'read' && pending.total === 1);
    collector = pending;
    updateCollection();
    if(!collector.complete) $('operationMessage').textContent = `${collector.parts.size} von ${collector.total} Tags gelesen. Tag entfernen und den nächsten anhalten.`;
}
$('decode').onclick = () => {
    try {
        const text = $('raw').value.trim();
        if(!text) throw new Error('Bitte zuerst einen Bildcode einfügen.');
        if(text.length > 3000000) throw new Error('Der Datenstrom ist zu groß.');
        if(/^(ZIP:|G4:|DP:)/.test(text)) { showDecoded(text); return; }
        const pending = new codec.Collector();
        for(const line of text.split(/\r?\n/).filter(line => line.trim())) pending.add(line);
        collector = pending;
        $('decodedCard').hidden = true;
        decodedImage = null;
        updateCollection();
        if(collector.complete) showDecoded(collector.stream());
        else notice(`${collector.parts.size} von ${collector.total} Tags eingelesen. Fehlende Tags scannen oder ergänzen.`);
    } catch(error) { notice(error.message, true); }
};
$('reset').onclick = () => {
    collector = new codec.Collector(); decodedImage = null;
    $('decodedCard').hidden = true;
    updateCollection();
    notice('Gesammelte Tags zurückgesetzt. Bereit für ein neues Bild.');
};
$('saveDecoded').onclick = () => openExport($('decoded'), $('saveDecoded'));
window.onNativeEvent = data => {
    if(data.type === 'paste') {
        if($('codeImport').hidden) return;
        if(data.error) { $('importError').textContent = data.error; $('importError').hidden = false; }
        else { $('codeText').value = data.text; $('importError').hidden = true; $('codeText').focus(); }
        return;
    }
    if(data.type === 'hardware') {
        nfcAvailable = data.available; nfcEnabled = data.enabled;
        $('hardware').textContent = !nfcAvailable ? 'Kein NFC' : nfcEnabled ? '● NFC bereit' : 'NFC aus';
        $('hardware').classList.toggle('off', !nfcEnabled);
        if(!nfcAvailable) notice('Dieses Gerät hat kein NFC. Bilder komprimieren, Codes austauschen und rekonstruieren ist weiterhin möglich.');
        else if(!nfcEnabled) notice('NFC ist ausgeschaltet. Oben auf „NFC aus“ tippen, um die Einstellungen zu öffnen.');
        updateButtons();
        return;
    }
    if(data.type === 'chunk') {
        if(activeMode !== 'read') return;
        try { acceptChunk(data.text); }
        catch(error) { notice(error.message, true); }
    } else if(data.type === 'progress' || data.type === 'written') {
        $('writeMeter').max = data.total; $('writeMeter').value = data.index;
        $('operationMessage').textContent = data.message;
        if(data.type === 'written') { setOperation(null); notice(data.message); }
    } else if(data.type === 'reading' || data.type === 'writing') {
        setOperation(data.type === 'writing' ? 'write' : 'read', data.message);
    } else if(data.type === 'retry') {
        $('operationMessage').textContent = data.message;
        notice(data.message, true);
    } else if(data.type === 'cancelled' || data.type === 'error') {
        setOperation(null); notice(data.message, data.type === 'error');
    } else if(data.type === 'saved') notice(data.message);
};
const frame = $('previewFrame');
frame.addEventListener('pointerdown', event => {
    if(!source || activeMode) return;
    frame.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
    lastPoint = {x: event.clientX, y: event.clientY};
    if(pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); pinchZoom = zoom;
    }
});
frame.addEventListener('pointermove', event => {
    if(!pointers.has(event.pointerId) || activeMode) return;
    const point = {x: event.clientX, y: event.clientY};
    pointers.set(event.pointerId, point);
    if(pointers.size === 2 && pinchDistance > 0) {
        const [a, b] = [...pointers.values()];
        $('zoom').value = Math.max(100, Math.min(1600, pinchZoom * Math.hypot(a.x - b.x, a.y - b.y) / pinchDistance * 100));
    } else if(pointers.size === 1 && lastPoint) {
        const rect = frame.getBoundingClientRect();
        offsetX = Math.max(0, Math.min(1, offsetX - (point.x - lastPoint.x) / rect.width / zoom));
        offsetY = Math.max(0, Math.min(1, offsetY - (point.y - lastPoint.y) / rect.height / zoom));
    }
    lastPoint = point;
    queueRender();
});
function releasePointer(event) {
    pointers.delete(event.pointerId);
    lastPoint = pointers.size === 1 ? [...pointers.values()][0] : null;
}
frame.addEventListener('pointerup', releasePointer);
frame.addEventListener('pointercancel', releasePointer);
try { setTheme(localStorage.getItem('microimgTheme') === 'light' ? 'light' : 'dark'); } catch(ignored) { }
try {
    const saved = localStorage.getItem('microimgRead');
    if(saved && saved.length <= 3000000) {
        for(const line of saved.split('\n').filter(Boolean)) collector.add(line);
        updateCollection();
        if(collector.complete) showDecoded(collector.stream());
    }
} catch(ignored) {
    collector = new codec.Collector();
    localStorage.removeItem('microimgRead');
}
updateCollection();
updateButtons();
if(native) native.hardware();
else $('hardware').textContent = 'Vorschau';
