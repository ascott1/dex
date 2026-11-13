import { describe, expect, test } from 'vitest';
import { createClock, newer } from './stamp';

describe('newer', () => {
  test('a higher seq wins', () => {
    expect(newer({ seq: 2, origin: 9, id: 'b' }, { seq: 1, origin: 1, id: 'a' })).toBe(true);
    expect(newer({ seq: 1, origin: 1, id: 'a' }, { seq: 2, origin: 9, id: 'b' })).toBe(false);
  });

  test('on a tie the older window wins, then the smaller id', () => {
    expect(newer({ seq: 3, origin: 1, id: 'z' }, { seq: 3, origin: 2, id: 'a' })).toBe(true);
    expect(newer({ seq: 3, origin: 2, id: 'a' }, { seq: 3, origin: 1, id: 'z' })).toBe(false);
    expect(newer({ seq: 3, origin: 1, id: 'a' }, { seq: 3, origin: 1, id: 'b' })).toBe(true);
  });

  test('a stamp is not newer than itself', () => {
    const s = { seq: 4, origin: 1, id: 'a' };
    expect(newer(s, { ...s })).toBe(false);
  });

  test('exactly one of two different stamps is newer', () => {
    const stamps = [
      { seq: 0, origin: 1, id: 'a' }, { seq: 0, origin: 2, id: 'b' },
      { seq: 1, origin: 2, id: 'a' }, { seq: 1, origin: 1, id: 'c' }, { seq: 1, origin: 1, id: 'd' },
    ];
    for (const a of stamps) for (const b of stamps) if (a !== b) expect(newer(a, b)).not.toBe(newer(b, a));
  });
});

describe('createClock', () => {
  test('two windows that change the same value at once settle on one winner', () => {
    const older = createClock(100, 'x');
    const younger = createClock(200, 'y');
    const a = older.tick();
    const b = younger.tick();
    // Each receives the other's change and keeps whichever is newer.
    const keptByOlder = newer(b, a) ? b : a;
    const keptByYounger = newer(a, b) ? a : b;
    expect(keptByOlder).toEqual(keptByYounger);
  });

  test('a change made after seeing a stamp is newer than it', () => {
    const one = createClock(100, 'x');
    const two = createClock(200, 'y');
    for (let i = 0; i < 5; i++) one.tick();
    const seen = one.tick();
    two.see(seen);
    expect(newer(two.tick(), seen)).toBe(true);
  });

  test('an untouched value loses to any change, and an older window wins between untouched values', () => {
    const older = createClock(100, 'x');
    const younger = createClock(200, 'y');
    expect(newer(younger.tick(), older.initial())).toBe(true);
    expect(newer(older.initial(), younger.initial())).toBe(true);
  });
});
