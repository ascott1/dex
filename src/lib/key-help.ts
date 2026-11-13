// The grouped key list behind the keyboard-shortcuts screen (`?`). Every row
// that names a command takes its keys and its title from the registry, so the
// screen cannot drift from the real bindings; key-help.test.ts fails when a
// command with keys is left out. Pure: no Svelte, no DOM.

import { getCommand } from './commands';
import { keyLabel } from './keys';

/**
 * A row of the list. `id` names a registry command; `keys` (normalized names)
 * and `title` replace the registry's where it reads badly. A row with no `id`
 * is a static entry and must say its `labels` (display text) and `title`.
 */
export interface KeyRowSpec {
  id?: string;
  keys?: string[];
  labels?: string[];
  title?: string;
}

export interface KeyGroupSpec {
  name: string;
  rows: KeyRowSpec[];
}

export const KEY_GROUPS: KeyGroupSpec[] = [
  {
    name: 'Move',
    rows: [
      { id: 'next' },
      { id: 'prev' },
      { id: 'nextSlide' },
      { id: 'prevSlide' },
      { id: 'first' },
      { id: 'last' },
      { id: 'goto', labels: ['1–9', 'Enter'], title: 'Go to that slide' },
    ],
  },
  {
    name: 'View',
    rows: [
      { id: 'overview', title: 'Overview of every slide' },
      { id: 'source', title: 'Markdown of this slide' },
      { id: 'settings', title: 'Settings' },
      { id: 'keys' },
      { id: 'theme', title: 'Switch between Paper and Ink' },
      { id: 'fullscreen' },
      { id: 'chrome', title: 'Hide or show the bars' },
      { id: 'escape', title: 'Close whatever is open' },
    ],
  },
  {
    name: 'Draw and notes',
    rows: [
      { id: 'draw' },
      { id: 'note' },
      { id: 'laser' },
      { id: 'marks', title: 'Show or hide all drawings and notes' },
      { id: 'clear' },
      { id: 'undo', title: 'Undo drawings and notes' },
      { id: 'redo', title: 'Redo drawings and notes' },
      { id: 'penSmaller' },
      { id: 'penLarger' },
      { id: 'noteDelete' },
      { id: 'noteEdit' },
    ],
  },
  {
    name: 'Zoom',
    rows: [
      { id: 'zoom', title: 'Zoom to 200% and back' },
      { id: 'zoomIn' },
      { id: 'zoomOut' },
      { id: 'zoomReset' },
      { labels: ['Pinch', `${keyLabel('Mod')}+wheel`], title: 'Zoom at the pointer' },
      { labels: ['Drag'], title: 'Move around while zoomed' },
    ],
  },
  {
    name: 'Present',
    rows: [
      { id: 'presenter', title: 'Open the presenter window' },
      { id: 'blackout', title: 'Black out the screen; any key brings it back' },
    ],
  },
];

export interface KeyRow {
  /** Display text for each alternative, in order. */
  keys: string[];
  title: string;
}

export interface KeyGroup {
  name: string;
  rows: KeyRow[];
}

export function resolveRow(row: KeyRowSpec): KeyRow {
  const command = row.id === undefined ? undefined : getCommand(row.id);
  if (row.id !== undefined && !command) throw new Error(`dex: key help names unknown command "${row.id}"`);
  return {
    keys: row.labels ?? (row.keys ?? command?.keys ?? []).map(keyLabel),
    title: row.title ?? command?.title ?? '',
  };
}

/** The list the screen renders, resolved against the registry. */
export function keyGroups(): KeyGroup[] {
  return KEY_GROUPS.map((group) => ({ name: group.name, rows: group.rows.map(resolveRow) }));
}
