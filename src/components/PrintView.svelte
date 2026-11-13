<script lang="ts">
  // The print view at #/<slug>/print (§9 Phase 9): every slide that is not
  // skipped, in order, fully revealed, one page each, for the browser's print
  // dialog. On screen the pages are scaled to fit the window under a bar with
  // the print controls; in print the bar is hidden and every page is exactly
  // the deck's stage size (print.css). Marks are drawn from the print view's
  // own toggle, not the MARKS setting. No camera: print never zooms.
  import { stageSize } from '../lib/stage';
  import { deck } from '../state/deck.svelte';
  import { marks } from '../state/marks.svelte';
  import { settings, slideTheme } from '../state/settings.svelte';
  import DrawLayer from './DrawLayer.svelte';
  import NotesLayer from './NotesLayer.svelte';
  import SlideView from './SlideView.svelte';

  const size = $derived(stageSize(deck.current?.meta.aspect));
  const all = $derived(deck.current?.slides ?? []);
  const skipped = $derived(all.filter((s) => s.options.skip).length);

  // What you see is what you print: marks start as the MARKS setting shows them.
  let includeMarks = $state(settings.marks);
  let includeSkipped = $state(false);

  const slides = $derived(includeSkipped ? all : all.filter((s) => !s.options.skip));
  const width = $derived(Math.max(2, String(slides.length).length));
  const pad = (n: number) => String(n).padStart(width, '0');

  const hasMarks = $derived(Object.keys(marks.data.slides).length > 0);

  // On screen each page is scaled down to fit the window, never up.
  let viewWidth = $state(0);
  const SIDE = 24;
  const k = $derived(viewWidth > 0 ? Math.min(1, (viewWidth - 2 * SIDE) / size.W) : 1);

  // The page size has to be the deck's stage size, which a stylesheet cannot
  // read from a custom property, so the @page rule is written here.
  $effect(() => {
    const style = document.createElement('style');
    style.dataset.printPage = '';
    style.textContent = `@page { size: ${size.W}px ${size.H}px; margin: 0; }`;
    document.head.append(style);
    return () => style.remove();
  });
</script>

<div
  class="print-view"
  bind:clientWidth={viewWidth}
  style:--W="{size.W}px"
  style:--H="{size.H}px"
  style:--k={k}
>
  {#if !deck.current}
    {#if deck.error}
      <div class="print-empty">
        <p class="label">Cannot open deck</p>
        <p class="help-text">{deck.error}</p>
      </div>
    {/if}
  {:else}
    <header class="print-bar">
      <div class="print-title">
        <span class="print-square" aria-hidden="true"></span>
        <span class="label">{deck.current.meta.title}</span>
        <span class="label print-count" data-print-count>
          {slides.length} {slides.length === 1 ? 'page' : 'pages'}
        </span>
      </div>
      <div class="print-actions">
        <button
          class="label button"
          type="button"
          aria-pressed={includeMarks}
          title={hasMarks ? 'Print the drawings and sticky notes' : 'This deck has no marks'}
          onclick={() => (includeMarks = !includeMarks)}
        >Marks</button>
        {#if skipped > 0}
          <button
            class="label button"
            type="button"
            aria-pressed={includeSkipped}
            title="Print the slides marked skip"
            onclick={() => (includeSkipped = !includeSkipped)}
          >Skipped slides</button>
        {/if}
        <button class="label button" type="button" data-print-button onclick={() => window.print()}>Print</button>
      </div>
    </header>

    {#if slides.length === 0}
      <div class="print-empty">
        <p class="label">No slides yet</p>
        <p class="help-text">decks/{deck.current.slug}/deck.md</p>
      </div>
    {:else}
      <div class="print-pages">
        {#each slides as slide, i (slide.id)}
          {@const theme = slideTheme(slide)}
          <div class="print-sheet" data-slide={slide.id}>
            <div
              class="print-page"
              data-theme={theme}
              data-over-image={slide.layout === 'image' || slide.attrs['data-bg'] === 'image' ? '' : undefined}
              inert
            >
              <SlideView {slide} revealAll current={false} />
              {#if includeMarks}
                <DrawLayer slideId={slide.id} interactive={false} {theme} force />
                <NotesLayer slideId={slide.id} interactive={false} {theme} force />
              {/if}
              <span class="print-number" aria-hidden="true">{pad(i + 1)} / {pad(slides.length)}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
