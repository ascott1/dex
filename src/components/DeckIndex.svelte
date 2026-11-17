<script lang="ts">
  // The deck list at #/ (§9 Phase 3, task 1): bordered rows of title, slide count, modified date.
  import { deckFile } from '../lib/paths';
  import { deck } from '../state/deck.svelte';

  const date = (iso: string) => (iso ? iso.slice(0, 10) : '');
</script>

<div class="index">
  <header class="head">
    <span class="square" aria-hidden="true"></span>
    <span class="label">dex · decks</span>
  </header>

  {#if deck.listLoaded && deck.list.length === 0}
    <p class="label empty">No decks yet</p>
    <p class="help-text">Run <code>pnpm new &lt;slug&gt;</code> to create {deckFile('<slug>')}</p>
  {:else}
    <ul class="rows">
      {#each deck.list as item (item.slug)}
        <li>
          <a class="row" href="#/{item.slug}">
            <span class="control-text title">{item.title}</span>
            <span class="label">{item.slides} {item.slides === 1 ? 'slide' : 'slides'}</span>
            <span class="label">{date(item.modified)}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .index {
    width: min(640px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 96px 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 28px;
  }

  .square {
    width: 10px;
    height: 10px;
    background: var(--ink);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Shared 1px borders between rows; the hovered row's border sits on top. */
  .rows li + li .row {
    margin-top: -1px;
  }

  .row:hover {
    position: relative;
    z-index: 1;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr auto 96px;
    align-items: center;
    gap: 16px;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--line);
    color: var(--ink);
    text-decoration: none;
    transition: border-color var(--t-fast) var(--ease);
  }

  .row:hover {
    border-color: var(--ink);
  }

  .row .label:last-child {
    text-align: right;
  }

  .title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .empty {
    margin: 0 0 10px;
  }

  code {
    font-family: var(--font-mono);
  }
</style>
