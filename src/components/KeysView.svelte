<script lang="ts">
  // The keyboard-shortcuts screen: `?`. A full-window overlay like the
  // overview. Its list comes from lib/key-help.ts, which reads the command
  // registry, so it cannot drift from the real bindings. `?` or `Esc` closes.
  import { keyGroups } from '../lib/key-help';
  import { deck } from '../state/deck.svelte';
  import { ui } from '../state/ui.svelte';

  const open = $derived(ui.overlay === 'keys');
  const groups = keyGroups();

  let view: HTMLElement | undefined = $state();

  function close() {
    ui.overlay = null;
  }

  // Focus goes in on open and back to where it was on close. Only the close
  // control is focusable, so Tab stays on it, and focus that strays outside
  // (a click on the page behind, a script) is brought back.
  $effect(() => {
    if (!open || !view) return;
    const el = view;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.focus({ preventScroll: true });
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !el.contains(event.target)) el.focus({ preventScroll: true });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      if (before && before.isConnected && before !== document.body) before.focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    };
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    view?.querySelector<HTMLElement>('.close')?.focus();
  }
</script>

{#if open && deck.current}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={view}
    class="keys"
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    tabindex="-1"
    {onkeydown}
  >
    <header class="head">
      <div class="title">
        <span class="square" aria-hidden="true"></span>
        <span class="label">Keyboard shortcuts</span>
      </div>
      <button class="label label-btn close" type="button" onclick={close}>Close</button>
    </header>

    <div class="groups">
      {#each groups as group (group.name)}
        <section class="group" aria-labelledby="keys-{group.name.replace(/\W+/g, '-').toLowerCase()}">
          <h3 class="label name" id="keys-{group.name.replace(/\W+/g, '-').toLowerCase()}">{group.name}</h3>
          <ul class="rows" role="list">
            {#each group.rows as row (row.title)}
              <li class="row" role="listitem">
                <span class="chords">
                  {#each row.keys as key, i (i)}<kbd>{key}</kbd>{/each}
                </span>
                <span class="what">{row.title}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </div>
{/if}

<style>
  .keys {
    position: fixed;
    inset: 0;
    z-index: 30;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
    color: var(--ink);
    animation: fade-in var(--t-fast) var(--ease);
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }

  .keys:focus {
    outline: none;
  }

  /* Same height, padding, and hairline as the overview's header. */
  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: var(--bar-top);
    padding: 0 16px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
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
  }

  .close {
    padding: 8px;
    margin: -8px;
    color: var(--ink-3);
  }

  /* Groups flow in columns and never split across them. */
  .groups {
    max-width: 1120px;
    margin: 0 auto;
    padding: 32px 40px 40px;
    column-count: 3;
    column-gap: 56px;
  }

  .group {
    break-inside: avoid;
    margin: 0 0 28px;
  }

  .name {
    margin: 0 0 10px;
  }

  /* One grid per group: the key column is as wide as the group's longest
     keys, so the descriptions line up. */
  .rows {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 20px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: baseline;
    padding: 4px 0;
  }

  .chords {
    display: flex;
    flex-wrap: wrap;
    gap: 0 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 20px;
    color: var(--ink);
  }

  kbd {
    font: inherit;
    white-space: nowrap;
  }

  .what {
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 20px;
    color: var(--ink-2);
    text-wrap: pretty;
  }

  @media (max-width: 900px) {
    .groups {
      column-count: 2;
    }
  }

  @media (max-width: 560px) {
    .groups {
      column-count: 1;
      padding: 24px 16px 32px;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
