<script lang="ts">
  import type { ThemeName } from '$shared/types';

  // Phase 0 placeholder. Phase 3 replaces this with the §7 skeleton.

  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  }

  function onkeydown(event: KeyboardEvent) {
    if (isEditable(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== 't') return;
    const root = document.documentElement;
    const next: ThemeName = root.dataset.theme === 'ink' ? 'paper' : 'ink';
    root.dataset.theme = next;
  }
</script>

<svelte:window {onkeydown} />

<main>
  <h1>dex</h1>
  <p class="label">Markdown in, deck out · press t</p>
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  h1 {
    font-family: var(--font-sans);
    font-size: 80px;
    line-height: 1.02;
    font-weight: 500;
    letter-spacing: -0.03em;
    color: var(--ink);
  }

  .label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-3);
  }
</style>
