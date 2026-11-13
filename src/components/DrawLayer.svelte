<script module lang="ts">
  import type { Stroke } from '$shared/types';
  import { freehandPath } from '../lib/strokes';

  // Strokes never change once committed, so a path is computed once per stroke.
  const paths = new Map<string, { key: string; d: string }>();
  function pathFor(stroke: Stroke): string {
    const key = `${stroke.tool}:${stroke.size}:${stroke.points.length}`;
    const hit = paths.get(stroke.id);
    if (hit && hit.key === key) return hit.d;
    const d = freehandPath(stroke);
    if (paths.size > 5000) paths.clear();
    paths.set(stroke.id, { key, d });
    return d;
  }

  const COLORS = { ink: 'var(--ink)', red: 'var(--red)', blue: 'var(--blue)' } as const;
</script>

<script lang="ts">
  // The drawing layer (§9 Phase 6 "Drawing"): an SVG in stage logical pixels
  // inside .camera, above the slides. It shows one slide's strokes: by default
  // the current slide's, taking input while the draw tool is on. Phase 8 and 9
  // render other slides with `slideId` and `interactive={false}`.
  //
  // Input is taken on the whole stage area (`.viewport`), not only the stage,
  // so a mark can start in the letterbox over a full-bleed picture. Points go
  // through clientToStage, so they land under the pointer at any scale or zoom.
  import type { ThemeName } from '$shared/types';
  import { clientToStage, stageSize } from '../lib/stage';
  import { MIN_SHAPE, NO_PRESSURE, arrowHead, boxRect, shapeLength } from '../lib/strokes';
  import { deck } from '../state/deck.svelte';
  import { addStroke, currentSlideId, marks, newId, removeStrokes, slideMarks } from '../state/marks.svelte';
  import { settings } from '../state/settings.svelte';
  import { ui } from '../state/ui.svelte';

  interface Props {
    /** The slide whose marks are shown. Defaults to the current slide. */
    slideId?: string;
    /** Take pointer input while the draw tool is on. False for thumbnails, presenter, print. */
    interactive?: boolean;
    /** Theme for the pen colours; defaults to the inherited one (the current slide's). */
    theme?: ThemeName;
    /** Show the marks even when the MARKS setting hides them (print can decide for itself). */
    force?: boolean;
  }

  let { slideId, interactive = true, theme, force = false }: Props = $props();

  let svg: SVGSVGElement;

  const id = $derived(slideId ?? currentSlideId());
  const size = $derived(stageSize(deck.current?.meta.aspect));
  const strokes = $derived(slideMarks(id).strokes);
  const shown = $derived(force || settings.marks);
  const active = $derived(interactive && ui.tool === 'draw' && marks.loaded && !!id);
  const erasing = $derived(active && settings.pen.tool === 'eraser');

  // The stroke being drawn. Its points live in a plain array; `tick` re-renders.
  let live: Stroke | null = $state.raw(null);
  let liveSlide: string | null = null;
  let tick = $state(0);
  // Strokes the eraser has touched in this gesture: hidden now, removed on release.
  let erased: Set<string> = $state.raw(new Set());

  const livePath = $derived.by(() => {
    void tick;
    return live && (live.tool === 'pen' || live.tool === 'marker') ? freehandPath(live, false) : '';
  });

  const ERASE_RADIUS = 6;   // CSS px around the pointer that count as touching

  function erase(clientX: number, clientY: number) {
    const found = new Set(erased);
    const offsets = [[0, 0]];
    for (let a = 0; a < 8; a++) {
      offsets.push([Math.cos((a * Math.PI) / 4) * ERASE_RADIUS, Math.sin((a * Math.PI) / 4) * ERASE_RADIUS]);
    }
    for (const [dx, dy] of offsets) {
      for (const el of document.elementsFromPoint(clientX + dx!, clientY + dy!)) {
        const mark = el.closest('[data-stroke]');
        if (mark && svg.contains(mark)) found.add(mark.getAttribute('data-stroke')!);
      }
    }
    if (found.size !== erased.size) erased = found;
  }

  $effect(() => {
    if (!active) return;
    const viewport = svg.closest<HTMLElement>('.viewport');
    if (!viewport) return;
    let pointer: number | null = null;
    let last: { x: number; y: number } | null = null;

    const point = (e: PointerEvent): [number, number, number] | null => {
      const p = clientToStage(e);
      if (!p) return null;
      const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : NO_PRESSURE;
      return [p.x, p.y, pressure];
    };

    const down = (e: PointerEvent) => {
      if (pointer !== null || e.button !== 0 || !e.isPrimary) return;
      const slide = currentSlideId();
      if (!slide) return;
      e.preventDefault();
      pointer = e.pointerId;
      viewport.setPointerCapture(e.pointerId);
      liveSlide = slide;
      if (settings.pen.tool === 'eraser') {
        erased = new Set();
        last = { x: e.clientX, y: e.clientY };
        erase(e.clientX, e.clientY);
        return;
      }
      const p = point(e);
      if (!p) return;
      const tool = settings.pen.tool;
      live = {
        id: newId('s'),
        tool,
        color: settings.pen.color,
        size: settings.pen.size,
        points: tool === 'arrow' || tool === 'box' ? [p, p] : [p],
      };
      tick++;
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      if (settings.pen.tool === 'eraser' && !live) {
        // Sample along the segment so a quick swipe does not skip a thin stroke.
        const from = last ?? { x: e.clientX, y: e.clientY };
        const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - from.x, e.clientY - from.y) / 4));
        for (let i = 1; i <= steps; i++) {
          erase(from.x + ((e.clientX - from.x) * i) / steps, from.y + ((e.clientY - from.y) * i) / steps);
        }
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!live) return;
      if (live.tool === 'arrow' || live.tool === 'box') {
        const p = point(e);
        if (p) live.points[1] = p;
      } else {
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ev of events.length > 0 ? events : [e]) {
          const p = point(ev);
          if (p) live.points.push(p);
        }
      }
      tick++;
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      last = null;
      if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
      const slide = liveSlide;
      liveSlide = null;
      if (erased.size > 0 && slide) removeStrokes(slide, [...erased]);
      erased = new Set();
      const stroke = live;
      live = null;
      if (!stroke || !slide || e.type === 'pointercancel') return;
      const shape = stroke.tool === 'arrow' || stroke.tool === 'box';
      if (shape ? shapeLength(stroke.points) < MIN_SHAPE : stroke.points.length < 2) return;
      addStroke(slide, stroke);
    };

    viewport.addEventListener('pointerdown', down);
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
    viewport.addEventListener('pointercancel', up);
    return () => {
      viewport.removeEventListener('pointerdown', down);
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', up);
      viewport.removeEventListener('pointercancel', up);
      live = null;
      erased = new Set();
    };
  });
</script>

{#snippet mark(stroke: Stroke, d: string | null)}
  {#if stroke.tool === 'arrow'}
    {@const [x1, y1] = stroke.points[0]!}
    {@const [x2, y2] = stroke.points[stroke.points.length - 1]!}
    <g class="shape" data-stroke={stroke.id} style:stroke={COLORS[stroke.color]} stroke-width={stroke.size}>
      <line {x1} {y1} {x2} {y2} />
      {#each arrowHead(stroke) as [ax, ay, bx, by], i (i)}
        <line x1={ax} y1={ay} x2={bx} y2={by} />
      {/each}
    </g>
  {:else if stroke.tool === 'box'}
    {@const r = boxRect(stroke)}
    <rect class="shape" data-stroke={stroke.id} x={r.x} y={r.y} width={r.width} height={r.height}
      style:stroke={COLORS[stroke.color]} stroke-width={stroke.size} />
  {:else}
    <path class={stroke.tool} data-stroke={stroke.id} d={d ?? pathFor(stroke)}
      style:fill={stroke.tool === 'marker' ? undefined : COLORS[stroke.color]} />
  {/if}
{/snippet}

<svg
  bind:this={svg}
  class="draw-layer"
  class:erasing
  viewBox="0 0 {size.W} {size.H}"
  data-theme={theme}
  data-slide={id}
  aria-hidden="true"
>
  {#if shown}
    {#each strokes as stroke (stroke.id)}
      {#if !erased.has(stroke.id)}
        {@render mark(stroke, null)}
      {/if}
    {/each}
    {#if live}
      {#key tick}
        {@render mark(live, livePath || null)}
      {/key}
    {/if}
  {/if}
</svg>

<style>
  .draw-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    overflow: visible;
    pointer-events: none;
  }

  /* The eraser finds marks with elementsFromPoint, which only sees elements
     that take pointer events. */
  .erasing :global([data-stroke]) {
    pointer-events: visiblePainted;
  }

  .shape {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .marker {
    fill: var(--marker);
    opacity: 0.45;
    mix-blend-mode: multiply;
  }

  /* On Ink, 45% of the yellow screened over a near-black page is a dull olive.
     At 60% it reads as a highlighter, and screen keeps the light text under
     it light (Phase 10). */
  :global([data-theme='ink']) .marker {
    opacity: 0.6;
    mix-blend-mode: screen;
  }

  /* While drawing, the whole stage area takes the pointer: a thin crosshair,
     no touch scrolling, and nothing on the slides or notes in the way. */
  :global(.app[data-tool='draw'] .viewport),
  :global(.app[data-tool='draw'] .viewport *) {
    cursor: crosshair;
  }

  :global(.app[data-tool='draw'] .viewport) {
    touch-action: none;
    user-select: none;
  }

  :global(.app[data-tool='draw'] .slides) {
    pointer-events: none;
  }
</style>
