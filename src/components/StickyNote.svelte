<script lang="ts">
  // One sticky note (§9 Phase 6 "Sticky notes"), in stage logical pixels.
  // Not editing: drag to move (clamped to the stage), click to select,
  // double-click or Enter to edit. Editing: a textarea filling the note; Esc or
  // a press outside finishes, and a note left empty is removed.
  import type { Note, NoteColor } from '$shared/types';
  import { clientToStage, stageSize } from '../lib/stage';
  import { finishEditing, startEditing } from '../lib/tools.svelte';
  import { deck } from '../state/deck.svelte';
  import { commitNoteEdit, editNote, removeNote, updateNote } from '../state/marks.svelte';
  import { ui } from '../state/ui.svelte';

  interface Props {
    note: Note;
    slideId: string;
    interactive?: boolean;
    selected?: boolean;
    editing?: boolean;
  }

  let { note, slideId, interactive = false, selected = false, editing = false }: Props = $props();

  const COLORS: NoteColor[] = ['yellow', 'pink', 'blue'];

  let el: HTMLElement;
  let textarea: HTMLTextAreaElement | undefined = $state();
  let dragging = $state(false);

  const size = $derived(stageSize(deck.current?.meta.aspect));

  // Focus the textarea when editing starts, caret at the end.
  $effect(() => {
    if (!editing || !textarea) return;
    const t = textarea;
    t.focus({ preventScroll: true });
    t.setSelectionRange(t.value.length, t.value.length);
  });

  // A press outside the note finishes the edit.
  $effect(() => {
    if (!editing) return;
    const down = (e: PointerEvent) => {
      if (e.target instanceof Node && el.contains(e.target)) return;
      finishEditing();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  });

  let drag: { pointer: number; start: { x: number; y: number }; origin: { x: number; y: number }; before: Note; moved: boolean } | null = null;

  function onpointerdown(e: PointerEvent) {
    if (!interactive || editing || e.button !== 0 || !e.isPrimary) return;
    const start = clientToStage(e);
    if (!start) return;
    e.preventDefault();
    e.stopPropagation();
    if (ui.editing) finishEditing();
    ui.selected = note.id;
    el.setPointerCapture(e.pointerId);
    drag = {
      pointer: e.pointerId,
      start,
      origin: { x: note.x, y: note.y },
      before: $state.snapshot(note) as Note,
      moved: false,
    };
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const p = clientToStage(e);
    if (!p) return;
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    dragging = true;
    // Clamped to the stage, by the note's rendered height (it grows with its text).
    const x = Math.min(Math.max(0, drag.origin.x + dx), size.W - note.w);
    const y = Math.min(Math.max(0, drag.origin.y + dy), size.H - el.offsetHeight);
    updateNote(slideId, note.id, { x: Math.round(x), y: Math.round(y) });
  }

  function onpointerup(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (drag.moved) commitNoteEdit(slideId, drag.before);
    drag = null;
    dragging = false;
  }

  function ondblclick(e: MouseEvent) {
    if (!interactive || editing) return;
    e.preventDefault();
    startEditing(slideId, note.id);
  }

  function oninput(e: Event) {
    updateNote(slideId, note.id, { text: (e.currentTarget as HTMLTextAreaElement).value });
  }

  // Toolbar buttons must not start a drag.
  const stop = (e: PointerEvent) => e.stopPropagation();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={el}
  class="sticky"
  class:selected
  class:editing
  class:dragging
  class:interactive
  data-note={note.id}
  data-color={note.color}
  style:left="{note.x}px"
  style:top="{note.y}px"
  style:width="{note.w}px"
  style:min-height="{note.h}px"
  style:background="var(--note-{note.color})"
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {ondblclick}
>
  {#if editing}
    <div class="grow">
      <div class="mirror" aria-hidden="true">{note.text}{' '}</div>
      <textarea
        bind:this={textarea}
        value={note.text}
        {oninput}
        aria-label="Sticky note"
        spellcheck="false"
      ></textarea>
    </div>
  {:else}
    <div class="text">{note.text}</div>
  {/if}

  {#if selected && !editing && interactive}
    <div class="tools" onpointerdown={stop}>
      {#each COLORS as color (color)}
        <button
          class="swatch"
          class:active={note.color === color}
          type="button"
          aria-label="{color} note"
          aria-pressed={note.color === color}
          style:background="var(--note-{color})"
          onclick={() => editNote(slideId, note.id, { color })}
        ></button>
      {/each}
      <button class="remove" type="button" aria-label="Delete note" onclick={() => {
        removeNote(slideId, note.id);
        ui.selected = null;
      }}>×</button>
    </div>
  {/if}
</div>

<style>
  /* Logical stage pixels: the note scales and zooms with the slide. The one
     box-shadow allowed anywhere (§3 rule 6). */
  .sticky {
    position: absolute;
    box-sizing: border-box;
    padding: 16px;
    color: var(--note-ink);
    font-family: var(--font-sans);
    font-size: 22px;
    line-height: 1.3;
    font-weight: 400;
    box-shadow:
      0 1px 0 rgb(0 0 0 / 0.08),
      0 10px 24px -14px rgb(0 0 0 / 0.35);
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .sticky.interactive {
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
  }

  .sticky.dragging {
    cursor: grabbing;
  }

  .sticky.editing {
    cursor: text;
  }

  /* --ink, not --note-ink: the same colour on Paper, and still visible on Ink. */
  .sticky.selected {
    outline: 1px solid var(--ink);
  }

  .text,
  .mirror,
  textarea {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
    color: inherit;
    letter-spacing: 0;
  }

  .text {
    min-height: 1.3em;
  }

  /* The textarea sits on an invisible copy of its text, so the note grows
     downward as the text does. */
  .grow {
    display: grid;
  }

  .mirror,
  textarea {
    grid-area: 1 / 1;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .mirror {
    visibility: hidden;
  }

  textarea {
    display: block;
    width: 100%;
    height: 100%;
    resize: none;
    overflow: hidden;
    background: none;
    outline: none;
    caret-color: var(--note-ink);
    user-select: text;
    -webkit-user-select: text;
  }

  .tools {
    position: absolute;
    left: 0;
    bottom: calc(100% + 10px);
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: default;
  }

  .swatch {
    appearance: none;
    width: 22px;
    height: 22px;
    margin: 0;
    padding: 0;
    border: 0;
    cursor: pointer;
  }

  .swatch.active {
    outline: 1px solid var(--ink);
    outline-offset: 3px;
  }

  .remove {
    appearance: none;
    margin: 0 0 0 4px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ink-2);
    font-family: var(--font-mono);
    font-size: 26px;
    line-height: 22px;
    cursor: pointer;
  }

  .remove:hover {
    color: var(--ink);
  }
</style>
