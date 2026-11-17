<script module lang="ts">
  import { getCommand } from '../lib/commands';
  import { keyLabel } from '../lib/keys';
  import { deckFile } from '../lib/paths';

  // The key that opens the keyboard-shortcuts screen, from the registry.
  const keysKey = keyLabel(getCommand('keys')?.keys[0] ?? '?');
</script>

<script lang="ts">
  // The settings sheet (§8 "Sheet", §9 Phase 5 task 2): `s`, `,`, or the
  // settings icon. Focus is trapped inside while it is open and returned on close.
  import type { ThemeName } from '$shared/types';
  import { runCommand } from '../lib/commands';
  import { formatRoute } from '../lib/router';
  import { deck, loadIndex } from '../state/deck.svelte';
  import { clearAllMarks, clearSlideMarks, hasAnyMarks, hasMarks } from '../state/marks.svelte';
  import { nav } from '../state/nav.svelte';
  import { baseTheme, setDeckTheme, settings } from '../state/settings.svelte';
  import { ui } from '../state/ui.svelte';
  import Segmented from './Segmented.svelte';

  const open = $derived(ui.overlay === 'settings');

  const current = $derived(deck.current);
  const slideId = $derived(current?.slides[nav.index]?.id);
  const skipped = $derived(current?.slides.filter((s) => s.options.skip).length ?? 0);
  // Decks for the switcher; the open deck is always there, even before the list loads.
  const decks = $derived.by(() => {
    const list = deck.list.map((d) => ({ slug: d.slug, title: d.title }));
    if (current && !list.some((d) => d.slug === current.slug)) {
      list.unshift({ slug: current.slug, title: current.meta.title });
    }
    return list;
  });

  const slideHasMarks = $derived(hasMarks(slideId));
  const deckHasMarks = $derived(hasAnyMarks());

  // CLEAR ALL asks once: the first click turns it into CONFIRM, the second clears.
  let confirming = $state(false);
  $effect(() => {
    if (!open || !deckHasMarks) confirming = false;
  });

  function clearAll() {
    if (!confirming) {
      confirming = true;
      return;
    }
    confirming = false;
    clearAllMarks();
  }

  function close() {
    ui.overlay = null;
  }

  function changeDeck(event: Event) {
    const slug = (event.currentTarget as HTMLSelectElement).value;
    if (slug && slug !== current?.slug) location.hash = formatRoute({ view: 'deck', slug, n: null });
  }

  // A new tab, so the deck stays where it is (§9 Phase 9 task 3).
  function openPrint() {
    if (!current) return;
    close();
    window.open(`${location.pathname}${location.search}${formatRoute({ view: 'print', slug: current.slug })}`, '_blank', 'noopener');
  }

  function openPresenter() {
    runCommand('presenter');
  }

  // ── Focus: trapped while open, returned on close ──
  let sheet: HTMLElement | undefined = $state();

  const FOCUSABLE =
    'button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    if (!sheet) return [];
    return [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);
  }

  $effect(() => {
    if (!open || !sheet) return;
    const el = sheet;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.focus({ preventScroll: true });
    void loadIndex();

    // Anything that moves focus outside (a click on the page behind, a script)
    // brings it back.
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
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onBackdrop(event: PointerEvent) {
    if (event.target === event.currentTarget) close();
  }
</script>

{#if open && current}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onpointerdown={onBackdrop}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={sheet}
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
      {onkeydown}
    >
      <header class="head">
        <h2 class="label" id="settings-title">Settings</h2>
        <button class="label label-btn close" type="button" onclick={close}>Close</button>
      </header>

      <h3 class="label section">Theme</h3>
      <Segmented
        label="Theme"
        bind:value={() => baseTheme(), (v: ThemeName) => setDeckTheme(v)}
        options={[
          { value: 'paper', label: 'Paper', sublabel: 'Light' },
          { value: 'ink', label: 'Ink', sublabel: 'Dark' },
        ]}
      />

      <h3 class="label section">Text</h3>
      <Segmented
        label="Text"
        bind:value={settings.textScale}
        options={[
          { value: 'quiet', label: 'Quiet', sublabel: 'Screen share', title: 'Screen share; the reference’s size' },
          { value: 'regular', label: 'Regular', sublabel: 'Most rooms' },
          { value: 'loud', label: 'Loud', sublabel: 'Big rooms' },
        ]}
      />

      <h3 class="label section">Builds</h3>
      <Segmented
        label="Builds"
        bind:value={settings.builds}
        options={[
          { value: true, label: 'On', sublabel: 'Step through lists' },
          { value: false, label: 'Off', sublabel: 'Show everything' },
        ]}
      />

      <h3 class="label section">Motion</h3>
      <Segmented
        label="Motion"
        bind:value={settings.motion}
        options={[
          { value: true, label: 'On', sublabel: 'Fades and reveals' },
          { value: false, label: 'Off', sublabel: 'Instant' },
        ]}
      />

      <h3 class="label section">Chrome</h3>
      <Segmented
        label="Chrome"
        bind:value={settings.chrome}
        options={[
          { value: 'auto', label: 'Auto', sublabel: 'Fullscreen hides', title: 'Hides in fullscreen' },
          { value: 'always', label: 'Always', sublabel: 'Never hides' },
          { value: 'hidden', label: 'Hidden', sublabel: 'h shows it' },
        ]}
      />

      <h3 class="label section">Marks</h3>
      <Segmented
        label="Marks"
        bind:value={settings.marks}
        options={[
          { value: true, label: 'Shown', sublabel: 'Drawings and notes' },
          { value: false, label: 'Hidden', sublabel: 'Kept, not shown' },
        ]}
      />
      <div class="buttons">
        <button class="label button" type="button" disabled={!slideHasMarks} onclick={() => clearSlideMarks(slideId)}>
          Clear this slide
        </button>
        <button class="label button" class:confirm={confirming} type="button" disabled={!deckHasMarks}
          aria-label={confirming ? 'Confirm: clear all marks' : 'Clear all'}
          onblur={() => (confirming = false)} onclick={clearAll}>
          {confirming ? 'Confirm' : 'Clear all'}
        </button>
      </div>

      {#if import.meta.env.DEV}
        <h3 class="label section">Follow edits</h3>
        <Segmented
          label="Follow edits"
          bind:value={settings.followEdits}
          options={[
            { value: true, label: 'On', sublabel: 'Jump to edited slide', title: 'Jump to the slide you are editing' },
            { value: false, label: 'Off', sublabel: 'Stay put' },
          ]}
        />
      {/if}

      <h3 class="label section">Keys</h3>
      <div class="keys">
        <button class="label button" type="button" onclick={() => (ui.overlay = 'keys')}>Keyboard shortcuts</button>
        <span class="help-text">or press <kbd>{keysKey}</kbd> at any time</span>
      </div>

      <h3 class="label section">Deck</h3>
      <dl class="rows">
        <div class="row">
          <dt class="label"><label for="settings-deck">Deck</label></dt>
          <dd class="control-text select">
            <select id="settings-deck" value={current.slug} onchange={changeDeck}>
              {#each decks as d (d.slug)}
                <option value={d.slug}>{d.title}</option>
              {/each}
            </select>
            <svg class="chevron" width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
              <path d="M1.5 3l3 3 3-3" />
            </svg>
          </dd>
        </div>
        <div class="row">
          <dt class="label">Slides</dt>
          <dd class="control-text">
            {current.slides.length}{#if skipped > 0}<span class="muted">{` · ${skipped} skipped`}</span>{/if}
          </dd>
        </div>
        <div class="row">
          <dt class="label">Source</dt>
          <dd class="control-text path" title={deckFile(current.slug)}>{deckFile(current.slug)}</dd>
        </div>
      </dl>
      <div class="buttons">
        <button class="label button" type="button" onclick={openPresenter}>Presenter</button>
        <button class="label button" type="button" onclick={openPrint}>Print / PDF / PPTX</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* The page behind is almost fully washed out (§8 reference). */
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 35;
    background: var(--scrim);
    animation: fade-in var(--t-fast) var(--ease);
  }

  /* 432 wide, centred, 40px from the top and bottom of the window, scrolling
     inside; 1px --ink border, --bg, 18px padding (§8 "Chrome"). */
  .sheet {
    position: absolute;
    top: 40px;
    left: 50%;
    width: min(432px, calc(100vw - 32px));
    max-height: calc(100vh - 80px);
    max-height: calc(100dvh - 80px);
    transform: translateX(-50%);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 18px;
    border: 1px solid var(--ink);
    background: var(--bg);
    color: var(--ink);
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
  }

  .sheet:focus {
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2,
  h3 {
    margin: 0;
  }

  .head .label {
    color: var(--ink);
  }

  /* Extends the hit area without moving the text. */
  .close {
    padding: 8px;
    margin: -8px;
  }

  .head .close {
    color: var(--ink-3);
  }

  .head .close:hover {
    color: var(--ink);
  }

  /* Section label: a Label with 28px above and 10px below. */
  .section {
    display: block;
    margin: 28px 0 10px;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  /* The second click of CLEAR ALL: filled, like a pressed button. */
  .button.confirm {
    border-color: var(--fill);
    background: var(--fill);
    color: var(--on-fill);
  }

  .keys {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
  }

  .keys kbd {
    font-family: var(--font-mono);
    font-size: inherit;
    color: var(--ink);
  }

  /* Info rows: a 96px Label column and a Control-text value, bordered. */
  .rows {
    margin: 0;
    border: 1px solid var(--line);
  }

  .row {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    align-items: center;
    min-height: 34px;
    padding: 0 8px;
  }

  .row + .row {
    border-top: 1px solid var(--line);
  }

  dt label {
    cursor: pointer;
  }

  dd {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--ink-3);
    font-weight: 400;
  }

  .path {
    font-weight: 400;
  }

  .select {
    position: relative;
    overflow: visible;
    align-self: stretch;
    display: flex;
    align-items: center;
  }

  select {
    appearance: none;
    width: 100%;
    height: 100%;
    min-height: 32px;
    margin: 0;
    padding: 0 20px 0 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--ink);
    cursor: pointer;
    text-overflow: ellipsis;
  }

  select option {
    background: var(--bg);
    color: var(--ink);
  }

  .chevron {
    position: absolute;
    right: 0;
    top: 50%;
    margin-top: -4.5px;
    fill: none;
    stroke: var(--ink-3);
    stroke-width: 1;
    stroke-linecap: square;
    pointer-events: none;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
</style>
