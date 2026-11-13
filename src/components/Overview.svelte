<script lang="ts">
  // The overview grid (§9 Phase 5 task 3): `g` or the overview icon. Every
  // slide, skipped ones included, as a real SlideView with every step revealed,
  // scaled into a box of the stage's shape. Arrow keys move the selection,
  // `Enter` or a click opens the slide, `g` or `Esc` closes.
  import { untrack } from 'svelte';
  import { stageSize } from '../lib/stage';
  import { deck } from '../state/deck.svelte';
  import { hasMarks } from '../state/marks.svelte';
  import { goto, nav } from '../state/nav.svelte';
  import { ui } from '../state/ui.svelte';
  import SlideView from './SlideView.svelte';

  const open = $derived(ui.overlay === 'overview');
  const slides = $derived(deck.current?.slides ?? []);
  const size = $derived(stageSize(deck.current?.meta.aspect));
  const width = $derived(Math.max(2, String(slides.length).length));
  const pad = (n: number) => String(n).padStart(width, '0');

  let selected = $state(0);
  let grid: HTMLElement | undefined = $state();
  let buttons: HTMLButtonElement[] = $state([]);
  // Thumbnail scale: the width of a cell over the stage width. Every cell is
  // the same width (1fr columns), so one measurement serves them all.
  let k = $state(0);

  function choose(i: number) {
    goto(i);
    ui.overlay = null;
  }

  function columns(): number {
    if (!grid) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
  }

  function select(i: number) {
    selected = Math.max(0, Math.min(slides.length - 1, i));
    buttons[selected]?.focus();
  }

  // Opening: select the current slide, scroll it into view, focus it.
  // Closing: focus goes back to the page.
  $effect(() => {
    if (!open || !grid) return;
    const el = grid;
    const W = size.W;
    const measure = () => {
      const canvas = el.querySelector<HTMLElement>('.canvas');
      if (canvas) k = canvas.getBoundingClientRect().width / W;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);

    untrack(() => {
      selected = Math.min(nav.index, Math.max(0, slides.length - 1));
      const button = buttons[selected];
      button?.scrollIntoView({ block: 'center' });
      button?.focus({ preventScroll: true });
    });

    return () => {
      observer.disconnect();
      if (document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    };
  });

  // Captured on the window, so the keys work wherever focus is and never reach
  // the deck's navigation commands. `g`, `Esc` and digits fall through.
  $effect(() => {
    if (!open) return;
    const onkeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      let to: number;
      switch (event.key) {
        case 'ArrowRight':
          to = selected + 1;
          break;
        case 'ArrowLeft':
          to = selected - 1;
          break;
        case 'ArrowDown':
          to = selected + columns();
          break;
        case 'ArrowUp':
          to = selected - columns();
          break;
        case 'Home':
          to = 0;
          break;
        case 'End':
          to = slides.length - 1;
          break;
        case 'Enter':
          // Digits typed for go-to take Enter (lib/overlays.ts).
          if (ui.goto !== '') return;
          event.preventDefault();
          choose(selected);
          return;
        default:
          return;
      }
      event.preventDefault();
      if (to >= 0 && to < slides.length) select(to);
    };
    window.addEventListener('keydown', onkeydown, true);
    return () => window.removeEventListener('keydown', onkeydown, true);
  });

  function close() {
    ui.overlay = null;
  }
</script>

{#if open && deck.current}
  <div class="overview" role="dialog" aria-modal="true" aria-label="Slides">
    <header class="head">
      <div class="title">
        <span class="square" aria-hidden="true"></span>
        <span class="label">{deck.current.meta.title}</span>
        <span class="label count">{slides.length} slides</span>
      </div>
      <button class="label label-btn close" type="button" onclick={close}>Close</button>
    </header>

    <ol class="grid" bind:this={grid} style:--W="{size.W}px" style:--H="{size.H}px" style:--k={k}>
      {#each slides as slide, i (slide.id)}
        <li class="thumb" class:current={i === nav.index} class:skip={slide.options.skip} class:selected={i === selected}>
          <div class="frame">
            <div class="canvas" style:aspect-ratio="{size.W} / {size.H}" inert>
              <div class="scaler">
                <SlideView {slide} revealAll current={false} />
              </div>
            </div>
          </div>
          <div class="caption">
            <span class="label num">{pad(i + 1)}</span>
            {#if hasMarks(slide.id)}<span class="has-marks" role="img" title="Has marks" aria-label="Has marks"></span>{/if}
            <span class="label name">{slide.title ?? ''}</span>
            {#if slide.options.skip}<span class="label tag">Skip</span>{/if}
          </div>
          <button
            bind:this={buttons[i]}
            class="hit"
            type="button"
            tabindex={i === selected ? 0 : -1}
            aria-label="Slide {i + 1}{slide.title ? `: ${slide.title}` : ''}{slide.options.skip ? ' (skipped)' : ''}"
            aria-current={i === nav.index ? 'true' : undefined}
            onfocus={() => (selected = i)}
            onclick={() => choose(i)}
          ></button>
        </li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .overview {
    position: fixed;
    inset: 0;
    z-index: 30;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
    animation: fade-in var(--t-fast) var(--ease);
  }

  /* Same height, padding, and hairline as the top bar. */
  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--bar-top);
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .square {
    flex: none;
    width: 10px;
    height: 10px;
    background: var(--ink);
  }

  .title .label {
    white-space: nowrap;
  }

  .count {
    margin-left: 8px;
    color: var(--ink-4);
  }

  .close {
    padding: 8px;
    margin: -8px;
    color: var(--ink-3);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 24px;
    margin: 0;
    padding: 32px 40px 48px;
    list-style: none;
  }

  .thumb {
    position: relative;
    min-width: 0;
  }

  /* A 1px --line border; the current slide's is --ink. */
  .frame {
    border: 1px solid var(--line);
    transition: border-color var(--t-fast) var(--ease);
  }

  .thumb:hover .frame {
    border-color: var(--ink-4);
  }

  .thumb.current .frame {
    border-color: var(--ink);
  }

  /* Off-screen thumbnails are neither laid out nor painted. The box keeps its
     size from the aspect ratio, so scroll positions stay right. */
  .canvas {
    position: relative;
    overflow: hidden;
    content-visibility: auto;
  }

  .scaler {
    position: absolute;
    top: 0;
    left: 0;
    width: var(--W);
    height: var(--H);
    transform: scale(var(--k));
    transform-origin: 0 0;
    pointer-events: none;
  }

  .caption {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 10px;
    min-width: 0;
  }

  .num {
    flex: none;
  }

  /* A slide with drawings or notes: a small solid square beside its number. */
  .has-marks {
    flex: none;
    align-self: center;
    width: 6px;
    height: 6px;
    margin-left: -2px;
    background: var(--ink);
  }

  .current .num,
  .current .name {
    color: var(--ink);
  }

  .name {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag {
    flex: none;
    margin-left: auto;
    color: var(--ink);
  }

  .skip .frame,
  .skip .num,
  .skip .name {
    opacity: 0.4;
  }

  /* The whole thumbnail is the button; the selection ring is its focus ring,
     drawn around the frame. */
  .hit {
    appearance: none;
    position: absolute;
    inset: -4px;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }

  .hit:focus-visible {
    outline: 1px solid var(--ink);
    outline-offset: 0;
  }

  /* On the current slide the --ink frame already marks it: a ring 4px
     outside that frame read as a double border. */
  .thumb.current .hit:focus-visible {
    outline-color: transparent;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
