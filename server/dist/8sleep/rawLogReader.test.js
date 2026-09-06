import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import cbor from 'cbor';
import { readRawRecord, RawTruncatedError, RawFramingError, } from './rawLogReader.js';
// Build one outer {seq, data} record with the exact framing _read_raw_record
// (biometrics/load_raw_files.py) expects: 0xa2 map, text(3)"seq", uint seq,
// text(4)"data", byte-string(len) data. We hand-frame the outer wrapper so the
// fixtures don't depend on the cbor lib's map key ordering; `data` is arbitrary
// inner bytes (usually a CBOR-encoded log/piezo record).
function encodeUint(n) {
    if (n <= 0x17)
        return Buffer.from([n]);
    if (n <= 0xff)
        return Buffer.from([0x18, n]);
    if (n <= 0xffff) {
        const b = Buffer.alloc(3);
        b[0] = 0x19;
        b.writeUInt16BE(n, 1);
        return b;
    }
    const b = Buffer.alloc(5);
    b[0] = 0x1a;
    b.writeUInt32BE(n, 1);
    return b;
}
function encodeByteStringHeader(len) {
    if (len <= 0x17)
        return Buffer.from([0x40 | len]);
    if (len <= 0xff)
        return Buffer.from([0x58, len]);
    if (len <= 0xffff) {
        const b = Buffer.alloc(3);
        b[0] = 0x59;
        b.writeUInt16BE(len, 1);
        return b;
    }
    const b = Buffer.alloc(5);
    b[0] = 0x5a;
    b.writeUInt32BE(len, 1);
    return b;
}
function frameRecord(seq, data) {
    const parts = [];
    parts.push(Buffer.from([0xa2])); // map(2)
    parts.push(Buffer.from([0x63, 0x73, 0x65, 0x71])); // text(3) "seq"
    parts.push(encodeUint(seq));
    parts.push(Buffer.from([0x64, 0x64, 0x61, 0x74, 0x61])); // text(4) "data"
    parts.push(encodeByteStringHeader(data.length));
    parts.push(data);
    return Buffer.concat(parts);
}
const logRecord = (msg) => cbor.encode({ type: 'log', ts: 1700000000, level: 'info', msg, seq: 1 });
// A stand-in for a piezo-dual record: large payload we must never decode.
const bigPiezo = () => {
    const samples = new Int32Array(500).fill(-160000);
    return cbor.encode({ type: 'piezo-dual', ts: 1, freq: 500, left1: Buffer.from(samples.buffer) });
};
describe('rawLogReader.readRawRecord', () => {
    it('parses one framed log record and reports the next offset', () => {
        const inner = logRecord('[tca8418R] gpi press 97');
        const buf = frameRecord(42, inner);
        const rec = readRawRecord(buf, 0);
        assert.ok(rec);
        assert.equal(rec.nextOffset, buf.length);
        assert.deepEqual(Buffer.from(rec.data), inner);
        const decoded = cbor.decodeFirstSync(rec.data);
        assert.equal(decoded.type, 'log');
        assert.equal(decoded.msg, '[tca8418R] gpi press 97');
    });
    it('skips NUL padding between records', () => {
        const a = frameRecord(1, logRecord('[tca8418L] gpi press 98'));
        const pad = Buffer.from([0, 0, 0, 0]);
        const b = frameRecord(2, logRecord('[tca8418L] gpi release 98'));
        const buf = Buffer.concat([a, pad, b]);
        const first = readRawRecord(buf, 0);
        assert.equal(cbor.decodeFirstSync(first.data).msg, '[tca8418L] gpi press 98');
        // Next read starts right after the first record; padding is skipped.
        const second = readRawRecord(buf, first.nextOffset);
        assert.equal(cbor.decodeFirstSync(second.data).msg, '[tca8418L] gpi release 98');
        assert.equal(second.nextOffset, buf.length);
    });
    it('walks a mixed stream of piezo and log records without decoding piezo', () => {
        const parts = [
            frameRecord(1, bigPiezo()),
            frameRecord(2, logRecord('[tca8418R] gpi press 99')),
            frameRecord(3, bigPiezo()),
        ];
        const buf = Buffer.concat(parts);
        const found = [];
        let offset = 0;
        // The reader hands back inner bytes + length; the CALLER decides to decode
        // only small records. Here we assert we can walk past the big ones cheaply.
        for (;;) {
            const rec = readRawRecord(buf, offset);
            if (rec === null)
                break;
            offset = rec.nextOffset;
            if (rec.data.length <= 512) {
                found.push(cbor.decodeFirstSync(rec.data).msg);
            }
            if (offset >= buf.length)
                break;
        }
        assert.deepEqual(found, ['[tca8418R] gpi press 99']);
    });
    it('throws RawTruncatedError when the buffer ends mid-record', () => {
        const full = frameRecord(1, logRecord('[buttons] top button held for 320ms (abort)'));
        // Cut off the last few bytes of the data payload.
        const truncated = full.subarray(0, full.length - 5);
        assert.throws(() => readRawRecord(truncated, 0), RawTruncatedError);
    });
    it('throws RawFramingError on a bad leading byte so the caller can resync', () => {
        const good = frameRecord(1, logRecord('[tca8418R] gpi press 97'));
        // Prepend a junk byte that is neither NUL nor 0xa2.
        const corrupt = Buffer.concat([Buffer.from([0x55]), good]);
        assert.throws(() => readRawRecord(corrupt, 0), RawFramingError);
        // Skipping the junk byte (resync) then parses the real record.
        const rec = readRawRecord(corrupt, 1);
        assert.equal(cbor.decodeFirstSync(rec.data).msg, '[tca8418R] gpi press 97');
    });
    it('returns null when only padding remains', () => {
        const buf = Buffer.from([0, 0, 0]);
        assert.equal(readRawRecord(buf, 0), null);
    });
    it('handles a length-24 (one-byte length) byte string header', () => {
        // A msg long enough to push the inner byte-string length over 23 bytes so
        // the 0x58 one-byte-length header path is exercised.
        const inner = logRecord('[buttons] middle button held for 176ms (abort)');
        assert.ok(inner.length > 23);
        const buf = frameRecord(7, inner);
        const rec = readRawRecord(buf, 0);
        assert.equal(cbor.decodeFirstSync(rec.data).msg, '[buttons] middle button held for 176ms (abort)');
    });
});
//# sourceMappingURL=rawLogReader.test.js.map