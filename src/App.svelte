<script lang="ts">
  // The §7 DOM skeleton, the hash router, and the window-level listeners.
  import { untrack } from 'svelte';
  import { handleKeydown } from './lib/keys';
  import './lib/overlays';
  import './lib/tools.svelte';
  import './lib/presenter';
  import { session, startSync, stopSync } from './lib/session.svelte';
  import { formatRoute, onHashChange, parseHash, replaceHash, type Route } from './lib/router';
  import { deck, loadDeck, loadIndex } from './state/deck.svelte';
  import { goto, nav } from './state/nav.svelte';
  import { marks } from './state/marks.svelte';
  import { baseTheme, settings, slideTheme } from './state/settings.svelte';
  import { ui } from './state/ui.svelte';
  import Blackout from './components/Blackout.svelte';
  import BottomBar from './components/BottomBar.svelte';
  import DeckIndex from './components/DeckIndex.svelte';
  import ErrorOverlay from './components/ErrorOverlay.svelte';
  import KeysView from './components/KeysView.svelte';
  import Overview from './components/Overview.svelte';
  import PresenterView from './components/PresenterView.svelte';
  import PrintView from './components/PrintView.svelte';
  import SettingsSheet from './components/SettingsSheet.svelte';
  import SourceView from './components/SourceView.svelte';
  import Stage from './components/Stage.svelte';
  import TopBar from './components/TopBar.svelte';

  const IDLE_MS = 2500;

  let route: Route = $state.raw(parseHash(location.hash));

  $effect(() => onHashChange((r) => (route = r)));

  // Open what the route asks for.
  $effect(() => {
    const r = route;
    untrack(() => void applyRoute(r));
  });

  async function applyRoute(r: Route) {
    if (r.view === 'index') {
      stopSync();
      await loadIndex();
      // Exactly one deck: go straight to it, without a history entry.
      if (route === r && deck.list.length === 1) {
        const next: Route = { view: 'deck', slug: deck.list[0]!.slug, n: null };
        replaceHash(formatRoute(next));
        route = next;
      }
      return;
    }
    if (deck.current?.slug === r.slug) {
      if (r.view === 'deck' && r.n !== null && r.n - 1 !== nav.index) goto(r.n - 1);
      syncRoute(r);
      return;
    }
    stopSync();
    const ok = await loadDeck(r.slug);
    if (ok && route === r) {
      goto(r.view === 'deck' && r.n !== null ? r.n - 1 : 0);
      syncRoute(r);
    }
  }

  // The deck and presenter windows stay in step (Phase 8). Started only once
  // the route's slide is showing, so that slide is this window's own state
  // when it asks the others for theirs.
  function syncRoute(r: Route) {
    if (r.view === 'deck' || r.view === 'presenter') startSync(r.slug);
    else stopSync();
  }

  // The hash follows the current slide, without history entries (§7).
  $effect(() => {
    if (route.view !== 'deck' || !deck.current || deck.current.slug !== route.slug) return;
    const n = deck.current.slides.length === 0 ? null : nav.index + 1;
    replaceHash(formatRoute({ view: 'deck', slug: route.slug, n }));
  });

  // Effective theme on <html>: the bars and the letterbox follow the slide (§7).
  // The presenter and print views keep the deck theme: their slides carry their own.
  const theme = $derived(
    route.view === 'presenter' || route.view === 'print'
      ? baseTheme()
      : slideTheme(deck.current?.slides[nav.index]),
  );
  // The chrome sits on a picture: its labels step up one level (§9 Phase 4, task 6).
  const overImage = $derived(deck.current?.slides[nav.index]?.attrs['data-bg'] === 'image');
  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });

  $effect(() => {
    // A deck called "dex" (the demo) is not "dex · dex".
    const title = deck.current && deck.current.meta.title !== 'dex' ? `${deck.current.meta.title} · dex` : 'dex';
    // In print the title is the PDF's default file name: the deck's own title.
    document.title =
      route.view === 'presenter' ? `Presenter · ${title}`
        : route.view === 'print' && deck.current ? deck.current.meta.title
        : title;
  });

  $effect(() => {
    if (deck.current) document.documentElement.lang = deck.current.meta.lang;
  });

  const chrome = $derived(
    settings.chrome === 'hidden' ? 'hidden'
      : settings.chrome === 'always' ? 'shown'
      : ui.fullscreen && ui.idle ? 'hidden' : 'shown',
  );

  // Docked bars take their own space, and the stage fits between them, so a
  // full-bleed picture ends at the hairlines. In fullscreen under `auto`, and
  // when hidden, the bars are an overlay and the stage has the whole window, so
  // showing and hiding them never resizes the slide.
  const docked = $derived(settings.chrome === 'always' || (settings.chrome === 'auto' && !ui.fullscreen));

  // Chrome auto-hide: idle after 2.5s without pointer movement.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  function wake() {
    ui.idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (ui.idle = true), IDLE_MS);
  }

  $effect(() => {
    const onFullscreen = () => {
      ui.fullscreen = document.fullscreenElement !== null;
      wake();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    wake();
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearTimeout(idleTimer);
    };
  });

  // Dev-only handle for the end-to-end tests and for poking at state in the console.
  if (import.meta.env.DEV) {
    Object.assign(window, { __dex: { deck, nav, settings, ui, marks, session } });
  }
</script>

<svelte:window onkeydown={handleKeydown} onpointermove={wake} onpointerdown={wake} />

<div
  class="app"
  data-text={settings.textScale}
  data-motion={settings.motion ? 'on' : 'off'}
  data-chrome={chrome}
  data-dock={docked ? '' : undefined}
  data-tool={ui.tool ?? undefined}
  data-view={route.view}
  data-over-image={overImage ? '' : undefined}
  data-dev={import.meta.env.DEV ? '' : undefined}
>
  {#if route.view === 'index'}
    <DeckIndex />
  {:else if route.view === 'presenter'}
    <PresenterView />
  {:else if route.view === 'print'}
    <PrintView />
  {:else if !deck.current && deck.error}
    <div class="failed">
      <p class="label">Cannot open deck</p>
      <p class="help-text">{deck.error}</p>
      <a class="label label-btn" href="#/">All decks</a>
    </div>
  {:else}
    <TopBar />
    <Stage />
    <BottomBar />
    <Overview />
    <SettingsSheet />
    <SourceView />
    <KeysView />
    <Blackout />
    <ErrorOverlay />
  {/if}
</div>

<style>
  .failed {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    text-align: center;
  }

  .failed p {
    margin: 0;
  }

  .failed a {
    margin-top: 16px;
    text-decoration: none;
  }
</style>
