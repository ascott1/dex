// A store-only ZIP reader for the end-to-end tests (PLAN.md §9 Phase 11): the
// .pptx the app writes is an uncompressed archive, so its parts can be read
// straight out of the downloaded bytes. It walks the central directory and
// checks each entry against its local header and its CRC.

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The archive's entries, in the order they were written. Throws on anything that is not a sound store-only ZIP. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const end = bytes.length - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('no end-of-central-directory record');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error(`entry ${i}: bad central header`);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (method !== 0) throw new Error(`${name}: compressed (method ${method})`);
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`${name}: bad local header`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    if (entries.has(name)) throw new Error(`${name}: listed twice`);
    entries.set(name, data);
    at += 46 + nameLength + skip;
  }
  if (at !== end) throw new Error('the central directory does not end at the end record');
  return entries;
}
