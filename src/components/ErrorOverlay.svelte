<script lang="ts">
  // A compile or load error while a deck is showing: one mono --red line at the
  // bottom-left, dismissible. The last good deck stays on screen (§9 Phase 3, task 8).
  import { deck, dismissError } from '../state/deck.svelte';
</script>

{#if deck.error && deck.current}
  <div class="error" role="alert">
    <span class="where">{deck.errorLine !== null ? `Line ${deck.errorLine}` : 'Error'}</span>
    <span class="message">{deck.error}</span>
    <button class="label label-btn dismiss" type="button" aria-label="Dismiss error" onclick={dismissError}>×</button>
  </div>
{/if}

<style>
  .error {
    position: fixed;
    left: 20px;
    bottom: calc(var(--bar-bottom) + 12px);
    z-index: 40;
    max-width: calc(100vw - 40px);
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 12px;
    background: var(--bg);
    border: 1px solid var(--red);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    color: var(--red);
  }

  .where {
    flex: none;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 10px;
  }

  .message {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .dismiss {
    flex: none;
    color: var(--red);
    font-size: 13px;
  }
</style>
