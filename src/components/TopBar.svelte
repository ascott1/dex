<script lang="ts">
  import { runCommand, toggleFullscreen } from '../lib/commands';
  import { deck } from '../state/deck.svelte';
  import { nav } from '../state/nav.svelte';
  import Icon from './Icon.svelte';

  const count = $derived(deck.current?.slides.length ?? 0);
  const progress = $derived(count === 0 ? 0 : ((nav.index + 1) / count) * 100);
  const title = $derived(deck.current?.meta.title ?? deck.slug ?? '');

  // Mouse clicks must not leave focus on a chrome button, or the next Space
  // would press it again instead of advancing.
  const keepFocus = (event: PointerEvent) => event.preventDefault();
</script>

<header class="topbar">
  <div class="title">
    <span class="square" aria-hidden="true"></span>
    <span class="label">{title}</span>
  </div>
  <div class="actions">
    <button class="icon-btn" type="button" aria-label="Overview" title="Overview (g)"
      onpointerdown={keepFocus} onclick={() => runCommand('overview')}>
      <Icon name="overview" />
    </button>
    <button class="icon-btn" type="button" aria-label="Fullscreen" title="Fullscreen (f)"
      onpointerdown={keepFocus} onclick={toggleFullscreen}>
      <Icon name="fullscreen" />
    </button>
    <button class="icon-btn" type="button" aria-label="Settings" title="Settings (s)"
      onpointerdown={keepFocus} onclick={() => runCommand('settings')}>
      <Icon name="settings" />
    </button>
  </div>
  <div class="progress" style:width="{progress}%" aria-hidden="true"></div>
</header>

<style>
  .topbar {
    position: fixed;
    inset: 0 0 auto 0;
    z-index: 20;
    height: var(--bar-top);
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
    pointer-events: none;
    transition:
      opacity var(--t-med) var(--ease),
      border-color var(--t-med) var(--ease);
  }

  :global(.app[data-chrome='hidden']) .topbar {
    opacity: 0;
  }

  :global(.app[data-chrome='hidden']) .topbar * {
    pointer-events: none;
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
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  .actions button {
    pointer-events: auto;
  }

  /* Sits on the hairline: the bar's bottom border is the last pixel row. */
  .progress {
    position: absolute;
    left: 0;
    bottom: -1px;
    height: 1px;
    background: var(--ink);
    transition: width var(--t-med) var(--ease);
  }
</style>
