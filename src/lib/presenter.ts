// Phase 8 commands: open the presenter window (`p`) and blackout (`b`, `.`),
// filled in with `implement()`. Also turns off, on the presenter route, every
// command whose result the presenter window would not show (§9 Phase 8 task 3).
// Imported once, for its side effects, by App.svelte, after the modules that
// fill those commands.

import './overlays';
import './tools.svelte';
import './zoom';
import { deck } from '../state/deck.svelte';
import { ui } from '../state/ui.svelte';
import { getCommand, implement } from './commands';
import { parseHash } from './router';

export const PRESENTER_WINDOW = 'dex-presenter';

/** This window shows `#/<slug>/presenter`. */
export function isPresenterRoute(): boolean {
  return parseHash(location.hash).view === 'presenter';
}

/**
 * Open the presenter window for the open deck. Must run synchronously inside
 * the key or click handler, or the browser blocks the pop-up.
 */
export function openPresenter(): void {
  const slug = deck.current?.slug;
  if (!slug) return;
  const url = `${location.pathname}${location.search}#/${slug}/presenter`;
  window.open(url, PRESENTER_WINDOW, 'width=1280,height=800');
}

const hasDeck = () => deck.current !== null;
const hasSlides = () => (deck.current?.slides.length ?? 0) > 0;

implement('presenter', openPresenter, () => hasDeck() && !isPresenterRoute());
// Only turns blackout on: while it is on, the next key clears it before any
// command is looked up (keys.ts).
implement('blackout', () => {
  ui.blackout = true;
}, hasSlides);

// Nothing on the presenter route shows these: the overlays, zoom, the marks
// tools (the presenter is view-and-drive only), and hiding the chrome.
const NOT_ON_PRESENTER = [
  'settings', 'overview', 'source',
  'zoom', 'zoomIn', 'zoomOut', 'zoomReset',
  'draw', 'note', 'laser', 'marks', 'clear', 'undo', 'redo', 'penSmaller', 'penLarger', 'noteDelete', 'noteEdit',
  'chrome',
];

for (const id of NOT_ON_PRESENTER) {
  const command = getCommand(id);
  if (!command) throw new Error(`dex: unknown command "${id}"`);
  const when = command.when;
  command.when = (event) => !isPresenterRoute() && (when ? when(event) : true);
}
