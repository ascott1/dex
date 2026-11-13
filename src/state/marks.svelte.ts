// Drawings and sticky notes for the open deck (§9 Phase 6).
//
// Storage: `decks/<slug>/marks.json` is loaded when a deck opens (404 → empty).
// In dev every change is saved with a debounced (500ms) `PUT /__dex/marks/<slug>`;
// in a static build it goes to localStorage under `dex:marks:<slug>`, which
// overrides the bundled file on load. A pending save is flushed when the page
// is hidden or closed, and when the deck changes.
//
// Marks are keyed by `Slide.id`. Entries for ids that no longer exist are kept
// as they are and saved back unchanged; nothing here prunes them.
//
// Undo and redo are stacks of operations that know their inverse. Operations
// address strokes and notes by id, so a change that arrived from another window
// (Phase 8, `applyRemoteMarks`) does not make them land on the wrong mark.

import { untrack } from 'svelte';
import type { Marks, Note, SlideMarks, Stroke } from '$shared/types';
import { readJSON } from '../lib/storage';
import { deck } from './deck.svelte';
import { nav } from './nav.svelte';

type Placed<T> = { index: number; item: T };

export type MarkOp =
  | { kind: 'addStrokes'; slideId: string; items: Placed<Stroke>[] }
  | { kind: 'removeStrokes'; slideId: string; items: Placed<Stroke>[] }
  | { kind: 'addNotes'; slideId: string; items: Placed<Note>[] }
  | { kind: 'removeNotes'; slideId: string; items: Placed<Note>[] }
  | { kind: 'editNote'; slideId: string; before: Note; after: Note }
  | { kind: 'batch'; ops: MarkOp[] };

export const SAVE_DELAY_MS = 500;
const UNDO_LIMIT = 200;
const KEEPALIVE_LIMIT = 60_000;   // fetch keepalive bodies are capped at 64 KiB

export const marks = $state({
  slug: null as string | null,
  /** The deck's marks; replaced as a whole on load. */
  data: { version: 1, slides: {} } as Marks,
  /** True once `data` holds what was stored for `slug` (input waits for it). */
  loaded: false,
  undo: [] as MarkOp[],
  redo: [] as MarkOp[],
  /** A save is scheduled or in flight. */
  pending: false,
});

export const EMPTY_SLIDE_MARKS: SlideMarks = Object.freeze({ strokes: [], notes: [] }) as SlideMarks;

// ── Reading ─────────────────────────────────────────────────────────────────

/** A slide's marks (never undefined; the empty value is shared and frozen). */
export function slideMarks(slideId: string | undefined | null): SlideMarks {
  return (slideId ? marks.data.slides[slideId] : undefined) ?? EMPTY_SLIDE_MARKS;
}

export function hasMarks(slideId: string | undefined | null): boolean {
  const m = slideMarks(slideId);
  return m.strokes.length > 0 || m.notes.length > 0;
}

export function hasAnyMarks(): boolean {
  return Object.values(marks.data.slides).some((m) => m.strokes.length > 0 || m.notes.length > 0);
}

/** The id of the slide that is showing, if any. */
export function currentSlideId(): string | undefined {
  return deck.current?.slides[nav.index]?.id;
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

// ── Subscribers (Phase 8 sync) ──────────────────────────────────────────────

type Listener = (slideId: string, slide: SlideMarks) => void;
const listeners = new Set<Listener>();

/**
 * Called after every local change to a slide's marks (drawing, notes, undo,
 * redo, clearing, and live note text and drags), with a plain snapshot of that
 * slide. Not called for `applyRemoteMarks` or loading. Returns an unsubscribe.
 */
export function onMarksChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(slideIds: Iterable<string>): void {
  const ids = new Set(slideIds);
  scheduleSave();
  if (listeners.size === 0) return;
  for (const id of ids) {
    const snapshot = $state.snapshot(slideMarks(id)) as SlideMarks;
    for (const listener of listeners) listener(id, snapshot);
  }
}

/**
 * Replace one slide's marks with marks made in another window (Phase 8). Not
 * saved (the window where they were made saves them), not on the undo stack,
 * and not reported to `onMarksChange`.
 */
export function applyRemoteMarks(slideId: string, slide: SlideMarks): void {
  marks.data.slides[slideId] = cleanSlide(slide);
}

// ── Operations ──────────────────────────────────────────────────────────────

function ensureSlide(slideId: string): SlideMarks {
  let m = marks.data.slides[slideId];
  if (!m) {
    marks.data.slides[slideId] = { strokes: [], notes: [] };
    m = marks.data.slides[slideId]!;
  }
  return m;
}

/** Drop a slide's entry when it is empty, so the file does not fill with `{}`s. */
function tidy(slideId: string): void {
  const m = marks.data.slides[slideId];
  if (m && m.strokes.length === 0 && m.notes.length === 0) delete marks.data.slides[slideId];
}

function insert<T extends { id: string }>(list: T[], items: Placed<T>[]): void {
  for (const { index, item } of [...items].sort((a, b) => a.index - b.index)) {
    if (list.some((x) => x.id === item.id)) continue;
    list.splice(Math.min(Math.max(0, index), list.length), 0, clone(item));
  }
}

function remove<T extends { id: string }>(list: T[], items: Placed<T>[]): void {
  const ids = new Set(items.map((p) => p.item.id));
  for (let i = list.length - 1; i >= 0; i--) if (ids.has(list[i]!.id)) list.splice(i, 1);
}

function invert(op: MarkOp): MarkOp {
  switch (op.kind) {
    case 'addStrokes': return { ...op, kind: 'removeStrokes' };
    case 'removeStrokes': return { ...op, kind: 'addStrokes' };
    case 'addNotes': return { ...op, kind: 'removeNotes' };
    case 'removeNotes': return { ...op, kind: 'addNotes' };
    case 'editNote': return { ...op, before: op.after, after: op.before };
    case 'batch': return { kind: 'batch', ops: op.ops.map(invert).reverse() };
  }
}

/** Apply an operation to `marks.data`; collects the slides it touched. */
function apply(op: MarkOp, touched: Set<string>): void {
  if (op.kind === 'batch') {
    for (const o of op.ops) apply(o, touched);
    return;
  }
  touched.add(op.slideId);
  const m = ensureSlide(op.slideId);
  switch (op.kind) {
    case 'addStrokes': insert(m.strokes, op.items); break;
    case 'removeStrokes': remove(m.strokes, op.items); break;
    case 'addNotes': insert(m.notes, op.items); break;
    case 'removeNotes': remove(m.notes, op.items); break;
    case 'editNote': {
      const i = m.notes.findIndex((n) => n.id === op.after.id);
      if (i >= 0) m.notes[i] = clone(op.after);
      break;
    }
  }
  tidy(op.slideId);
}

/** Apply a new operation, push it on the undo stack, clear redo, save. */
function perform(op: MarkOp): void {
  const touched = new Set<string>();
  apply(op, touched);
  marks.undo.push(op);
  if (marks.undo.length > UNDO_LIMIT) marks.undo.splice(0, marks.undo.length - UNDO_LIMIT);
  marks.redo.length = 0;
  changed(touched);
}

export function canUndo(): boolean {
  return marks.undo.length > 0;
}

export function canRedo(): boolean {
  return marks.redo.length > 0;
}

export function undo(): void {
  const op = marks.undo.pop();
  if (!op) return;
  const touched = new Set<string>();
  apply(invert($state.snapshot(op) as MarkOp), touched);
  marks.redo.push(op);
  changed(touched);
}

export function redo(): void {
  const op = marks.redo.pop();
  if (!op) return;
  const touched = new Set<string>();
  apply($state.snapshot(op) as MarkOp, touched);
  marks.undo.push(op);
  changed(touched);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Add a finished stroke (pen, marker, arrow, box). Coordinates are rounded for the file. */
export function addStroke(slideId: string, stroke: Stroke): void {
  const item: Stroke = {
    ...stroke,
    points: stroke.points.map(([x, y, p]) => [r1(x), r1(y), r2(p)] as [number, number, number]),
  };
  perform({ kind: 'addStrokes', slideId, items: [{ index: slideMarks(slideId).strokes.length, item }] });
}

/** Remove strokes by id (the eraser). */
export function removeStrokes(slideId: string, ids: string[]): void {
  const strokes = slideMarks(slideId).strokes;
  const items = strokes.flatMap((item, index) => (ids.includes(item.id) ? [{ index, item: clone(item) }] : []));
  if (items.length > 0) perform({ kind: 'removeStrokes', slideId, items });
}

/** `c` and the draw bar's CLEAR: the slide's drawings go, its sticky notes stay. */
export function clearSlideDrawings(slideId: string | undefined = currentSlideId()): void {
  if (!slideId) return;
  const strokes = slideMarks(slideId).strokes;
  if (strokes.length === 0) return;
  perform({ kind: 'removeStrokes', slideId, items: strokes.map((item, index) => ({ index, item: clone(item) })) });
}

function clearOps(slideId: string): MarkOp[] {
  const m = slideMarks(slideId);
  const ops: MarkOp[] = [];
  if (m.strokes.length) ops.push({ kind: 'removeStrokes', slideId, items: m.strokes.map((item, index) => ({ index, item: clone(item) })) });
  if (m.notes.length) ops.push({ kind: 'removeNotes', slideId, items: m.notes.map((item, index) => ({ index, item: clone(item) })) });
  return ops;
}

/** The sheet's CLEAR THIS SLIDE: drawings and sticky notes. Undoable. */
export function clearSlideMarks(slideId: string | undefined = currentSlideId()): void {
  if (!slideId) return;
  const ops = clearOps(slideId);
  if (ops.length) perform({ kind: 'batch', ops });
}

/**
 * The sheet's CLEAR ALL (after its CONFIRM click): every slide's marks,
 * including entries for slide ids the deck no longer has. Undoable.
 */
export function clearAllMarks(): void {
  const ops = Object.keys(marks.data.slides).flatMap(clearOps);
  if (ops.length) perform({ kind: 'batch', ops });
}

export function addNote(slideId: string, note: Note): void {
  perform({ kind: 'addNotes', slideId, items: [{ index: slideMarks(slideId).notes.length, item: clone(note) }] });
}

export function removeNote(slideId: string, id: string): void {
  const notes = slideMarks(slideId).notes;
  const index = notes.findIndex((n) => n.id === id);
  if (index >= 0) perform({ kind: 'removeNotes', slideId, items: [{ index, item: clone(notes[index]!) }] });
}

export function getNote(slideId: string, id: string): Note | undefined {
  return slideMarks(slideId).notes.find((n) => n.id === id);
}

/**
 * Change a note in place without an undo entry: live typing and dragging. It
 * is saved and reported like any change. Finish with `commitNoteEdit(before)`
 * to record the whole gesture as one undo step.
 */
export function updateNote(slideId: string, id: string, patch: Partial<Omit<Note, 'id'>>): void {
  const note = marks.data.slides[slideId]?.notes.find((n) => n.id === id);
  if (!note) return;
  Object.assign(note, patch);
  changed([slideId]);
}

/** Record the edit from `before` to the note as it is now, as one undo step. */
export function commitNoteEdit(slideId: string, before: Note): void {
  const now = getNote(slideId, before.id);
  if (!now) return;
  const after = clone(now);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  // A note created and then written in is one step: undo removes it.
  const top = marks.undo.at(-1);
  if (top?.kind === 'addNotes' && top.slideId === slideId && top.items.length === 1 && top.items[0]!.item.id === before.id) {
    top.items[0]!.item = after;
    return;
  }
  marks.undo.push({ kind: 'editNote', slideId, before: clone(before), after });
  marks.redo.length = 0;
}

/** One undoable edit (a colour change). */
export function editNote(slideId: string, id: string, patch: Partial<Omit<Note, 'id'>>): void {
  const before = getNote(slideId, id);
  if (!before) return;
  perform({ kind: 'editNote', slideId, before: clone(before), after: { ...clone(before), ...patch } });
}

/**
 * End an edit that left the note empty: the note goes. `before` is the note as
 * it was when editing started. A note created for this edit leaves no undo
 * entry at all; a note that had text before can be brought back with undo.
 */
export function discardNote(slideId: string, id: string, before?: Note): void {
  const m = marks.data.slides[slideId];
  if (!m) return;
  const i = m.notes.findIndex((n) => n.id === id);
  if (i < 0) return;
  m.notes.splice(i, 1);
  tidy(slideId);
  const top = marks.undo.at(-1);
  if (top?.kind === 'addNotes' && top.slideId === slideId && top.items.length === 1 && top.items[0]!.item.id === id) {
    marks.undo.pop();
  } else if (before && before.text.trim() !== '') {
    marks.undo.push({ kind: 'removeNotes', slideId, items: [{ index: i, item: clone(before) }] });
    marks.redo.length = 0;
  }
  changed([slideId]);
}

// ── Validation ──────────────────────────────────────────────────────────────

function clone<T>(value: T): T {
  return structuredClone($state.snapshot(value)) as T;
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function cleanStroke(s: unknown): Stroke | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Partial<Stroke>;
  if (typeof o.id !== 'string' || !['pen', 'marker', 'arrow', 'box'].includes(o.tool as string)) return null;
  if (!Array.isArray(o.points)) return null;
  const points = o.points.filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).map(
    (p) => [p[0], p[1], isNum(p[2]) ? p[2] : 0.5] as [number, number, number],
  );
  if (points.length < 2) return null;
  return {
    id: o.id,
    tool: o.tool!,
    color: o.color === 'red' || o.color === 'blue' ? o.color : 'ink',
    size: isNum(o.size) && o.size > 0 ? o.size : 6,
    points,
  };
}

function cleanNote(n: unknown): Note | null {
  if (!n || typeof n !== 'object') return null;
  const o = n as Partial<Note>;
  if (typeof o.id !== 'string' || !isNum(o.x) || !isNum(o.y)) return null;
  return {
    id: o.id,
    x: o.x,
    y: o.y,
    w: isNum(o.w) && o.w > 0 ? o.w : 220,
    h: isNum(o.h) && o.h > 0 ? o.h : 220,
    text: typeof o.text === 'string' ? o.text : '',
    color: o.color === 'pink' || o.color === 'blue' ? o.color : 'yellow',
  };
}

function cleanSlide(s: unknown): SlideMarks {
  const o = (s && typeof s === 'object' ? s : {}) as Partial<SlideMarks>;
  return {
    strokes: Array.isArray(o.strokes) ? o.strokes.map(cleanStroke).filter((x): x is Stroke => x !== null) : [],
    notes: Array.isArray(o.notes) ? o.notes.map(cleanNote).filter((x): x is Note => x !== null) : [],
  };
}

/** A `Marks` object from untrusted JSON, or null when it is not one. */
export function parseMarks(value: unknown): Marks | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Partial<Marks>;
  if (o.version !== 1 || !o.slides || typeof o.slides !== 'object' || Array.isArray(o.slides)) return null;
  const slides: Record<string, SlideMarks> = {};
  for (const [id, s] of Object.entries(o.slides)) slides[id] = cleanSlide(s);
  return { version: 1, slides };
}

// ── Load and save ───────────────────────────────────────────────────────────

const DEV = import.meta.env.DEV;
const storageKey = (slug: string) => `dex:marks:${slug}`;
// Dev only: a copy of marks whose PUT has not been confirmed yet, so a save
// that could not finish before the page closed is sent on the next load.
const unsavedKey = (slug: string) => `dex:marks-unsaved:${slug}`;

let loadGeneration = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Saving is refused for a deck whose marks file exists but could not be read. */
let blocked = false;
// Changes since the last save that was handed to the network or storage.
let dirty = false;
let saveSeq = 0;

/** Load the marks for a deck (flushing a pending save of the previous deck first). */
export async function loadMarks(slug: string): Promise<void> {
  if (marks.slug && marks.slug !== slug) flushSave();
  const gen = ++loadGeneration;
  clearTimeout(timer);
  dirty = false;
  blocked = false;
  marks.slug = slug;
  marks.loaded = false;
  marks.pending = false;
  marks.data = { version: 1, slides: {} };
  marks.undo = [];
  marks.redo = [];

  let data: Marks | null = null;
  let resend = false;

  if (!DEV) data = parseMarks(readJSON(storageKey(slug)));
  if (DEV) {
    data = parseMarks(readJSON(unsavedKey(slug)));
    resend = data !== null;
  }

  if (!data) {
    try {
      const res = await fetch(`decks/${slug}/marks.json`, { cache: 'no-store' });
      // A host with an SPA fallback answers a missing file with the page itself.
      const html = (res.headers.get('content-type') ?? '').includes('text/html');
      if (res.ok && !html) {
        data = parseMarks(await res.json().catch(() => null));
        if (!data) {
          blocked = true;
          console.warn(`dex: decks/${slug}/marks.json is not a marks file; marks will not be saved until it is fixed`);
        }
      } else if (!res.ok && res.status !== 404) {
        blocked = true;
        console.warn(`dex: could not load decks/${slug}/marks.json (HTTP ${res.status}); marks will not be saved`);
      }
    } catch (err) {
      blocked = true;
      console.warn(`dex: could not load decks/${slug}/marks.json:`, err);
    }
  }

  if (gen !== loadGeneration) return;
  marks.data = data ?? { version: 1, slides: {} };
  marks.loaded = true;
  if (resend) {
    dirty = true;
    void save();
  }
}

function scheduleSave(): void {
  if (!marks.slug || !marks.loaded) return;
  dirty = true;
  marks.pending = true;
  clearTimeout(timer);
  timer = setTimeout(() => void save(), SAVE_DELAY_MS);
}

/** Save now. `keepalive` lets the request outlive the page (body ≤ 64 KiB). */
async function save(keepalive = false): Promise<void> {
  clearTimeout(timer);
  const slug = marks.slug;
  if (!slug || !marks.loaded || !dirty) {
    marks.pending = false;
    return;
  }
  if (blocked) {
    marks.pending = false;
    return;
  }
  dirty = false;
  const body = JSON.stringify($state.snapshot(marks.data));

  if (!DEV) {
    try {
      localStorage.setItem(storageKey(slug), body);
    } catch {
      console.warn('dex: marks could not be saved to localStorage');
    }
    marks.pending = false;
    return;
  }

  const seq = ++saveSeq;
  try {
    localStorage.setItem(unsavedKey(slug), body);
  } catch {
    // The PUT below is the real save; this copy is only a safety net.
  }
  try {
    const res = await fetch(`__dex/marks/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: keepalive && body.length <= KEEPALIVE_LIMIT,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Only the latest save may drop the safety copy.
    if (seq === saveSeq && !dirty) {
      try {
        localStorage.removeItem(unsavedKey(slug));
      } catch {
        // ignored
      }
    }
  } catch (err) {
    console.warn(`dex: saving marks for ${slug} failed:`, err);
  } finally {
    if (seq === saveSeq && marks.slug === slug && !dirty) marks.pending = false;
  }
}

/** Send a pending save right away (page hidden or closing, deck changing). */
export function flushSave(): void {
  if (!dirty) return;
  void save(true);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

// Load the marks of whichever deck is open, on every route (the presenter and
// print views need them too).
$effect.root(() => {
  $effect(() => {
    const slug = deck.current?.slug;
    if (slug && slug !== untrack(() => marks.slug)) untrack(() => void loadMarks(slug));
  });
});
