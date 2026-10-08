import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import cbor from 'cbor';

import { readRawRecord, RawTruncatedError, RawFramingError } from './rawLogReader.js';

// Frames one outer {seq, data} record the way _read_raw_record in
// biometrics/load_raw_files.py expects it: 0xa2 map, text(3) "seq", uint,
// text(4) "data", byte string. Framed by hand so the fixtures do not depend
// on the cbor library's key order.
function encodeUint(value: number): Buffer {
  if (value <= 0x17) return Buffer.from([value]);
  if (value <= 0xff) return Buffer.from([0x18, value]);
  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0x19; buffer.writeUInt16BE(value, 1); return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = 0x1a; buffer.writeUInt32BE(value, 1); return buffer;
}

function encodeByteStringHeader(length: number): Buffer {
  if (length <= 0x17) return Buffer.from([0x40 | length]);
  if (length <= 0xff) return Buffer.from([0x58, length]);
  if (length <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0x59; buffer.writeUInt16BE(length, 1); return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = 0x5a; buffer.writeUInt32BE(length, 1); return buffer;
}

function frameRecord(seq: number, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa2]),
    Buffer.from([0x63, 0x73, 0x65, 0x71]),
    encodeUint(seq),
    Buffer.from([0x64, 0x64, 0x61, 0x74, 0x61]),
    encodeByteStringHeader(data.length),
    data,
  ]);
}

const logRecord = (msg: string): Buffer =>
  cbor.encode({ type: 'log', ts: 1700000000, level: 'info', msg, seq: 1 });

const message = (data: Buffer): string => (cbor.decodeFirstSync(data) as { msg: string }).msg;

// Stands in for a piezo-dual record: a large payload never to be decoded.
const bigPiezo = (): Buffer => {
  const samples = new Int32Array(500).fill(-160000);
  return cbor.encode({ type: 'piezo-dual', ts: 1, freq: 500, left1: Buffer.from(samples.buffer) });
};

describe('readRawRecord', () => {
  it('parses one framed log record and reports the next offset', () => {
    const inner = logRecord('[tca8418R] gpi press 97');
    const buffer = frameRecord(42, inner);

    const record = readRawRecord(buffer, 0);
    assert.ok(record);
    assert.equal(record.nextOffset, buffer.length);
    assert.deepEqual(Buffer.from(record.data), inner);
    const decoded = cbor.decodeFirstSync(record.data) as { type: string; msg: string };
    assert.equal(decoded.type, 'log');
    assert.equal(decoded.msg, '[tca8418R] gpi press 97');
  });

  it('skips NUL padding between records', () => {
    const first = frameRecord(1, logRecord('[tca8418L] gpi press 98'));
    const padding = Buffer.from([0, 0, 0, 0]);
    const second = frameRecord(2, logRecord('[tca8418L] gpi release 98'));
    const buffer = Buffer.concat([first, padding, second]);

    const one = readRawRecord(buffer, 0);
    assert.ok(one);
    assert.equal(message(one.data), '[tca8418L] gpi press 98');
    const two = readRawRecord(buffer, one.nextOffset);
    assert.ok(two);
    assert.equal(message(two.data), '[tca8418L] gpi release 98');
    assert.equal(two.nextOffset, buffer.length);
  });

  it('walks a mix of piezo and log records without decoding the piezo ones', () => {
    const buffer = Buffer.concat([
      frameRecord(1, bigPiezo()),
      frameRecord(2, logRecord('[tca8418R] gpi press 99')),
      frameRecord(3, bigPiezo()),
    ]);

    const found: string[] = [];
    let offset = 0;
    for (;;) {
      const record = readRawRecord(buffer, offset);
      if (record === null) break;
      offset = record.nextOffset;
      if (record.data.length <= 512) found.push(message(record.data));
      if (offset >= buffer.length) break;
    }
    assert.deepEqual(found, ['[tca8418R] gpi press 99']);
  });

  it('throws RawTruncatedError when the buffer ends inside a record', () => {
    const whole = frameRecord(1, logRecord('[buttons] top button held for 320ms (abort)'));
    assert.throws(() => readRawRecord(whole.subarray(0, whole.length - 5), 0), RawTruncatedError);
  });

  it('throws RawFramingError on a stray byte so the caller can resync', () => {
    const good = frameRecord(1, logRecord('[tca8418R] gpi press 97'));
    const corrupt = Buffer.concat([Buffer.from([0x55]), good]);
    assert.throws(() => readRawRecord(corrupt, 0), RawFramingError);
    const record = readRawRecord(corrupt, 1);
    assert.ok(record);
    assert.equal(message(record.data), '[tca8418R] gpi press 97');
  });

  it('returns null when only padding remains', () => {
    assert.equal(readRawRecord(Buffer.from([0, 0, 0]), 0), null);
  });

  it('reads a one-byte length header', () => {
    const inner = logRecord('[buttons] middle button held for 176ms (abort)');
    assert.ok(inner.length > 23);
    const record = readRawRecord(frameRecord(7, inner), 0);
    assert.ok(record);
    assert.equal(message(record.data), '[buttons] middle button held for 176ms (abort)');
  });

  it('reads a two-byte length header', () => {
    const inner = Buffer.concat(Array.from({ length: 12 }, (_, index) => logRecord(`[therm] tick ${index} ${'x'.repeat(40)}`)));
    assert.ok(inner.length > 0xff);
    const record = readRawRecord(frameRecord(8, inner), 0);
    assert.ok(record);
    assert.equal(record.data.length, inner.length);
  });
});
