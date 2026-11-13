// Keeping the windows of one deck in step (§9 Phase 8, task 1): the audience
// window, the presenter window, and any other window on the same deck.
//
// Synced: the slide and build step (`nav`), the deck theme (`theme`), blackout,
// and marks. Not synced: the camera (zoom), tools, overlays, the laser,
// settings, the timer.
//
// Echo. Local changes are seen by effects that compare the state with the last
// value this window knows for it, whether it made that value or received it.
// Applying a message records the value first, so the effect that then runs
// finds nothing new and sends nothing. Marks from another window go through
// `applyRemoteMarks`, which `onMarksChange` does not report.
//
// Ordering. `nav`, `theme` and `blackout` carry a stamp (lib/stamp.ts). A
// window applies a message only when its stamp is newer than the stamp of the
// value it holds, so two windows changing a value at the same moment both end
// on the same one instead of swapping.
//
// Joining. `startSync` runs once the deck is open and the route's slide is
// shown. The window sends `hello` once its marks are loaded; every other window
// answers with its nav, theme, blackout and marks. Its own values carry the
// initial stamp, which loses to any change and, between untouched values, to
// the older window, so a window opened mid-talk lands on the talk's slide.

import type { SlideMarks, SyncMessage, SyncStamp } from '$shared/types';
import { deck } from '../state/deck.svelte';
import { applyRemoteMarks, marks, onMarksChange } from '../state/marks.svelte';
import { nav, show } from '../state/nav.svelte';
import { baseTheme, deckTheme, setDeckTheme } from '../state/settings.svelte';
import { broadcast, closeSync, openSync } from '../state/sync';
import { ui } from '../state/ui.svelte';
import { createClock, newer } from './stamp';

/** Read by the presenter (timer) and the tests. */
export const session = $state({
  /** The deck this window is syncing, or null. */
  slug: null as string | null,
  /** `hello` has been sent. */
  joined: false,
});

const clock = createClock(
  typeof performance !== 'undefined' ? performance.timeOrigin : 0,
  Math.random().toString(36).slice(2, 10),
);

interface Register<T> {
  value: T;
  stamp: SyncStamp;
}

const navValue = () => ({ index: nav.index, step: nav.step });
const sameNav = (a: { index: number; step: number }, b: { index: number; step: number }) =>
  a.index === b.index && a.step === b.step;

let navReg: Register<{ index: number; step: number }> = { value: { index: 0, step: 0 }, stamp: clock.initial() };
let themeReg: Register<string> = { value: '', stamp: clock.initial() };
let blackoutReg: Register<boolean> = { value: false, stamp: clock.initial() };

// Marks are throttled: one message per slide per animation frame.
const pendingMarks = new Map<string, SlideMarks>();
let frame = 0;
let fallback: ReturnType<typeof setTimeout> | undefined;
// Marks that arrived before this window's own marks finished loading.
const earlyMarks = new Map<string, SlideMarks>();

/** Start syncing the open deck. Call once its route's slide is showing. */
export function startSync(slug: string): void {
  if (session.slug === slug) return;
  stopSync();
  navReg = { value: navValue(), stamp: clock.initial() };
  themeReg = { value: deckTheme.override ?? '', stamp: clock.initial() };
  blackoutReg = { value: ui.blackout, stamp: clock.initial() };
  openSync(slug, receive);
  session.slug = slug;
}

export function stopSync(): void {
  if (!session.slug) return;
  flushMarks();
  closeSync();
  session.slug = null;
  session.joined = false;
  earlyMarks.clear();
}

const active = () => session.slug !== null && deck.current?.slug === session.slug;

function receive(message: SyncMessage): void {
  if (!active()) return;
  switch (message.type) {
    case 'hello':
      reply();
      return;
    case 'nav': {
      clock.see(message.stamp);
      if (!newer(message.stamp, navReg.stamp)) return;
      show(message.index, message.step);
      navReg = { value: navValue(), stamp: message.stamp };
      return;
    }
    case 'theme': {
      clock.see(message.stamp);
      if (!newer(message.stamp, themeReg.stamp)) return;
      if (baseTheme() !== message.theme) setDeckTheme(message.theme);
      themeReg = { value: deckTheme.override ?? '', stamp: message.stamp };
      return;
    }
    case 'blackout': {
      clock.see(message.stamp);
      if (!newer(message.stamp, blackoutReg.stamp)) return;
      ui.blackout = message.on;
      blackoutReg = { value: message.on, stamp: message.stamp };
      return;
    }
    case 'marks': {
      if (marks.slug !== session.slug || !marks.loaded) earlyMarks.set(message.slideId, message.marks);
      else applyRemoteMarks(message.slideId, message.marks);
      return;
    }
  }
}

/** Answer `hello` with everything a new window needs. */
function reply(): void {
  flushMarks();
  broadcast({ type: 'nav', ...navReg.value, stamp: navReg.stamp });
  broadcast({ type: 'theme', theme: baseTheme(), stamp: themeReg.stamp });
  broadcast({ type: 'blackout', on: blackoutReg.value, stamp: blackoutReg.stamp });
  if (marks.slug === session.slug && marks.loaded) {
    for (const [slideId, m] of Object.entries($state.snapshot(marks.data.slides))) {
      broadcast({ type: 'marks', slideId, marks: m as SlideMarks });
    }
  }
}

function flushMarks(): void {
  cancelAnimationFrame(frame);
  clearTimeout(fallback);
  frame = 0;
  fallback = undefined;
  if (session.slug) {
    for (const [slideId, m] of pendingMarks) broadcast({ type: 'marks', slideId, marks: m });
  }
  pendingMarks.clear();
}

onMarksChange((slideId, snapshot) => {
  if (!session.slug || marks.slug !== session.slug) return;
  pendingMarks.set(slideId, snapshot);
  if (frame || fallback) return;
  frame = requestAnimationFrame(flushMarks);
  // A hidden window gets no animation frames.
  fallback = setTimeout(flushMarks, 100);
});

$effect.root(() => {
  // Local navigation.
  $effect(() => {
    const value = navValue();
    if (!session.slug || !active()) return;
    if (sameNav(value, navReg.value)) return;
    const stamp = clock.tick();
    navReg = { value, stamp };
    broadcast({ type: 'nav', ...value, stamp });
  });

  // A local theme toggle (the per-deck override; a frontmatter change reaches
  // every window through live reload instead).
  $effect(() => {
    const value = deckTheme.override ?? '';
    if (!session.slug || !active()) return;
    if (value === themeReg.value) return;
    const stamp = clock.tick();
    themeReg = { value, stamp };
    broadcast({ type: 'theme', theme: baseTheme(), stamp });
  });

  // Local blackout.
  $effect(() => {
    const value = ui.blackout;
    if (!session.slug || !active()) return;
    if (value === blackoutReg.value) return;
    const stamp = clock.tick();
    blackoutReg = { value, stamp };
    broadcast({ type: 'blackout', on: value, stamp });
  });

  // Join once this window's marks are in, so the marks in the replies are
  // applied on top of what was loaded instead of being replaced by it.
  $effect(() => {
    if (!session.slug || session.joined || !active()) return;
    if (marks.slug !== session.slug || !marks.loaded) return;
    for (const [slideId, m] of earlyMarks) applyRemoteMarks(slideId, m);
    earlyMarks.clear();
    session.joined = true;
    broadcast({ type: 'hello' });
  });
});
