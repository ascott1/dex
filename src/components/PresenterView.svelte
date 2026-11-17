<script lang="ts">
  // The presenter window at #/<slug>/presenter (§9 Phase 8 task 3): the current
  // slide at its build step, the next slide, a timer and the wall clock, and
  // the speaker notes. View and drive only: every navigation key works here
  // and moves the audience window (lib/session.svelte.ts); marks are shown,
  // never edited.
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import type { Deck, Slide } from '$shared/types';
  import { deckFile } from '../lib/paths';
  import { session } from '../lib/session.svelte';
  import { stageSize } from '../lib/stage';
  import { deck } from '../state/deck.svelte';
  import { nav, nextShown } from '../state/nav.svelte';
  import { slideTheme } from '../state/settings.svelte';
  import { ui } from '../state/ui.svelte';
  import DrawLayer from './DrawLayer.svelte';
  import NotesLayer from './NotesLayer.svelte';
  import SlideView from './SlideView.svelte';

  const slides = $derived(deck.current?.slides ?? []);
  const size = $derived(stageSize(deck.current?.meta.aspect));
  const current = $derived(slides[nav.index]);
  const nextIndex = $derived(current ? nextShown(nav.index) : -1);
  const next = $derived(nextIndex >= 0 ? slides[nextIndex] : undefined);
  const width = $derived(Math.max(2, String(slides.length).length));
  const pad = (n: number) => String(n).padStart(width, '0');

  // ── Scaling: each frame measures its own width (fractional, see Overview) ──
  let kCurrent = $state(0);
  let kNext = $state(0);
  const setCurrent = (k: number) => (kCurrent = k);
  const setNext = (k: number) => (kNext = k);

  function measure(set: (k: number) => void): Attachment<HTMLElement> {
    return (node) => {
      const W = size.W;
      const update = () => set(node.getBoundingClientRect().width / W);
      update();
      const observer = new ResizeObserver(update);
      observer.observe(node);
      return () => observer.disconnect();
    };
  }

  // ── Timer: starts on the first navigation, click pauses, double-click resets ──
  type TimerState = 'idle' | 'running' | 'paused';
  let timer = $state<TimerState>('idle');
  let elapsed = $state(0);      // ms banked before the current run
  let since = $state(0);        // Date.now() when the current run started
  let now = $state(Date.now());

  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(id);
  });

  function start() {
    since = Date.now();
    now = since;
    timer = 'running';
  }

  function pause() {
    elapsed += Date.now() - since;
    now = Date.now();
    timer = 'paused';
  }

  function onTimerClick(event: MouseEvent) {
    // The second click of a double-click: the double-click resets.
    if (event.detail > 1) return;
    if (timer === 'running') pause();
    else start();
  }

  function onTimerDblclick() {
    timer = 'idle';
    elapsed = 0;
  }

  const shownMs = $derived(timer === 'running' ? elapsed + Math.max(0, now - since) : elapsed);
  const two = (n: number) => String(n).padStart(2, '0');
  const timerText = $derived.by(() => {
    const s = Math.floor(shownMs / 1000);
    return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  });
  const clockText = $derived(new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  // A slide or step change starts an idle timer. Changes made by the deck
  // loading or reloading, and anything before this window has joined, do not.
  let baseline: string | null = null;
  let baseDeck: Deck | null = null;
  $effect(() => {
    const key = `${nav.index}:${nav.step}`;
    const d = deck.current;
    const joined = session.joined;
    untrack(() => {
      if (!joined || !d) {
        baseline = null;
        return;
      }
      if (baseline !== null && d === baseDeck && key !== baseline && timer === 'idle') start();
      baseline = key;
      baseDeck = d;
    });
  });

  function keepFocus(event: PointerEvent) {
    // A click must not leave focus on a button: Space would press it again
    // instead of moving to the next step.
    event.preventDefault();
  }
</script>

{#snippet frame(slide: Slide | undefined, step: number, k: number, set: (k: number) => void, which: string)}
  <div class="frame {which}">
    <div class="canvas" style:aspect-ratio="{size.W} / {size.H}" inert {@attach measure(set)}>
      {#if slide}
        <div class="scaler" style:--k={k} data-slide={slide.id}>
          <SlideView {slide} {step} current={false} />
          <DrawLayer slideId={slide.id} interactive={false} theme={slideTheme(slide)} />
          <NotesLayer slideId={slide.id} interactive={false} theme={slideTheme(slide)} />
        </div>
      {/if}
      {#if !slide}<p class="label end">End of deck</p>{/if}
      {#if which === 'current' && ui.blackout}<div class="black" aria-hidden="true"></div>{/if}
    </div>
  </div>
{/snippet}

<div class="presenter" style:--W="{size.W}px" style:--H="{size.H}px" style:--ratio={size.W / size.H}>
  {#if !deck.current}
    {#if deck.error}
      <div class="empty">
        <p class="label">Cannot open deck</p>
        <p class="help-text">{deck.error}</p>
      </div>
    {/if}
  {:else if !current}
    <div class="empty">
      <p class="label">No slides yet</p>
      <p class="help-text">{deckFile(deck.current.slug)}</p>
    </div>
  {:else}
    <section class="main" aria-label="Current slide">
      {@render frame(current, nav.step, kCurrent, setCurrent, 'current')}
      <div class="meta">
        <span class="label strong" data-counter>Slide {pad(nav.index + 1)} / {pad(slides.length)}</span>
        {#if current.steps > 0}
          <span class="label" data-step-counter>Step {nav.step} / {current.steps}</span>
        {/if}
        {#if current.options.skip}<span class="label">Skip</span>{/if}
        <span class="spacer"></span>
        {#if ui.goto}<span class="label strong" data-goto>Go to {ui.goto}</span>{/if}
        {#if ui.blackout}
          <button
            class="label label-btn strong"
            type="button"
            data-blackout-label
            onpointerdown={keepFocus}
            onclick={() => (ui.blackout = false)}
          >Blackout · any key returns</button>
        {/if}
      </div>

      <p class="label heading">Notes</p>
      <div class="notes" data-notes>
        {#if current.notes}
          {@html current.notes}
        {:else}
          <p class="label none">No notes</p>
        {/if}
      </div>
    </section>

    <aside class="side">
      {@render frame(next, 0, kNext, setNext, 'next')}
      <div class="meta">
        <span class="label" data-next-label>{next ? 'Next' : 'End'}</span>
        {#if next}<span class="label name">{next.title ?? ''}</span>{/if}
      </div>

      <div class="clocks">
        <button
          class="timer"
          type="button"
          data-timer={timer}
          title="Click to pause, double-click to reset"
          aria-label="Timer {timerText}, {timer === 'running' ? 'running' : timer === 'paused' ? 'paused' : 'starts on the first slide change'}. Click to pause, double-click to reset."
          onpointerdown={keepFocus}
          onclick={onTimerClick}
          ondblclick={onTimerDblclick}
        >{timerText}</button>
        <span class="label" data-clock>{clockText}</span>
        {#if timer === 'paused'}<span class="label paused">Paused</span>{/if}
      </div>
    </aside>
  {/if}
</div>

<style>
  .presenter {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-columns: minmax(0, 62fr) minmax(0, 38fr);
    gap: 24px;
    padding: 24px;
    background: var(--bg);
    color: var(--ink);
    transition:
      background-color var(--t-med) var(--ease),
      color var(--t-med) var(--ease);
  }

  .main,
  .side {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  /* The current slide is as wide as its column, unless the window is too
     short: then it is as tall as fits with its labels and at least 220px of
     notes under it. The notes sit under the current slide, where the eye
     already is; at 1280×800 they fill what was empty space (Phase 10). */
  .frame {
    flex: none;
    border: 1px solid var(--line);
  }

  .frame.current {
    width: min(100%, calc((100vh - 48px - 36px - 220px) * var(--ratio)));
  }

  .frame.next {
    width: min(100%, calc(32vh * var(--ratio)));
  }

  .canvas {
    position: relative;
    overflow: hidden;
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

  /* What the audience sees while blacked out. */
  .black {
    position: absolute;
    inset: 0;
    background: var(--blackout);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 36px;
    padding-top: 2px;
  }

  .spacer {
    flex: 1;
  }

  .strong {
    color: var(--ink);
  }

  .label-btn.strong:hover {
    color: var(--ink-2);
  }

  .heading {
    margin: 20px 0 12px;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .end {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    color: var(--ink-4);
  }

  .clocks {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin: 16px 0 0;
  }

  .timer {
    appearance: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: 40px;
    font-weight: 400;
    line-height: 1;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    transition: color var(--t-fast) var(--ease);
  }

  /* Idle is --ink-3, not --ink-4, which on Ink was too faint to find at a
     glance (Phase 10); paused is a step darker, with its PAUSED label. */
  .timer[data-timer='idle'] {
    color: var(--ink-3);
  }

  .timer[data-timer='paused'] {
    color: var(--ink-2);
  }

  .timer:hover {
    color: var(--ink-2);
  }

  .paused {
    color: var(--ink);
  }

  .notes {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
    font-family: var(--font-sans);
    font-size: 22px;
    line-height: 1.5;
    color: var(--ink);
    text-wrap: pretty;
  }

  .notes :global(p),
  .notes :global(ul),
  .notes :global(ol),
  .notes :global(blockquote),
  .notes :global(pre) {
    margin: 0 0 0.6em;
  }

  .notes :global(ul),
  .notes :global(ol) {
    padding-left: 1.2em;
  }

  .notes :global(li + li) {
    margin-top: 0.2em;
  }

  .notes :global(strong) {
    font-weight: 700;
  }

  .notes :global(code) {
    font-family: var(--font-mono);
    font-size: 0.82em;
    padding: 0.1em 0.3em;
    background: var(--tint);
  }

  .notes :global(pre) {
    overflow-x: auto;
  }

  .notes :global(pre code) {
    padding: 0;
    background: none;
  }

  .notes :global(blockquote) {
    padding-left: 0.8em;
    border-left: 2px solid var(--line);
    color: var(--ink-2);
  }

  .notes :global(a) {
    color: var(--ink);
    text-underline-offset: 0.18em;
  }

  .notes .none {
    margin: 0;
  }

  .empty {
    grid-column: 1 / -1;
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
