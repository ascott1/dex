// Drawings and sticky notes for the open deck. Phase 6 fills this in:
// load `decks/<slug>/marks.json`, debounced PUT in dev, localStorage in a
// static build, undo/redo stacks of inverse operations (§9 Phase 6).

import type { Marks, SlideMarks } from '$shared/types';

export const marks = $state({
  slug: null as string | null,
  data: { version: 1, slides: {} } as Marks,
  undo: [] as unknown[],
  redo: [] as unknown[],
});

export const EMPTY_SLIDE_MARKS: SlideMarks = { strokes: [], notes: [] };

/** Phase 6. */
export async function loadMarks(_slug: string): Promise<void> {}

/** Phase 6. */
export function saveMarks(): void {}

/**
 * Phase 6: remove every mark on every slide of the open deck (undoable). The
 * settings sheet's `CLEAR ALL` button calls this after its `CONFIRM` click,
 * which Phase 6 also adds. Added as a stub in Phase 5.
 */
export function clearAllMarks(): void {}
