const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');
const codec = require('../app/src/main/assets/codec.js');
const desktopSource = fs.readFileSync(require('node:path').join(__dirname, '../../static/MicroIMG_script.js'), 'utf8');
const desktop = {};
vm.createContext(desktop);
vm.runInContext(desktopSource.slice(desktopSource.indexOf('function packPixels('), desktopSource.indexOf('async function compressData(')), desktop);
let randomState = 298765;
function random() { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState; }

test('ZIP is binary compatible with the existing desktop packer for every supported gray depth', () => {
    for(let levels = 2; levels <= 16; levels++) {
        for(const [width, height] of [[1, 1], [7, 5], [64, 48], [31, 79]]) {
            const pixels = Uint8Array.from({length: width * height}, () => random() % levels);
            const bits = Math.ceil(Math.log2(levels));
            const encoded = codec.encode(width, height, pixels, levels);
            const actual = zlib.inflateSync(Buffer.from(encoded.slice(4), 'base64'));
            const expected = desktop.createZipPayloadBuffer(width, height, bits, desktop.packPixels(pixels, bits));
            assert.deepEqual(actual, Buffer.from(expected));
            const result = codec.decode(encoded);
            assert.equal(result.width, width); assert.equal(result.height, height);
            assert.deepEqual(result.pixels, pixels);
            assert.deepEqual(Array.from(desktop.unpackPixels(actual.subarray(5), width * height, bits)), Array.from(pixels));
        }
    }
});
test('reads independent zlib fixture using the original five-byte header', () => {
    const encoded = 'ZIP:' + zlib.deflateSync(Buffer.from([0, 3, 0, 2, 2, 0x1b, 0x90])).toString('base64');
    const result = codec.decode(encoded);
    assert.deepEqual(Array.from(result.pixels), [0, 1, 2, 3, 2, 1]);
});
test('DP preserves hexadecimal values and G4 handles runs longer than fifteen pixels', () => {
    const pixels = Uint8Array.from([...Array(38).fill(15), 0, 10, 13, 14, 1, 2, 3, 4, 5]);
    for(const mode of ['G4', 'DP']) {
        const result = codec.decode(codec.encode(47, 1, pixels, 16, mode));
        assert.deepEqual(result.pixels, pixels);
    }
    assert.equal(codec.encode(4, 1, Uint8Array.from([10, 11, 12, 15]), 16, 'DP'), 'DP:W4H1:ABCF');
});
test('exact NDEF size includes UTF-8, language, short and long record headers', () => {
    assert.equal(codec.ndefSize('a'.repeat(252)), 259);
    assert.equal(codec.ndefSize('a'.repeat(253)), 263);
    assert.equal(codec.ndefSize('ä'), 9);
});
test('chunk headers and NDEF overhead fit capacity through digit and record transitions', () => {
    for(const capacity of [32, 41, 121, 137, 252, 259, 260, 262, 263, 264, 492, 868, 2000, 65536]) {
        for(const size of [1, 15, 250, 251, 252, 253, 800, 1800, 9000, ...(capacity >= 41 ? [70000] : [])]) {
            const stream = 'ZIP:' + 'A'.repeat(size), chunks = codec.split(stream, capacity);
            const collector = new codec.Collector();
            for(const chunk of chunks.toReversed()) {
                assert.ok(codec.ndefSize(chunk) <= capacity, `capacity=${capacity} chunk=${chunk.length}`);
                collector.add(chunk);
            }
            assert.equal(collector.stream(), stream);
        }
    }
});
test('out-of-order scans, duplicates, missing chunks and mixed batches', () => {
    const collector = new codec.Collector();
    assert.equal(collector.add('P3/3#ijkl'), false);
    collector.add('P3/3#ijkl');
    assert.equal(collector.parts.size, 1);
    assert.deepEqual(collector.missing, [1, 2]);
    assert.throws(() => collector.stream());
    assert.throws(() => collector.add('P1/2#ZIP:abc'));
    collector.add('P1/3#ZIP:abcd');
    assert.throws(() => collector.add('P1/3#ZIP:xxxx'));
    assert.equal(collector.add('P2/3#efgh'), true);
    assert.equal(collector.stream(), 'ZIP:abcdefghijkl');
    assert.equal(collector.lines(), 'P1/3#ZIP:abcd\nP2/3#efgh\nP3/3#ijkl');
});
test('rejects damaged, truncated, oversized and hostile input without allocating unbounded images', () => {
    for(const value of ['ZIP:@@@@', 'ZIP:AAAA', 'ZIP:A', 'DP:W0H2:AA', 'DP:W99999H99999:AA', 'G4:W2H2:FF', 'G4:W1H1:00', 'G4:W1H1:A', 'DP:W2H2:01'])
        assert.throws(() => codec.decode(value), value);
    const valid = codec.encode(10, 10, new Uint8Array(100), 2);
    assert.throws(() => codec.decode(valid.slice(0, -8)));
    for(const header of ['P0/1#A', 'P2/1#A', 'P1/0#A', 'P1/999999999#A', 'hello', 'P1/1#'])
        assert.throws(() => new codec.Collector().add(header), header);
    const bomb = 'ZIP:' + zlib.deflateSync(Buffer.alloc(2000000)).toString('base64');
    assert.throws(() => codec.decode(bomb));
});
test('all-black images retain zero brightness', () => {
    assert.equal(codec.decode(codec.encode(2, 2, new Uint8Array(4), 16)).maxLevel, 0);
});
test('saved MicroIMG files import all formats without changing encoded image data', () => {
    const pixels = Uint8Array.from({length: 64 * 48}, () => random() % 16);
    for(const mode of ['ZIP', 'G4', 'DP']) {
        const original = codec.encode(64, 48, pixels, 16, mode);
        const chunks = codec.split(original, 137);
        const saved = '\ufeff  ' + chunks.toReversed().map(chunk => chunk.slice(0, 20) + '\r\n' + chunk.slice(20)).join('\r\n  ') + '\n';
        for(const text of [original, saved]) {
            const imported = codec.importText(text);
            assert.equal(imported.stream, original);
            assert.deepEqual(imported.image.pixels, pixels);
            const redistributed = codec.split(imported.stream, 868);
            assert.equal(codec.importText(redistributed.join('\n')).stream, original);
        }
    }
});
test('saved file import rejects empty, corrupt, missing and conflicting chunks', () => {
    for(const text of ['', '\ufeff \r\n', 'not an image', 'ZIP:@@@@', 'P1/2#ZIP:AAAA', 'P1/1#DP:W3H1:AF', 'P1/2#DP:W1H1:A\nP1/2#DP:W1H1:B', 'P1/2#DP:W1H1:A\nP2/3#B'])
        assert.throws(() => codec.importText(text), text);
    assert.throws(() => codec.importText('A'.repeat(3000001)));
});
