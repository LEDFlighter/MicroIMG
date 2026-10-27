(function(root, factory) {
    if(typeof module === 'object' && module.exports)
        module.exports = factory(require('./pako.js'));
    else
        root.MicroCodec = factory(root.pako);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(pako) {
    'use strict';
    const maxPixels = 1048576, maxText = 3000000, maxChunks = 4096;
    function check(condition, message) {
        if(!condition) throw new Error(message);
    }
    function dimensions(width, height) {
        check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 65535 && height <= 65535 && width * height <= maxPixels, 'Ungültige oder zu große Bildabmessungen (max. 1 Megapixel).');
    }
    function pack(pixels, bits) {
        const perByte = Math.floor(8 / bits), data = new Uint8Array(Math.ceil(pixels.length / perByte));
        for(let i = 0; i < pixels.length; i++)
            data[Math.floor(i / perByte)] |= pixels[i] << (8 - bits - i % perByte * bits);
        return data;
    }
    function unpack(data, count, bits) {
        const perByte = Math.floor(8 / bits), pixels = new Uint8Array(count), mask = (1 << bits) - 1;
        check(data.length === Math.ceil(count / perByte), 'Die Pixeldaten sind unvollständig oder beschädigt.');
        for(let i = 0; i < count; i++)
            pixels[i] = data[Math.floor(i / perByte)] >> (8 - bits - i % perByte * bits) & mask;
        return pixels;
    }
    function toBase64(data) {
        let text = '';
        for(let i = 0; i < data.length; i += 8192)
            text += String.fromCharCode(...data.subarray(i, i + 8192));
        return btoa(text);
    }
    function encode(width, height, pixels, levels, mode = 'ZIP') {
        dimensions(width, height);
        check(pixels.length === width * height && Number.isInteger(levels) && levels >= 2 && levels <= 16, 'Ungültige Bilddaten.');
        check(pixels.every(value => value >= 0 && value < levels), 'Ungültiger Grauwert.');
        if(mode === 'ZIP') {
            const bits = Math.ceil(Math.log2(levels)), packed = pack(pixels, bits), binary = new Uint8Array(5 + packed.length);
            const view = new DataView(binary.buffer);
            view.setUint16(0, width, false);
            view.setUint16(2, height, false);
            binary[4] = bits;
            binary.set(packed, 5);
            return 'ZIP:' + toBase64(pako.deflate(binary));
        }
        let body = '';
        if(mode === 'G4') {
            for(let i = 0; i < pixels.length; i++) {
                let count = 1;
                while(i + 1 < pixels.length && pixels[i + 1] === pixels[i] && count < 15) { count++; i++; }
                body += count.toString(16) + pixels[i].toString(16);
            }
        } else {
            check(mode === 'DP', 'Unbekanntes Bildformat.');
            body = Array.from(pixels, value => value.toString(16)).join('');
        }
        return `${mode}:W${width}H${height}:${body.toUpperCase()}`;
    }
    function decode(text) {
        check(typeof text === 'string' && text.length <= maxText, 'Der Datenstrom ist zu groß.');
        text = text.replace(/\s/g, '');
        let width, height, pixels, bits;
        if(text.startsWith('ZIP:')) {
            let base64 = text.slice(4);
            check(/^[A-Za-z0-9+/]+={0,2}$/.test(base64) && base64.length % 4 !== 1, 'Ungültiger Base64-Datenstrom.');
            base64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
            const compressed = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
            const inflater = new pako.Inflate({chunkSize: 16384});
            let size = 0;
            const blocks = [];
            inflater.onData = block => {
                size += block.length;
                check(size <= maxPixels + 5, 'Das entpackte Bild ist zu groß.');
                blocks.push(block);
            };
            check(inflater.push(compressed, true) && !inflater.err && inflater.ended, 'ZIP-Daten sind beschädigt oder unvollständig.');
            const binary = new Uint8Array(size);
            let offset = 0;
            for(const block of blocks) { binary.set(block, offset); offset += block.length; }
            check(binary.length >= 6, 'Der Bildkopf fehlt.');
            const view = new DataView(binary.buffer);
            width = view.getUint16(0, false);
            height = view.getUint16(2, false);
            dimensions(width, height);
            bits = binary[4];
            check(bits >= 1 && bits <= 4, 'Nicht unterstützte Bittiefe.');
            pixels = unpack(binary.subarray(5), width * height, bits);
        } else {
            const match = /^(DP|G4):W(\d+)H(\d+):([0-9a-f]+)$/i.exec(text);
            check(match, 'Kein gültiges MicroIMG-Bild (ZIP, G4 oder DP).');
            width = Number(match[2]); height = Number(match[3]);
            dimensions(width, height);
            const body = match[4];
            if(match[1].toUpperCase() === 'G4') {
                check(body.length % 2 === 0, 'Unvollständige RLE-Daten.');
                pixels = new Uint8Array(width * height);
                let offset = 0;
                for(let i = 0; i < body.length; i += 2) {
                    const count = parseInt(body[i], 16), value = parseInt(body[i + 1], 16);
                    check(count > 0 && offset + count <= pixels.length, 'Ungültige RLE-Länge.');
                    pixels.fill(value, offset, offset + count);
                    offset += count;
                }
                check(offset === pixels.length, 'Unvollständiges RLE-Bild.');
            } else {
                check(body.length === width * height, 'Unvollständiges Pixelbild.');
                pixels = Uint8Array.from(body, char => parseInt(char, 16));
            }
        }
        // The desktop decoder normalizes brightness to the brightest encoded pixel.
        let maxLevel = 0;
        for(const value of pixels) maxLevel = Math.max(maxLevel, value);
        return {width, height, pixels, maxLevel};
    }
    function ndefSize(text) {
        const size = new TextEncoder().encode(text).length;
        return size + (size + 3 <= 255 ? 7 : 10);
    }
    function split(text, capacity) {
        check(typeof text === 'string' && text.length > 0 && text.length <= maxText && /^[\x20-\x7e]+$/.test(text), 'Ungültiger Bilddatenstrom.');
        check(Number.isInteger(capacity) && capacity >= 32 && capacity <= 65536, 'Ungültige NDEF-Kapazität.');
        let total = 1, bodySize;
        while(true) {
            const headerSize = `P${total}/${total}#`.length;
            let low = 0, high = capacity;
            while(low < high) {
                const mid = Math.ceil((low + high) / 2), textSize = headerSize + mid;
                if(textSize + (textSize + 3 <= 255 ? 7 : 10) <= capacity) low = mid;
                else high = mid - 1;
            }
            bodySize = low;
            check(bodySize > 0, 'Der Tag ist zu klein.');
            const next = Math.ceil(text.length / bodySize);
            check(next <= maxChunks, 'Zu viele Tags. Bitte die Auflösung reduzieren.');
            if(next <= total) break;
            total = next;
        }
        const chunks = [];
        for(let offset = 0; offset < text.length; offset += bodySize)
            chunks.push(`P${chunks.length + 1}/${total}#${text.slice(offset, offset + bodySize)}`);
        check(chunks.length === total, 'Interner Fehler beim Aufteilen.');
        return chunks;
    }
    class Collector {
        constructor() { this.parts = new Map(); this.total = 0; this.size = 0; }
        add(raw) {
            check(typeof raw === 'string' && raw.length <= maxText, 'Der Chunk ist zu groß.');
            const match = /^P(\d+)\/(\d+)#([\s\S]+)$/i.exec(raw.trim());
            check(match, 'Kein MicroIMG-Chunk auf diesem Tag.');
            const index = Number(match[1]), total = Number(match[2]), body = match[3].replace(/\s/g, '');
            check(index >= 1 && index <= total && total <= maxChunks, 'Ungültige Chunk-Nummer.');
            check(!this.total || this.total === total, 'Diese Tags gehören zu unterschiedlichen Serien. Bitte zuerst zurücksetzen.');
            check(!this.parts.has(index) || this.parts.get(index) === body, 'Widersprüchliche Daten für denselben Chunk. Bitte zuerst zurücksetzen.');
            if(!this.parts.has(index)) {
                check(this.size + body.length <= maxText, 'Die Serie ist zu groß.');
                this.parts.set(index, body);
                this.size += body.length;
            }
            this.total = total;
            return this.complete;
        }
        get complete() { return this.total > 0 && this.parts.size === this.total; }
        get missing() {
            const result = [];
            for(let i = 1; i <= this.total; i++) if(!this.parts.has(i)) result.push(i);
            return result;
        }
        stream() {
            check(this.complete, `Es fehlen noch ${this.total - this.parts.size} Tags.`);
            return Array.from({length: this.total}, (_, i) => this.parts.get(i + 1)).join('');
        }
        lines() {
            return Array.from(this.parts.keys()).sort((a, b) => a - b).map(index => `P${index}/${this.total}#${this.parts.get(index)}`).join('\n');
        }
    }
    function importText(text) {
        check(typeof text === 'string' && text.length <= maxText, 'Die MicroIMG-Datei ist zu groß (max. 3 MB).');
        const compact = text.replace(/\s/g, '');
        check(compact.length > 0, 'Die MicroIMG-Datei ist leer.');
        let stream;
        if(/^(ZIP:|G4:|DP:)/.test(compact)) stream = compact;
        else {
            const pending = new Collector();
            for(const part of compact.split(/(?=P\d+\/\d+#)/i).filter(Boolean)) pending.add(part);
            stream = pending.stream();
        }
        return {stream, image: decode(stream)};
    }
    return {encode, decode, split, ndefSize, Collector, pack, unpack, importText};
});
