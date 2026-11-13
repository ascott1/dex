// The deck list and the open deck, fetched from the dev server or the static
// build (§7 "Server contract"), plus live reload from the dev-only events.

import type { Deck, DeckSummary, DexErrorEvent, DexIndexEvent, DexUpdateEvent } from '$shared/types';
import { nav, show } from './nav.svelte';
import { loadDeckTheme, settings } from './settings.svelte';

export const deck = $state({
  list: [] as DeckSummary[],
  listLoaded: false,
  current: null as Deck | null,
  /** The slug the route asked for; `current` may lag behind it or be missing. */
  slug: null as string | null,
  /** Last load or compile error; shown by ErrorOverlay (or centered when no deck is open). */
  error: null as string | null,
  errorLine: null as number | null,
});

type FetchResult =
  | { ok: true; deck: Deck }
  | { ok: false; status: number; error: string; line: number | null };

async function fetchDeck(slug: string): Promise<FetchResult> {
  try {
    const res = await fetch(`decks/${slug}/deck.json`, { cache: 'no-store' });
    // A static host with an SPA fallback answers a missing deck with the page itself.
    if ((res.headers.get('content-type') ?? '').includes('text/html')) {
      return { ok: false, status: 404, error: `no deck "${slug}"`, line: null };
    }
    if (res.ok) return { ok: true, deck: (await res.json()) as Deck };
    const body = (await res.json().catch(() => ({}))) as { error?: string; line?: number | null };
    const error = body.error ?? (res.status === 404 ? `no deck "${slug}"` : `HTTP ${res.status}`);
    return { ok: false, status: res.status, error, line: body.line ?? null };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err), line: null };
  }
}

function setError(error: string | null, line: number | null = null): void {
  deck.error = error;
  deck.errorLine = line;
}

function logWarnings(d: Deck): void {
  if (!import.meta.env.DEV) return;
  for (const w of d.warnings) {
    const where = w.slide >= 0 ? `slide ${w.slide + 1}, line ${w.line}` : `frontmatter, line ${w.line}`;
    console.warn(`dex: ${d.slug} ${where}: ${w.message}`);
  }
}

export async function loadIndex(): Promise<void> {
  try {
    const res = await fetch('decks/index.json', { cache: 'no-store' });
    if (res.ok) deck.list = (await res.json()) as DeckSummary[];
  } catch {
    // Keep the last list.
  }
  deck.listLoaded = true;
}

// Every load bumps this; a response that arrives after a newer request started is dropped.
let generation = 0;

// The open in flight, if any. A reload waits for it (see `reload`).
let opening: Promise<boolean> | null = null;

/** Open a deck. Resolves to true when it loaded. */
export function loadDeck(slug: string): Promise<boolean> {
  const p = openDeck(slug);
  opening = p;
  void p.finally(() => {
    if (opening === p) opening = null;
  });
  return p;
}

async function openDeck(slug: string): Promise<boolean> {
  const gen = ++generation;
  deck.slug = slug;
  if (deck.current && deck.current.slug !== slug) deck.current = null;
  loadDeckTheme(slug);
  const result = await fetchDeck(slug);
  if (gen !== generation) return false;
  if (!result.ok) {
    setError(result.error, result.line);
    return false;
  }
  deck.current = result.deck;
  setError(null);
  logWarnings(result.deck);
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Refetch the open deck after an edit. Keeps the current slide by `id`, or
 * clamps the index; with `followEdits`, jumps to the first slide whose hash
 * changed. Keeps the showing deck when the fetch fails.
 */
export async function reload(): Promise<void> {
  // An update can arrive while the deck is still opening. Superseding the open
  // would drop it before the route's slide number is applied, leaving the page
  // on slide 1. Let the open finish, then refetch.
  if (opening) await opening.catch(() => false);
  const slug = deck.slug;
  if (!slug) return;
  const gen = ++generation;
  let result = await fetchDeck(slug);
  // An editor that saves by rename can make deck.md briefly vanish (§7).
  if (!result.ok && result.status === 404) {
    await sleep(200);
    if (gen !== generation) return;
    result = await fetchDeck(slug);
  }
  if (gen !== generation) return;
  if (!result.ok) {
    setError(result.error, result.line);
    return;
  }

  const old = deck.current;
  const fresh = result.deck;
  const oldId = old?.slides[nav.index]?.id;
  const oldStep = nav.step;
  const oldHashes = new Map(old?.slides.map((s) => [s.id, s.hash]) ?? []);

  deck.current = fresh;
  setError(null);
  logWarnings(fresh);

  if (import.meta.env.DEV && settings.followEdits && old) {
    const changed = fresh.slides.findIndex((s) => oldHashes.get(s.id) !== s.hash);
    if (changed >= 0) {
      // Show the edited slide fully revealed, so the edit is visible.
      show(changed, fresh.slides[changed]!.steps);
      return;
    }
  }
  const same = oldId === undefined ? -1 : fresh.slides.findIndex((s) => s.id === oldId);
  if (same >= 0) show(same, oldStep);
  else show(nav.index, 0);
}

/** Subscribe to the dev server's deck events (§7). No-op in a static build. */
export function startLiveReload(): void {
  const hot = import.meta.hot;
  if (!hot) return;
  hot.on('dex:update', (event: DexUpdateEvent) => {
    void loadIndex();
    if (event.slug === deck.slug) void reload();
  });
  hot.on('dex:index', (_event: DexIndexEvent) => {
    void loadIndex();
  });
  hot.on('dex:error', (event: DexErrorEvent) => {
    if (event.slug === deck.slug) setError(event.error, event.line);
  });
}

export function dismissError(): void {
  setError(null);
}
