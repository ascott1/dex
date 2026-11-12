<script lang="ts">
  import { runCommand } from '../lib/commands';
  import { deck } from '../state/deck.svelte';
  import { goto, nav, next, prev } from '../state/nav.svelte';
  import { resetCamera, ui } from '../state/ui.svelte';
  import DrawBar from './DrawBar.svelte';

  const count = $derived(deck.current?.slides.length ?? 0);
  const width = $derived(Math.max(2, String(count).length));
  const pad = (n: number) => String(n).padStart(width, '0');
  const counter = $derived(count === 0 ? `${pad(0)} / ${pad(0)}` : `${pad(nav.index + 1)} / ${pad(count)}`);

  // Compile warnings are a dev-only aid (Phase 3, task 12).
  const warnings = $derived(import.meta.env.DEV ? (deck.current?.warnings ?? []) : []);
  const zoom = $derived(Math.round(ui.camera.k * 100));

  const keepFocus = (event: PointerEvent) => event.preventDefault();

  function openWarning(slide: number) {
    goto(Math.max(0, slide));
    ui.warnings = false;
  }

  $effect(() => {
    if (warnings.length === 0) ui.warnings = false;
  });
</script>

<footer class="bottombar">
  <div class="left">
    <button class="label label-btn arrow" type="button" aria-label="Previous" onpointerdown={keepFocus} onclick={prev}>←</button>
    <button class="label label-btn arrow" type="button" aria-label="Next" onpointerdown={keepFocus} onclick={next}>→</button>
    <span class="label counter" aria-label="Slide {nav.index + 1} of {count}">{counter}</span>
  </div>

  <div class="right">
    {#if warnings.length > 0}
      <button class="label label-btn warn" type="button" aria-expanded={ui.warnings}
        onpointerdown={keepFocus} onclick={() => (ui.warnings = !ui.warnings)}>
        {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
      </button>
    {/if}
    {#if ui.tool === 'draw'}
      <DrawBar />
    {:else}
      {#if ui.camera.k > 1}
        <button class="label label-btn zoom" type="button" title="Reset zoom" onpointerdown={keepFocus} onclick={resetCamera}>{zoom}%</button>
      {/if}
      <button class="label label-btn" type="button" onpointerdown={keepFocus} onclick={() => runCommand('note')}>Note</button>
      <button class="label label-btn" type="button" onpointerdown={keepFocus} onclick={() => runCommand('draw')}>Draw</button>
    {/if}
  </div>

  {#if ui.warnings && warnings.length > 0}
    <div class="warnings" role="dialog" aria-label="Compile warnings">
      {#each warnings as w, i (i)}
        <button class="row" type="button" onclick={() => openWarning(w.slide)}>
          <span class="label">{w.slide >= 0 ? pad(w.slide + 1) : '—'}</span>
          <span class="label">L{w.line}</span>
          <span class="message">{w.message}</span>
        </button>
      {/each}
    </div>
  {/if}
</footer>

<style>
  .bottombar {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 20;
    height: var(--bar-bottom);
    padding: 0 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--line);
    pointer-events: none;
    transition:
      opacity var(--t-med) var(--ease),
      border-color var(--t-med) var(--ease);
  }

  :global(.app[data-chrome='hidden']) .bottombar {
    opacity: 0;
  }

  :global(.app[data-chrome='hidden']) .bottombar * {
    pointer-events: none !important;
  }

  .left,
  .right {
    display: flex;
    align-items: center;
  }

  .right {
    gap: 24px;
  }

  button {
    pointer-events: auto;
  }

  /* ← at 20px and → at 50px from the left, counter at 69px (§8 reference).
     The glyph is 6px wide; the padding widens the hit area without moving it. */
  .arrow {
    padding: 10px 6px;
    margin: 0 -6px;
  }

  .arrow + .arrow {
    margin-left: calc(24px - 6px);
  }

  .counter {
    margin-left: 13px;
  }

  .warn {
    color: var(--red);
  }

  .warn:hover {
    color: var(--red);
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .warnings {
    position: absolute;
    right: 20px;
    bottom: calc(100% + 12px);
    width: min(520px, calc(100vw - 40px));
    max-height: min(320px, calc(100vh - 160px));
    overflow: auto;
    border: 1px solid var(--ink);
    background: var(--bg);
    pointer-events: auto;
  }

  .row {
    appearance: none;
    display: grid;
    grid-template-columns: 32px 44px 1fr;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-top: 1px solid var(--line);
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .row:first-child {
    border-top: 0;
  }

  .row:hover {
    background: var(--tint);
  }

  .message {
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink);
  }
</style>
