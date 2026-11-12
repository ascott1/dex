// Transient UI state (§7). Never persisted.

export type Overlay = null | 'settings' | 'overview' | 'source';
export type Tool = null | 'draw' | 'note' | 'laser';

export const ui = $state({
  overlay: null as Overlay,
  tool: null as Tool,
  blackout: false,                                   // Phase 8
  camera: { k: 1, x: 0, y: 0 },                      // Phase 7; stage px, see lib/stage.ts
  pointer: { x: 0, y: 0, inside: false },            // last pointer position in stage coordinates
  fullscreen: false,
  idle: false,                                       // no pointer movement for 2.5s
  // Additions beyond the §7 list, each owned by the phase named:
  warnings: false,                                   // Phase 3: compile-warning list open
  editing: null as string | null,                    // Phase 6: id of the sticky note being edited
  goto: '',                                          // Phase 5: digits typed for go-to-slide
});

export function resetCamera(): void {
  ui.camera.k = 1;
  ui.camera.x = 0;
  ui.camera.y = 0;
}
