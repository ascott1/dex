// Last-writer-wins ordering for values synced between windows (Phase 8).
// See `SyncStamp` in shared/types.ts.

import type { SyncStamp } from '$shared/types';

/** True when `a` should replace a value stamped `b`. */
export function newer(a: SyncStamp, b: SyncStamp): boolean {
  if (a.seq !== b.seq) return a.seq > b.seq;
  if (a.origin !== b.origin) return a.origin < b.origin;
  return a.id < b.id;
}

/** A Lamport clock for one window. */
export function createClock(origin: number, id: string) {
  let seq = 0;
  return {
    /** The stamp of a value this window holds but never changed: loses to any change. */
    initial(): SyncStamp {
      return { seq: 0, origin, id };
    },
    /** Stamp a local change. */
    tick(): SyncStamp {
      seq += 1;
      return { seq, origin, id };
    },
    /** Note a stamp from another window, so the next local change is newer than it. */
    see(stamp: SyncStamp): void {
      if (stamp.seq > seq) seq = stamp.seq;
    },
  };
}
