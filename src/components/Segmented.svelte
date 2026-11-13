<script lang="ts" generics="T">
  // A segmented control (§8 "Segmented control", §9 Phase 5 task 1): equal
  // cells in a row with shared 1px --line borders; the selected cell is filled.
  // A radio group: one tab stop, arrow keys move the selection.
  interface Option {
    value: T;
    label: string;
    sublabel?: string;
    title?: string;
  }

  interface Props {
    options: Option[];
    value: T;
    /** Accessible name of the group (the section label). */
    label?: string;
  }

  let { options, value = $bindable(), label }: Props = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  const selected = $derived(options.findIndex((o) => o.value === value));

  function select(i: number, focus = false) {
    const option = options[i];
    if (!option) return;
    value = option.value;
    if (focus) buttons[i]?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    const n = options.length;
    const from = selected < 0 ? 0 : selected;
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        to = (from + 1) % n;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        to = (from - 1 + n) % n;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = n - 1;
        break;
      default:
        return;
    }
    // Keep the key from the global handler (it skips prevented events).
    event.preventDefault();
    select(to, true);
  }
</script>

<!-- The radios are the tab stop (roving tabindex), not the group. -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="segmented" role="radiogroup" aria-label={label} {onkeydown}>
  {#each options as option, i (i)}
    <button
      bind:this={buttons[i]}
      class="cell"
      type="button"
      role="radio"
      aria-checked={i === selected}
      tabindex={i === selected || (selected < 0 && i === 0) ? 0 : -1}
      title={option.title}
      onclick={() => select(i)}
    >
      <span class="control-text">{option.label}</span>
      {#if option.sublabel}
        <span class="sublabel">{option.sublabel}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }

  /* Every cell is 41px tall (§8), borders included, so the controls in a sheet
     line up as one family. Neighbouring cells share one border: each cell
     after the first overlaps the last by 1px. */
  .cell {
    appearance: none;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: 5px;
    min-width: 0;
    height: 41px;
    margin: 0;
    padding: 0 8px;
    border: 1px solid var(--line);
    background: none;
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--t-fast) var(--ease),
      border-color var(--t-fast) var(--ease);
  }

  .cell + .cell {
    margin-left: -1px;
  }

  .cell:hover {
    background: var(--tint);
  }

  .cell span {
    max-width: 100%;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell .control-text {
    line-height: 16px;
    transition: color var(--t-fast) var(--ease);
  }

  .cell[aria-checked='true'] {
    z-index: 1;
    border-color: var(--fill);
    background: var(--fill);
  }

  .cell[aria-checked='true'] .control-text,
  .cell[aria-checked='true'] .sublabel {
    color: var(--on-fill);
  }

  .cell[aria-checked='true'] .sublabel {
    opacity: 0.6;
  }

  /* The focus ring sits outside the cell; lift it above the neighbours. */
  .cell:focus-visible {
    z-index: 2;
  }
</style>
