<script lang="ts">
  import { untrack } from 'svelte';
  import { clampCamera } from '../lib/camera';
  import { clientToStage, fitStage, registerStageOverlay, stageSize } from '../lib/stage';
  import { attachZoom } from '../lib/zoom';
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

  // Wheel, pinch and drag-to-pan (Phase 7, lib/zoom.ts).
  $effect(() => attachZoom(viewport));

  // A live reload can change the deck's aspect, and so the stage width, while
  // zoomed: clamp the camera again so no empty space shows inside the stage.
  $effect(() => {
    const { W, H } = size;
    untrack(() => {
      const c = clampCamera(ui.camera, W, H);
      if (c.k === ui.camera.k && c.x === ui.camera.x && c.y === ui.camera.y) return;
      ui.cameraAnimate = false;
      ui.camera.k = c.k;
      ui.camera.x = c.x;
      ui.camera.y = c.y;
    });
  });

  // Drag-to-pan is armed while zoomed with no tool on (grab cursor).
  const pan = $derived(
    ui.camera.k > 1 && ui.tool === null && ui.overlay === null ? (ui.panning ? 'active' : 'ready') : undefined,
  );

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

<main class="viewport" bind:this={viewport} data-pan={pan} {onpointermove} {onpointerleave}>
  <div
    class="stage"
    style:width="{size.W}px"
    style:height="{size.H}px"
    style:left="{fit.left}px"
    style:top="{fit.top}px"
    style:transform="scale({fit.scale})"
    style:--W="{size.W}px"
    style:--H="{size.H}px"
    style:--bleed-x="{fit.scale > 0 ? fit.left / fit.scale : 0}px"
    style:--bleed-y="{fit.scale > 0 ? fit.top / fit.scale : 0}px"
    data-scale={fit.scale.toFixed(4)}
  >
    <div
      class="camera"
      class:animate={ui.cameraAnimate}
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
  /* The stage area: the whole window, or the space between docked bars. It
     clips; the stage does not, so a full-bleed layer can run past the stage's
     edges into the letterbox (--bleed-x, --bleed-y, in logical pixels). */
  .viewport {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }

  :global(.app[data-dock]) .viewport {
    top: var(--bar-top);
    bottom: var(--bar-bottom);
  }

  .stage {
    position: absolute;
    transform-origin: 0 0;
  }

  .camera {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
    /* `none`, not the default `all 0s`: dropping .animate then cancels a
       running ease, so a slide change mid-zoom snaps to 100% at once. */
    transition-property: none;
  }

  /* Key-triggered zooms ease; wheel, pinch and drag are immediate (Phase 7). */
  .camera.animate {
    transition: transform var(--t-med) var(--ease);
  }

  .viewport[data-pan] {
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .viewport[data-pan] :global(textarea) {
    user-select: text;
    -webkit-user-select: text;
  }

  .viewport[data-pan='active'],
  .viewport[data-pan='active'] :global(*) {
    cursor: grabbing;
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
