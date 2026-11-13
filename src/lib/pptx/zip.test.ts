import { describe, expect, it } from 'vitest';
import { crc32, zip } from './zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Entry {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
}

/** A small store-only reader: walks the central directory the end record points to. */
function unzip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    // The local header repeats the name and sizes, then the bytes follow.
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(size);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.push({ name, data: bytes.subarray(start, start + size), crc, flags, method });
    at += 46 + nameLength + extra;
  }
  expect(at).toBe(end);
  return entries;
}

describe('crc32', () => {
  it('matches the check value of the standard', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('is 0 for no bytes', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zip', () => {
  const binary = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256);
  const files: [string, string | Uint8Array][] = [
    ['[Content_Types].xml', '<Types/>'],
    ['ppt/slides/slide1.xml', '<a>text with ü and 字</a>'],
    ['ppt/media/image1.png', binary],
    ['empty.txt', ''],
  ];

  it('reads back: names in order, bytes equal, CRCs right, stored', () => {
    const entries = unzip(zip(files));
    expect(entries.map((e) => e.name)).toEqual(files.map(([name]) => name));
    for (const [i, [, content]] of files.entries()) {
      const expected = typeof content === 'string' ? encoder.encode(content) : content;
      const entry = entries[i]!;
      expect([...entry.data]).toEqual([...expected]);
      expect(entry.crc).toBe(crc32(expected));
      expect(entry.method).toBe(0);
    }
  });

  it('keeps a non-ASCII name and flags names as UTF-8', () => {
    const entries = unzip(zip([['décks/名前 ✓.txt', 'x']]));
    expect(entries[0]!.name).toBe('décks/名前 ✓.txt');
    expect(entries[0]!.flags & 0x0800).toBe(0x0800);
  });

  it('gives the same bytes for the same input', () => {
    expect([...zip(files)]).toEqual([...zip(files)]);
  });

  it('writes an empty archive as a bare end record', () => {
    const bytes = zip([]);
    expect(bytes.length).toBe(22);
    expect(unzip(bytes)).toEqual([]);
  });
});
