// `Esc` closes the topmost thing (§7): the go-to digits, the warnings list,
// settings, overview, source, note editing, tool, zoom, blackout — in that order.
//
// Each thing is a layer with a rank; `escape()` asks the layers in rank order
// and stops at the first one that closes something. A later phase joins the
// chain, or replaces a default layer, with `onEscape(id, rank, close)` from its
// own module; nothing here needs rewriting.

import { resetCamera, ui } from '../state/ui.svelte';

export const ESCAPE_RANK = {
  goto: 0,        // Phase 5: digits typed for go-to-slide
  warnings: 5,    // Phase 3: compile-warning list
  settings: 10,   // Phase 5
  overview: 20,   // Phase 5
  source: 30,     // Phase 5
  editing: 40,    // Phase 6: sticky note being edited
  tool: 50,       // Phase 6: draw, note, laser
  zoom: 60,       // Phase 7
  blackout: 70,   // Phase 8
} as const;

interface Layer {
  id: string;
  rank: number;
  /** Close the layer if it is open. Returns true when it closed something. */
  close(): boolean;
}

const layers: Layer[] = [];

/** Add a layer to the chain, or replace the layer with the same id. */
export function onEscape(id: string, rank: number, close: () => boolean): void {
  const i = layers.findIndex((l) => l.id === id);
  if (i >= 0) layers.splice(i, 1);
  layers.push({ id, rank, close });
  layers.sort((a, b) => a.rank - b.rank);
}

/** Close the topmost open thing. Returns false when nothing was open. */
export function escape(): boolean {
  for (const layer of layers) if (layer.close()) return true;
  return false;
}

// Defaults, from the transient UI state every phase shares. A phase that needs
// more than clearing its state (saving a note, ending a stroke) replaces its
// layer by id.
const overlay = (name: 'settings' | 'overview' | 'source') => () => {
  if (ui.overlay !== name) return false;
  ui.overlay = null;
  return true;
};

onEscape('warnings', ESCAPE_RANK.warnings, () => {
  if (!ui.warnings) return false;
  ui.warnings = false;
  return true;
});
onEscape('settings', ESCAPE_RANK.settings, overlay('settings'));
onEscape('overview', ESCAPE_RANK.overview, overlay('overview'));
onEscape('source', ESCAPE_RANK.source, overlay('source'));
onEscape('editing', ESCAPE_RANK.editing, () => {
  if (!ui.editing) return false;
  ui.editing = null;
  return true;
});
onEscape('tool', ESCAPE_RANK.tool, () => {
  if (!ui.tool) return false;
  ui.tool = null;
  return true;
});
onEscape('zoom', ESCAPE_RANK.zoom, () => {
  if (ui.camera.k === 1 && ui.camera.x === 0 && ui.camera.y === 0) return false;
  resetCamera();
  return true;
});
onEscape('blackout', ESCAPE_RANK.blackout, () => {
  if (!ui.blackout) return false;
  ui.blackout = false;
  return true;
});
