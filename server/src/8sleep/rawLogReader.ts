// Reads the outer framing of the Pod's /persistent/*.RAW capture files, the
// same way biometrics/load_raw_files.py::_read_raw_record does.
//
// A RAW file is a run of outer CBOR records, `{ "seq": <uint>, "data": <bytes> }`,
// with NUL padding between them. The inner bytes are one or more CBOR maps,
// each typed by a `type` field: 'log', 'piezo-dual', 'capSense' and so on
// (see docs/EIGHT_SLEEP_PROTOCOL.md).
//
// Only the inner bytes and their length come back. 'piezo-dual' records are
// most of the file and a caller that only wants 'log' records skips them by
// length without decoding them. The outer wrapper is parsed by hand from a
// Buffer so the byte offset stays exact; a streaming CBOR decoder reads ahead
// in blocks and loses it.

export interface RawRecord {
  // The inner bytes, the value of the outer "data" key. An empty placeholder
  // record comes back with a zero-length buffer.
  data: Buffer;
  // The offset just after this record, where the next read starts.
  nextOffset: number;
}

// Not enough bytes left for a whole record. A tailer waits for more and reads
// again from the last complete record.
export class RawTruncatedError extends Error {
  constructor() {
    super('Truncated RAW record');
    this.name = 'RawTruncatedError';
  }
}

// Bytes that are not a record. A tailer skips forward to the next record start.
export class RawFramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawFramingError';
  }
}

const OUTER_MAP = 0xa2; // map(2)
const KEY_SEQ = Buffer.from([0x63, 0x73, 0x65, 0x71]); // text(3) "seq"
const KEY_DATA = Buffer.from([0x64, 0x64, 0x61, 0x74, 0x61]); // text(4) "data"

function need(buffer: Buffer, offset: number, count: number): void {
  if (offset + count > buffer.length) throw new RawTruncatedError();
}

// Steps over a CBOR unsigned integer (the seq value); its value is not needed.
function skipUint(buffer: Buffer, offset: number): number {
  need(buffer, offset, 1);
  const info = buffer[offset] & 0x1f;
  offset += 1;
  if (info <= 0x17) return offset;
  if (info === 0x18) { need(buffer, offset, 1); return offset + 1; }
  if (info === 0x19) { need(buffer, offset, 2); return offset + 2; }
  if (info === 0x1a) { need(buffer, offset, 4); return offset + 4; }
  if (info === 0x1b) { need(buffer, offset, 8); return offset + 8; }
  throw new RawFramingError(`Unexpected seq encoding: 0x${buffer[offset - 1].toString(16)}`);
}

/**
 * Parses the outer {seq, data} record at `offset`, after any NUL padding.
 * Returns null when only padding is left. Throws RawTruncatedError when the
 * buffer ends inside the record and RawFramingError when the bytes are not a
 * record.
 */
export function readRawRecord(buffer: Buffer, offset: number): RawRecord | null {
  while (offset < buffer.length && buffer[offset] === 0x00) offset += 1;
  if (offset >= buffer.length) return null;

  if (buffer[offset] !== OUTER_MAP) {
    throw new RawFramingError(`Expected outer map 0xa2, got 0x${buffer[offset].toString(16)}`);
  }
  offset += 1;

  need(buffer, offset, KEY_SEQ.length);
  if (!buffer.subarray(offset, offset + KEY_SEQ.length).equals(KEY_SEQ)) {
    throw new RawFramingError('Expected seq key');
  }
  offset += KEY_SEQ.length;

  offset = skipUint(buffer, offset);

  need(buffer, offset, KEY_DATA.length);
  if (!buffer.subarray(offset, offset + KEY_DATA.length).equals(KEY_DATA)) {
    throw new RawFramingError('Expected data key');
  }
  offset += KEY_DATA.length;

  // The byte string's length header; only its additional information is read.
  need(buffer, offset, 1);
  const info = buffer[offset] & 0x1f;
  offset += 1;
  let length: number;
  if (info <= 23) {
    length = info;
  } else if (info === 24) {
    need(buffer, offset, 1);
    length = buffer[offset];
    offset += 1;
  } else if (info === 25) {
    need(buffer, offset, 2);
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (info === 26) {
    need(buffer, offset, 4);
    length = buffer.readUInt32BE(offset);
    offset += 4;
  } else {
    throw new RawFramingError(`Unsupported length encoding: ${info}`);
  }

  need(buffer, offset, length);
  const data = buffer.subarray(offset, offset + length);
  offset += length;
  return { data, nextOffset: offset };
}
