// Phase 6 commands and the sticky-note editing lifecycle (§9 Phase 6). Filled
// in with `implement()`; imported once, for its side effects, by App.svelte.

import { untrack } from 'svelte';
import type { Note, NoteColor } from '$shared/types';
import { deck } from '../state/deck.svelte';
import {
  addNote,
  clearSlideDrawings,
  commitNoteEdit,
  currentSlideId,
  discardNote,
  getNote,
  marks,
  newId,
  redo,
  removeNote,
  undo,
} from '../state/marks.svelte';
import { settings } from '../state/settings.svelte';
import { ui, type Tool } from '../state/ui.svelte';
import { implement } from './commands';
import { ESCAPE_RANK, onEscape } from './escape';
import { stageSize } from './stage';
import { cyclePenSize } from './strokes';

export const NOTE_SIZE = 220;

const hasSlide = () => deck.current !== null && (deck.current.slides.length ?? 0) > 0;
const canMark = () => hasSlide() && marks.loaded;

// ── Note editing ────────────────────────────────────────────────────────────

let editSlide: string | null = null;
let editBefore: Note | null = null;

/** Start editing a note: it gets a textarea with focus. */
export function startEditing(slideId: string, id: string): void {
  finishEditing();
  const note = getNote(slideId, id);
  if (!note) return;
  editSlide = slideId;
  editBefore = $state.snapshot(note) as Note;
  ui.selected = id;
  ui.editing = id;
}

/**
 * Finish editing: the gesture becomes one undo step, and a note left empty is
 * removed. Returns false when no note was being edited.
 */
export function finishEditing(): boolean {
  const id = ui.editing;
  if (!id) return false;
  ui.editing = null;
  const slide = editSlide;
  const before = editBefore;
  editSlide = null;
  editBefore = null;
  if (!slide) return true;
  const note = getNote(slide, id);
  if (!note) return true;
  if (note.text.trim() === '') {
    discardNote(slide, id, before ?? undefined);
    if (ui.selected === id) ui.selected = null;
  } else if (before) {
    commitNoteEdit(slide, before);
  }
  return true;
}

/** Deselect and stop editing (the slide changed, a tool was picked). */
export function releaseNotes(): void {
  finishEditing();
  ui.selected = null;
}

/** Put a new note with its top-left corner at a stage point (clamped to the stage) and edit it. */
export function placeNote(x: number, y: number, color: NoteColor = 'yellow'): void {
  const slide = currentSlideId();
  if (!slide || !marks.loaded) return;
  releaseNotes();
  const { W, H } = stageSize(deck.current?.meta.aspect);
  const note: Note = {
    id: newId('n'),
    x: Math.round(Math.min(Math.max(0, x), W - NOTE_SIZE)),
    y: Math.round(Math.min(Math.max(0, y), H - NOTE_SIZE)),
    w: NOTE_SIZE,
    h: NOTE_SIZE,
    text: '',
    color,
  };
  settings.marks = true;
  addNote(slide, note);
  startEditing(slide, note.id);
}

/** `n`: a note at the pointer, or at the stage centre when the pointer is elsewhere. */
export function noteAtPointer(): void {
  if (ui.tool) ui.tool = null;
  const { W, H } = stageSize(deck.current?.meta.aspect);
  if (ui.pointer.inside) placeNote(ui.pointer.x, ui.pointer.y);
  else placeNote((W - NOTE_SIZE) / 2, (H - NOTE_SIZE) / 2);
}

/** The bottom bar's NOTE button: the next click on the stage places a note. */
export function armNote(): void {
  setTool(ui.tool === 'note' ? null : 'note');
}

export function setTool(tool: Tool): void {
  releaseNotes();
  ui.tool = tool;
  if (tool === 'draw' || tool === 'note') settings.marks = true;
}

const toggleTool = (tool: Exclude<Tool, null>) => () => setTool(ui.tool === tool ? null : tool);

// ── Commands ────────────────────────────────────────────────────────────────

implement('draw', toggleTool('draw'), hasSlide);
implement('note', noteAtPointer, canMark);
implement('laser', toggleTool('laser'), hasSlide);
implement('marks', () => {
  settings.marks = !settings.marks;
}, hasSlide);
implement('clear', () => clearSlideDrawings(), hasSlide);
implement('undo', () => {
  finishEditing();
  undo();
}, () => marks.loaded);
implement('redo', () => {
  finishEditing();
  redo();
}, () => marks.loaded);
implement('penSmaller', () => {
  settings.pen.size = cyclePenSize(settings.pen.size, -1);
}, hasSlide);
implement('penLarger', () => {
  settings.pen.size = cyclePenSize(settings.pen.size, 1);
}, hasSlide);

const selectedNote = () => ui.selected !== null && ui.editing === null && ui.overlay === null;

implement('noteDelete', () => {
  const slide = currentSlideId();
  if (slide && ui.selected) removeNote(slide, ui.selected);
  ui.selected = null;
}, selectedNote);
implement('noteEdit', () => {
  const slide = currentSlideId();
  if (slide && ui.selected) startEditing(slide, ui.selected);
}, selectedNote);

// Esc ends an edit (removing a note left empty), then drops the selection.
onEscape('editing', ESCAPE_RANK.editing, () => {
  if (finishEditing()) return true;
  if (ui.selected === null) return false;
  ui.selected = null;
  return true;
});

// Leaving a slide ends whatever was happening to its notes.
$effect.root(() => {
  let last: string | undefined;
  $effect(() => {
    const id = currentSlideId();
    if (last !== undefined && id !== last) untrack(releaseNotes);
    last = id;
  });
});
