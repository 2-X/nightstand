// Minimal reader for the Pod's /persistent/*.RAW capture files, ported from
// biometrics/load_raw_files.py::_read_raw_record.
//
// A RAW file is a concatenation of outer CBOR records:
//   { "seq": <uint>, "data": <bytes> }
// with NUL padding between records. The inner `data` bytes are themselves a
// CBOR map, typed by a `type` field: 'log', 'piezo-dual', 'capSense', etc.
//
// We only care about 'log' records (the button presses land there as msg
// strings). Piezo-dual records are the bulk of the bytes (~2700 each) and we
// MUST NOT decode them - this reader hands back the inner bytes plus their
// length so the caller can skip large payloads by length alone and never
// buffer a piezo sample array.
//
// We cannot use a streaming CBOR library the way the Python file explains: the
// C cbor2 extension reads in 4096-byte chunks and desyncs the file offset. So,
// like the Python, we parse the fixed outer {seq,data} wrapper by hand from a
// Buffer and keep an exact byte offset.

export interface RawRecord {
  // Inner CBOR bytes (the value of the outer "data" key). Empty-placeholder
  // records (data = b'') are reported with a zero-length buffer.
  data: Buffer;
  // Offset in the source buffer immediately AFTER this record, so the caller
  // can persist a resume point.
  nextOffset: number;
}

// Raised when there aren't enough bytes left in the buffer to complete a
// record. The tailer treats this as "wait for more appended bytes" and resumes
// from the last fully-parsed offset.
export class RawTruncatedError extends Error {
  constructor() {
    super('Truncated RAW record');
    this.name = 'RawTruncatedError';
  }
}

// Raised on a byte pattern that is not a valid outer record framing. The tailer
// resyncs by scanning forward to the next plausible record start.
export class RawFramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawFramingError';
  }
}

const OUTER_MAP = 0xa2; // map(2)
// text(3) "seq"
const KEY_SEQ = Buffer.from([0x63, 0x73, 0x65, 0x71]);
// text(4) "data"
const KEY_DATA = Buffer.from([0x64, 0x64, 0x61, 0x74, 0x61]);

function need(buf: Buffer, offset: number, n: number): void {
  if (offset + n > buf.length) throw new RawTruncatedError();
}

// Consume a CBOR uint additional-info field (used for the seq value). Returns
// the offset after the encoded integer. We don't need the value.
function skipUint(buf: Buffer, offset: number): number {
  need(buf, offset, 1);
  const ai = buf[offset] & 0x1f;
  offset += 1;
  if (ai <= 0x17) return offset;
  if (ai === 0x18) { need(buf, offset, 1); return offset + 1; }
  if (ai === 0x19) { need(buf, offset, 2); return offset + 2; }
  if (ai === 0x1a) { need(buf, offset, 4); return offset + 4; }
  if (ai === 0x1b) { need(buf, offset, 8); return offset + 8; }
  throw new RawFramingError(`Unexpected seq encoding: 0x${buf[offset - 1].toString(16)}`);
}

/**
 * Parse one outer {seq, data} record starting at `offset`, skipping any NUL
 * padding first. Returns the inner data bytes and the next offset.
 *
 * Throws RawTruncatedError if the buffer ends mid-record (caller waits for
 * more bytes), RawFramingError on a malformed record (caller resyncs). If only
 * padding remains, returns null.
 */
export function readRawRecord(buf: Buffer, offset: number): RawRecord | null {
  // Skip NUL padding between records.
  while (offset < buf.length && buf[offset] === 0x00) offset += 1;
  if (offset >= buf.length) return null;

  if (buf[offset] !== OUTER_MAP) {
    throw new RawFramingError(`Expected outer map 0xa2, got 0x${buf[offset].toString(16)}`);
  }
  offset += 1;

  need(buf, offset, KEY_SEQ.length);
  if (!buf.subarray(offset, offset + KEY_SEQ.length).equals(KEY_SEQ)) {
    throw new RawFramingError('Expected seq key');
  }
  offset += KEY_SEQ.length;

  offset = skipUint(buf, offset);

  need(buf, offset, KEY_DATA.length);
  if (!buf.subarray(offset, offset + KEY_DATA.length).equals(KEY_DATA)) {
    throw new RawFramingError('Expected data key');
  }
  offset += KEY_DATA.length;

  // Byte-string length header. Major type is byte-string (0x40); we only read
  // the additional-info to get the length, matching the Python.
  need(buf, offset, 1);
  const ai = buf[offset] & 0x1f;
  offset += 1;
  let length: number;
  if (ai <= 23) {
    length = ai;
  } else if (ai === 24) {
    need(buf, offset, 1);
    length = buf[offset];
    offset += 1;
  } else if (ai === 25) {
    need(buf, offset, 2);
    length = buf.readUInt16BE(offset);
    offset += 2;
  } else if (ai === 26) {
    need(buf, offset, 4);
    length = buf.readUInt32BE(offset);
    offset += 4;
  } else {
    throw new RawFramingError(`Unsupported length encoding: ${ai}`);
  }

  need(buf, offset, length);
  const data = buf.subarray(offset, offset + length);
  offset += length;
  return { data, nextOffset: offset };
}
