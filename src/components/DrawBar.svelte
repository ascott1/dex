<script lang="ts">
  // The draw bar (§8 "Draw bar", §9 Phase 6): replaces the right side of the
  // bottom bar while drawing. A status Label `DRAW` in --ink-4, tool names in
  // --ink-2 with a 2px --red underline 4px under the active one, three colour
  // squares, the pen size, UNDO and CLEAR (--ink-4 when there is nothing to
  // undo or clear), and DONE in --red. This is the only colour in the chrome.
  import type { PenColor, Settings } from '$shared/types';
  import { runCommand } from '../lib/commands';
  import { setTool } from '../lib/tools.svelte';
  import { PEN_SIZES, cyclePenSize } from '../lib/strokes';
  import { canUndo, currentSlideId, slideMarks } from '../state/marks.svelte';
  import { settings } from '../state/settings.svelte';

  const TOOLS: { id: Settings['pen']['tool']; label: string }[] = [
    { id: 'pen', label: 'Pen' },
    { id: 'marker', label: 'Marker' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'box', label: 'Box' },
    { id: 'eraser', label: 'Eraser' },
  ];
  const COLORS: PenColor[] = ['ink', 'red', 'blue'];
  const SIZE_LABELS = ['S', 'M', 'L'];

  const undoable = $derived(canUndo());
  const clearable = $derived(slideMarks(currentSlideId()).strokes.length > 0);
  const sizeLabel = $derived(SIZE_LABELS[PEN_SIZES.indexOf(settings.pen.size as (typeof PEN_SIZES)[number])] ?? 'M');

  // Chrome buttons do not keep focus (a later Space would press them again).
  const keepFocus = (event: PointerEvent) => event.preventDefault();
</script>

<div class="drawbar" role="toolbar" aria-label="Draw">
  <span class="label status">Draw</span>

  <div class="tools">
    {#each TOOLS as tool (tool.id)}
      <button
        class="label tool"
        class:active={settings.pen.tool === tool.id}
        type="button"
        aria-pressed={settings.pen.tool === tool.id}
        onpointerdown={keepFocus}
        onclick={() => (settings.pen.tool = tool.id)}
      >{tool.label}</button>
    {/each}
  </div>

  <div class="colors">
    {#each COLORS as color (color)}
      <button
        class="swatch"
        class:active={settings.pen.color === color}
        type="button"
        aria-label="{color} pen"
        aria-pressed={settings.pen.color === color}
        style:background="var(--{color})"
        onpointerdown={keepFocus}
        onclick={() => (settings.pen.color = color)}
      ></button>
    {/each}
    <button
      class="label tool size"
      type="button"
      title="Pen size ([ and ])"
      aria-label="Pen size {settings.pen.size}"
      onpointerdown={keepFocus}
      onclick={() => (settings.pen.size = cyclePenSize(settings.pen.size, 1))}
    >{sizeLabel}</button>
  </div>

  <div class="actions">
    <button class="label tool" class:off={!undoable} type="button" disabled={!undoable}
      onpointerdown={keepFocus} onclick={() => runCommand('undo')}>Undo</button>
    <button class="label tool" class:off={!clearable} type="button" disabled={!clearable}
      onpointerdown={keepFocus} onclick={() => runCommand('clear')}>Clear</button>
    <button class="label tool done" type="button" onpointerdown={keepFocus} onclick={() => setTool(null)}>Done</button>
  </div>
</div>

<style>
  .drawbar {
    display: flex;
    align-items: center;
    gap: 24px;
    pointer-events: auto;
  }

  .status {
    color: var(--ink-4);
  }

  .tools,
  .colors,
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .colors {
    gap: 10px;
  }

  .tool {
    appearance: none;
    position: relative;
    margin: 0;
    padding: 8px 0;
    border: 0;
    background: none;
    color: var(--ink-2);
    cursor: pointer;
    transition: color var(--t-fast) var(--ease);
  }

  .tool:hover {
    color: var(--ink);
  }

  /* Hit areas (Phase 10): the labels are 10px text and the swatches 10px
     squares. Each grows by half the gap to its neighbours, so the areas meet
     without overlapping; nothing visible moves. */
  .tool::before,
  .swatch::before {
    content: '';
    position: absolute;
    inset: -4px -8px;
  }

  .swatch::before {
    inset: -12px -5px;
  }

  /* The active tool: a 2px --red underline 4px below the text. The labels are
     uppercase, so the text ends at the baseline, which DM Mono puts 2px above
     the bottom of the 10px line box: 8px padding − 2px − 4px gap − 2px rule. */
  .tool.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0.12em;
    bottom: 4px;
    height: 2px;
    background: var(--red);
  }

  .tool.off,
  .tool.off:hover {
    color: var(--ink-4);
    cursor: default;
  }

  .done,
  .done:hover {
    color: var(--red);
  }

  .swatch {
    appearance: none;
    position: relative;
    width: 10px;
    height: 10px;
    margin: 0;
    padding: 0;
    border: 0;
    cursor: pointer;
  }

  .swatch.active {
    outline: 1px solid var(--ink);
    outline-offset: 2px;
  }

  .size {
    min-width: 1.2em;
    margin-left: 4px;
    text-align: center;
  }
</style>
