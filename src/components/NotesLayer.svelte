<script lang="ts">
  // The sticky-notes layer (§9 Phase 6 "Sticky notes"), inside .camera so notes
  // scale and zoom with the slide. It shows one slide's notes: by default the
  // current slide's, interactive. Phase 8 and 9 render other slides with
  // `slideId` and `interactive={false}`.
  import type { ThemeName } from '$shared/types';
  import { clientToStage } from '../lib/stage';
  import { placeNote } from '../lib/tools.svelte';
  import { currentSlideId, marks, slideMarks } from '../state/marks.svelte';
  import { settings } from '../state/settings.svelte';
  import { ui } from '../state/ui.svelte';
  import StickyNote from './StickyNote.svelte';

  interface Props {
    /** The slide whose notes are shown. Defaults to the current slide. */
    slideId?: string;
    /** Notes can be selected, moved and edited. False for thumbnails, presenter, print. */
    interactive?: boolean;
    theme?: ThemeName;
    /** Show the notes even when the MARKS setting hides them. */
    force?: boolean;
  }

  let { slideId, interactive = true, theme, force = false }: Props = $props();

  let layer: HTMLElement;

  const id = $derived(slideId ?? currentSlideId());
  const notes = $derived(slideMarks(id).notes);
  const shown = $derived(force || settings.marks);
  // Notes take the pointer only when no tool is on; while drawing, a stroke can
  // cross a note.
  const live = $derived(interactive && ui.tool === null && marks.loaded);

  // NOTE in the bottom bar arms note mode: the next click in the stage area places a note.
  $effect(() => {
    if (!interactive || ui.tool !== 'note') return;
    const viewport = layer.closest<HTMLElement>('.viewport');
    if (!viewport) return;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const p = clientToStage(e);
      if (!p) return;
      e.preventDefault();
      ui.tool = null;
      placeNote(p.x, p.y);
    };
    viewport.addEventListener('pointerdown', down);
    return () => viewport.removeEventListener('pointerdown', down);
  });

  // A press anywhere but on a note drops the selection.
  $effect(() => {
    if (!interactive || ui.selected === null) return;
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.sticky')) return;
      ui.selected = null;
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  });
</script>

<div bind:this={layer} class="notes-layer" data-theme={theme} data-slide={id}>
  {#if shown && id}
    {#each notes as note (note.id)}
      <StickyNote
        {note}
        slideId={id}
        interactive={live}
        selected={interactive && ui.selected === note.id}
        editing={interactive && ui.editing === note.id}
      />
    {/each}
  {/if}
</div>

<style>
  .notes-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  :global(.app[data-tool='note'] .viewport),
  :global(.app[data-tool='note'] .viewport *) {
    cursor: crosshair;
  }

  :global(.app[data-tool='note'] .slides) {
    pointer-events: none;
  }
</style>
