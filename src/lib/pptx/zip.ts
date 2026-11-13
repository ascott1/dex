// A store-only ZIP writer (§9 Phase 11 task 1): local headers, a central
// directory and an end record. Method 0 (no compression), CRC-32, UTF-8 names,
// a fixed date, so the same input always gives the same bytes. Pure: no DOM
// beyond TextEncoder, no `node:*`.

export type ZipEntry = readonly [name: string, content: string | Uint8Array];

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const UTF8_NAMES = 0x0800;   // general-purpose bit 11
const DOS_DATE = 0x0021;     // 1980-01-01
const DOS_TIME = 0;
const VERSION = 20;

/** The archive's bytes. Entries are written in the order given. */
export function zip(files: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true);              // method: stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);   // compressed size
    local.setUint32(22, data.length, true);   // size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);             // extra field length
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, VERSION, true);          // made by
    dir.setUint16(6, VERSION, true);          // needed
    dir.setUint16(8, UTF8_NAMES, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, DOS_TIME, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    // extra, comment, disk, internal and external attributes stay 0
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  const out = new Uint8Array(offset + dirSize + 22);
  let at = 0;
  for (const chunk of [...chunks, ...central, new Uint8Array(end.buffer)]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
