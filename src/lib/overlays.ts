// Phase 5 commands: the settings sheet, the overview grid, the source view, and
// go-to-slide by number (§7 "Commands and keys", §9 Phase 5). Filled in with
// `implement()`; the registry in commands.ts is not edited. Imported once, for
// its side effects, by App.svelte.

import { deck } from '../state/deck.svelte';
import { goto as gotoSlide } from '../state/nav.svelte';
import { ui, type Overlay } from '../state/ui.svelte';
import { implement } from './commands';
import { ESCAPE_RANK, onEscape } from './escape';
import { normalizeKey } from './keys';

/** Open an overlay, or close it when it is the one showing. */
export function toggleOverlay(name: Exclude<Overlay, null>): void {
  ui.overlay = ui.overlay === name ? null : name;
}

const hasDeck = () => deck.current !== null;

implement('settings', () => toggleOverlay('settings'), hasDeck);
implement('overview', () => toggleOverlay('overview'), hasDeck);
implement('source', () => toggleOverlay('source'), hasDeck);
implement('keys', () => toggleOverlay('keys'), hasDeck);

// ── Go to slide ──────────────────────────────────────────────────────────────
// Digits collect in `ui.goto` (shown in the bottom bar as `GO TO 12`); `Enter`
// jumps; `Esc` or 1.5s without a digit cancels.

export const GOTO_TIMEOUT_MS = 1500;
const MAX_DIGITS = 4;
let timer: ReturnType<typeof setTimeout> | undefined;

export function cancelGoto(): void {
  clearTimeout(timer);
  ui.goto = '';
}

/**
 * The cases that belong to go-to. `0` with nothing typed is not a go-to digit
 * (it is zoom reset, Phase 7), and `Enter` is claimed only while digits are
 * typed, so it falls through to whatever else wants it.
 */
function gotoWhen(event?: KeyboardEvent): boolean {
  if (!event || !deck.current || deck.current.slides.length === 0) return false;
  const key = normalizeKey(event);
  if (key === 'Enter') return ui.goto !== '';
  if (key === '0') return ui.goto !== '';
  return /^[1-9]$/.test(key);
}

function gotoRun(event?: KeyboardEvent): void {
  if (!event) return;
  const key = normalizeKey(event);
  if (key === 'Enter') {
    const n = Number(ui.goto);
    cancelGoto();
    // Out of range lands on the last slide; skipped slides can be reached.
    gotoSlide(n - 1);
    if (ui.overlay === 'overview') ui.overlay = null;
    return;
  }
  // A number longer than any slide number starts over.
  ui.goto = ui.goto.length >= MAX_DIGITS ? key : ui.goto + key;
  clearTimeout(timer);
  timer = setTimeout(cancelGoto, GOTO_TIMEOUT_MS);
}

implement('goto', gotoRun, gotoWhen);

onEscape('goto', ESCAPE_RANK.goto, () => {
  if (ui.goto === '') return false;
  cancelGoto();
  return true;
});
