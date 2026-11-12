<script lang="ts">
  import { clientToStage, fitStage, registerStageOverlay, stageSize } from '../lib/stage';
  import { deck } from '../state/deck.svelte';
  import { nav, nextShown, prevShown } from '../state/nav.svelte';
  import { ui } from '../state/ui.svelte';
  import DrawLayer from './DrawLayer.svelte';
  import Laser from './Laser.svelte';
  import NotesLayer from './NotesLayer.svelte';
  import SlideView from './SlideView.svelte';

  let viewport: HTMLElement;
  let overlay: SVGSVGElement;
  let vw = $state(0);
  let vh = $state(0);

  const size = $derived(stageSize(deck.current?.meta.aspect));
  const fit = $derived(fitStage(vw, vh, size.W, size.H));
  const slides = $derived(deck.current?.slides ?? []);
  const current = $derived(slides[nav.index]);

  // Previous, current, and next (the neighbours navigation would land on).
  // The previous one is fully revealed, the next one at step 0, as they will be shown.
  const rendered = $derived.by(() => {
    if (!current) return [];
    const list = [];
    const p = prevShown(nav.index);
    if (p >= 0) list.push({ slide: slides[p]!, step: slides[p]!.steps, current: false });
    list.push({ slide: current, step: nav.step, current: true });
    const n = nextShown(nav.index);
    if (n >= 0) list.push({ slide: slides[n]!, step: 0, current: false });
    return list;
  });

  const transition = $derived(current?.options.transition ?? deck.current?.meta.transition ?? 'fade');

  $effect(() => {
    const measure = () => {
      vw = viewport.clientWidth;
      vh = viewport.clientHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  });

  $effect(() => {
    registerStageOverlay(overlay);
    return () => registerStageOverlay(null);
  });

  function onpointermove(event: PointerEvent) {
    const p = clientToStage(event);
    if (!p) return;
    ui.pointer.x = p.x;
    ui.pointer.y = p.y;
    ui.pointer.inside = p.x >= 0 && p.y >= 0 && p.x <= size.W && p.y <= size.H;
  }

  function onpointerleave() {
    ui.pointer.inside = false;
  }
</script>

<main class="viewport" bind:this={viewport} {onpointermove} {onpointerleave}>
  <div
    class="stage"
    style:width="{size.W}px"
    style:height="{size.H}px"
    style:left="{fit.left}px"
    style:top="{fit.top}px"
    style:transform="scale({fit.scale})"
    style:--W="{size.W}px"
    style:--H="{size.H}px"
    data-scale={fit.scale.toFixed(4)}
  >
    <div
      class="camera"
      style:transform="translate({ui.camera.x}px, {ui.camera.y}px) scale({ui.camera.k})"
    >
      <!-- Coordinate reference for clientToStage (lib/stage.ts); draws nothing. -->
      <svg class="stage-ref" bind:this={overlay} viewBox="0 0 {size.W} {size.H}" aria-hidden="true"></svg>
      <div class="slides" data-transition={transition} aria-live="polite">
        {#each rendered as item (item.slide.id)}
          <SlideView slide={item.slide} step={item.step} current={item.current} />
        {/each}
      </div>
      <DrawLayer />
      <NotesLayer />
    </div>
    <Laser />
  </div>

  {#if deck.current && slides.length === 0}
    <div class="empty">
      <p class="label">No slides yet</p>
      <p class="help-text">decks/{deck.current.slug}/deck.md</p>
    </div>
  {/if}
</main>

<style>
  .viewport {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }

  .stage {
    position: absolute;
    transform-origin: 0 0;
    overflow: hidden;
  }

  .camera {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
  }

  .stage-ref {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    pointer-events: none;
    overflow: visible;
  }

  .slides {
    position: absolute;
    inset: 0;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
  }

  .empty p {
    margin: 0;
  }
</style>
