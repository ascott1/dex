<script lang="ts">
  // The laser pointer (§9 Phase 6 "Laser"): `l` toggles. A 14px --red dot
  // follows the pointer with a short fading trail of its last 12 positions.
  // Nothing is stored. Mounted in .stage, outside .camera, so it is placed from
  // the pointer's offset in .stage divided by the stage scale: it follows the
  // pointer, not the slide, whatever the camera is doing.
  import { ui } from '../state/ui.svelte';

  const TRAIL = 12;
  const TRAIL_MS = 220;   // a trail point fades out over this long once the pointer rests

  let svg: SVGSVGElement;
  let dot: { x: number; y: number } | null = $state(null);
  let trail: { x: number; y: number; t: number }[] = $state.raw([]);
  let now = $state(0);

  const on = $derived(ui.tool === 'laser');

  $effect(() => {
    if (!on) return;
    const stage = svg.parentElement;
    const viewport = svg.closest<HTMLElement>('.viewport');
    if (!stage || !viewport) return;
    let frame = 0;

    const tickFrame = () => {
      now = performance.now();
      trail = trail.filter((p) => now - p.t < TRAIL_MS);
      frame = trail.length > 0 ? requestAnimationFrame(tickFrame) : 0;
    };

    const move = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !viewport.contains(e.target)) {
        dot = null;
        return;
      }
      const rect = stage.getBoundingClientRect();
      const scale = rect.width / stage.offsetWidth || 1;
      const t = performance.now();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const points = (events.length > 0 ? events : [e]).map((ev) => ({
        x: (ev.clientX - rect.left) / scale,
        y: (ev.clientY - rect.top) / scale,
        t,
      }));
      const last = points[points.length - 1]!;
      if (dot) trail = [...trail, { ...dot, t }, ...points.slice(0, -1)].slice(-TRAIL);
      dot = { x: last.x, y: last.y };
      now = t;
      if (!frame) frame = requestAnimationFrame(tickFrame);
    };
    const leave = () => {
      dot = null;
      trail = [];
    };

    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(frame);
      dot = null;
      trail = [];
    };
  });
</script>

<svg bind:this={svg} class="laser" aria-hidden="true">
  {#if on && dot}
    {#each trail as p, i (i)}
      {@const age = Math.min(1, (now - p.t) / TRAIL_MS)}
      {@const rank = (i + 1) / (trail.length + 1)}
      <circle cx={p.x} cy={p.y} r={7 * (0.35 + 0.65 * rank)} opacity={0.5 * rank * (1 - age)} />
    {/each}
    <circle class="dot" cx={dot.x} cy={dot.y} r="7" />
  {/if}
</svg>

<style>
  .laser {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    overflow: visible;
    pointer-events: none;
    z-index: 5;
  }

  circle {
    fill: var(--red);
  }

  /* The system cursor is hidden while the laser is on. */
  :global(.app[data-tool='laser'] .viewport),
  :global(.app[data-tool='laser'] .viewport *) {
    cursor: none;
  }
</style>
