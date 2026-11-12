// The command registry (§7 "Commands and keys"). keys.ts maps keydown to these,
// the chrome buttons run them by id, and Phase 5 generates the key list in the
// settings sheet from them.
//
// Commands owned by later phases are registered here with an empty `run`.
// A later phase can either edit its entry below or call `implement(id, run, when)`
// from its own module.

import * as navigation from '../state/nav.svelte';
import { baseTheme, setDeckTheme, settings } from '../state/settings.svelte';
import { resetCamera, ui } from '../state/ui.svelte';

export interface Command {
  id: string;
  title: string;
  /** Normalized key names, see keys.ts `normalizeKey`. */
  keys: string[];
  /** The phase that implements it (for the key list and for later phases). */
  phase: number;
  /** Fire again while the key is held down. Navigation only. */
  repeat?: boolean;
  run(event?: KeyboardEvent): void;
  /** When present and false, the key falls through to the next matching command. */
  when?(event?: KeyboardEvent): boolean;
}

const noop = () => {};

export function toggleFullscreen(): void {
  // Must run synchronously inside the key or click handler (user activation).
  if (document.fullscreenElement) void document.exitFullscreen().catch(noop);
  else void document.documentElement.requestFullscreen?.().catch(noop);
}

export function toggleTheme(): void {
  setDeckTheme(baseTheme() === 'paper' ? 'ink' : 'paper');
}

let chromeBeforeHide: 'auto' | 'always' = 'auto';
export function toggleChrome(): void {
  if (settings.chrome === 'hidden') {
    settings.chrome = chromeBeforeHide;
  } else {
    chromeBeforeHide = settings.chrome;
    settings.chrome = 'hidden';
  }
}

/** Close the topmost thing (§7): settings, overview, source, note editing, tool, zoom, blackout. */
export function escape(): void {
  if (ui.warnings) ui.warnings = false;
  else if (ui.overlay) ui.overlay = null;
  else if (ui.editing) ui.editing = null;
  else if (ui.tool) ui.tool = null;
  else if (ui.camera.k !== 1 || ui.camera.x !== 0 || ui.camera.y !== 0) resetCamera();
  else if (ui.blackout) ui.blackout = false;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

// Order matters: the first command whose keys match and whose `when` passes runs.
export const commands: Command[] = [
  // Phase 3
  { id: 'next', title: 'Next step or slide', keys: ['ArrowRight', 'Space', 'PageDown'], phase: 3, repeat: true, run: navigation.next },
  { id: 'prev', title: 'Previous step or slide', keys: ['ArrowLeft', 'Shift+Space', 'PageUp'], phase: 3, repeat: true, run: navigation.prev },
  { id: 'nextSlide', title: 'Next slide, skipping builds', keys: ['ArrowDown'], phase: 3, repeat: true, run: navigation.nextSlide },
  { id: 'prevSlide', title: 'Previous slide, skipping builds', keys: ['ArrowUp'], phase: 3, repeat: true, run: navigation.prevSlide },
  { id: 'first', title: 'First slide', keys: ['Home'], phase: 3, run: navigation.first },
  { id: 'last', title: 'Last slide', keys: ['End'], phase: 3, run: navigation.last },
  { id: 'fullscreen', title: 'Fullscreen', keys: ['f'], phase: 3, run: toggleFullscreen },
  { id: 'theme', title: 'Toggle Paper / Ink', keys: ['t'], phase: 3, run: toggleTheme },
  { id: 'chrome', title: 'Hide or show the chrome', keys: ['h'], phase: 3, run: toggleChrome },
  { id: 'escape', title: 'Close', keys: ['Escape'], phase: 3, run: escape },

  // Phase 5. `goto` is listed before the zoom commands so that, once its
  // `when` is written, a `0` typed after other digits goes to it, not to zoom reset.
  { id: 'goto', title: 'Go to slide number', keys: [...DIGITS, 'Enter'], phase: 5, run: noop, when: () => false },
  { id: 'overview', title: 'Overview grid', keys: ['g'], phase: 5, run: noop },
  { id: 'settings', title: 'Settings', keys: ['s', ','], phase: 5, run: noop },
  { id: 'source', title: 'Markdown source of this slide', keys: ['m'], phase: 5, run: noop },

  // Phase 6
  { id: 'draw', title: 'Draw', keys: ['d'], phase: 6, run: noop },
  { id: 'note', title: 'New sticky note', keys: ['n'], phase: 6, run: noop },
  { id: 'laser', title: 'Laser pointer', keys: ['l'], phase: 6, run: noop },
  { id: 'marks', title: 'Show or hide all marks', keys: ['a'], phase: 6, run: noop },
  { id: 'clear', title: "Clear this slide's drawings", keys: ['c'], phase: 6, run: noop },
  { id: 'undo', title: 'Undo marks', keys: ['Mod+z'], phase: 6, run: noop },
  { id: 'redo', title: 'Redo marks', keys: ['Shift+Mod+z'], phase: 6, run: noop },

  // Phase 7
  { id: 'zoom', title: 'Zoom toggle', keys: ['z'], phase: 7, run: noop },
  { id: 'zoomIn', title: 'Zoom in', keys: ['+', '='], phase: 7, repeat: true, run: noop },
  { id: 'zoomOut', title: 'Zoom out', keys: ['-'], phase: 7, repeat: true, run: noop },
  { id: 'zoomReset', title: 'Reset zoom', keys: ['0'], phase: 7, run: noop },

  // Phase 8
  { id: 'presenter', title: 'Open presenter window', keys: ['p'], phase: 8, run: noop },
  { id: 'blackout', title: 'Blackout', keys: ['b', '.'], phase: 8, run: noop },
];

export function getCommand(id: string): Command | undefined {
  return commands.find((c) => c.id === id);
}

/** Run a command by id (chrome buttons). Ignores `when`. */
export function runCommand(id: string): void {
  getCommand(id)?.run();
}

/** Replace a stub's behaviour from the module of the phase that owns it. */
export function implement(id: string, run: Command['run'], when?: Command['when']): void {
  const command = getCommand(id);
  if (!command) throw new Error(`dex: unknown command "${id}"`);
  command.run = run;
  command.when = when;
}
