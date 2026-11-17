<script lang="ts">
  // The Markdown source of the current slide (§9 Phase 5 task 5): `m`. It
  // covers the stage area with a stage-shaped page, fitted the same way as the
  // stage, showing `slide.source` in DM Mono at 22 logical px inside the safe
  // area. The bars stay, so navigation keeps working and the source follows.
  import { deckFile } from '../lib/paths';
  import { fitStage, stageSize } from '../lib/stage';
  import { deck } from '../state/deck.svelte';
  import { nav } from '../state/nav.svelte';
  import { ui } from '../state/ui.svelte';

  const open = $derived(ui.overlay === 'source');
  const slide = $derived(deck.current?.slides[nav.index]);
  const size = $derived(stageSize(deck.current?.meta.aspect));

  let area: HTMLElement | undefined = $state();
  let aw = $state(0);
  let ah = $state(0);
  const fit = $derived(fitStage(aw, ah, size.W, size.H));

  $effect(() => {
    if (!area) return;
    const el = area;
    const measure = () => {
      aw = el.clientWidth;
      ah = el.clientHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

{#if open && deck.current && slide}
  <div class="source" bind:this={area} role="region" aria-label="Markdown source">
    <div
      class="page"
      style:width="{size.W}px"
      style:height="{size.H}px"
      style:left="{fit.left}px"
      style:top="{fit.top}px"
      style:transform="scale({fit.scale})"
      style:--w="{size.W}px"
    >
      <div class="meta">
        <span class="tag">Markdown</span>
        <span class="where">{deckFile(deck.current.slug)}:{slide.line}</span>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <pre tabindex="0">{slide.source}</pre>
    </div>
  </div>
{/if}

<style>
  /* Exactly the stage area: the space between docked bars, or the window. */
  .source {
    position: fixed;
    inset: 0;
    z-index: 10;
    overflow: hidden;
    background: var(--bg);
    animation: fade-in var(--t-fast) var(--ease);
  }

  :global(.app[data-dock]) .source {
    top: var(--bar-top);
    bottom: var(--bar-bottom);
  }

  /* Logical pixels on the W×H stage, like a slide (ground rule 7); the safe
     margins match slide.css: 8% of the width, 112 top, 104 bottom. */
  .page {
    position: absolute;
    transform-origin: 0 0;
    display: flex;
    flex-direction: column;
    padding: 112px calc(var(--w) * 0.08) 104px;
  }

  .meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 24px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.3;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-3);
  }

  .tag {
    color: var(--ink);
  }

  .where {
    text-transform: none;
    letter-spacing: 0;
  }

  pre {
    flex: 1;
    min-height: 0;
    margin: 0;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 22px;
    line-height: 1.5;
    color: var(--ink);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }

  pre:focus-visible {
    outline: 1px solid var(--line);
    outline-offset: 8px;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
