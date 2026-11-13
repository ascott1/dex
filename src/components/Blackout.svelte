<script lang="ts">
  // Blackout (§9 Phase 8 task 4): `b` or `.` covers the window with solid
  // black. Any key (lib/keys.ts) or click clears it. Synced between windows
  // (lib/session.svelte.ts); the presenter window shows a label instead.
  import { ui } from '../state/ui.svelte';

  function clear(event: MouseEvent) {
    event.preventDefault();
    ui.blackout = false;
  }
</script>

{#if ui.blackout}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="blackout" role="presentation" data-blackout onclick={clear}></div>
{/if}

<style>
  .blackout {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--blackout);
    cursor: none;
    animation: fade-in var(--t-med) var(--ease);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
