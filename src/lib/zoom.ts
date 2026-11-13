// Phase 7: zoom and pan (§9 Phase 7). Fills the `zoom`, `zoomIn`, `zoomOut` and
// `zoomReset` commands with `implement()`, replaces the `zoom` Esc layer so a
// reset from the keyboard eases, and exports `attachZoom(viewport)`, which
// Stage.svelte calls for the wheel, pinch and drag-to-pan input.
//
// Coordinates: the camera works in the stage frame (logical stage pixels before
// the camera, see lib/camera.ts). Pointer positions are converted with
// clientToFrame, which does not read the camera, so an anchor is right even
// while a key-triggered zoom is still easing.

import { deck } from '../state/deck.svelte';
import { resetCamera, ui } from '../state/ui.svelte';
import { type Camera, ZOOM_STEP, ZOOM_TOGGLE, clampCamera, frameToSlide, panBy, wheelPixels, wheelZoomFactor, zoomAt } from './camera';
import { implement } from './commands';
import { ESCAPE_RANK, onEscape } from './escape';
import { clientToFrame, stageSize } from './stage';

/** How far (CSS px) a press must move before it becomes a pan rather than a click. */
const PAN_SLOP = 3;

const size = () => stageSize(deck.current?.meta.aspect);
const zoomed = () => ui.camera.k > 1;

/** Zoom keys work on a deck with slides while no overlay covers the stage. */
const canZoom = () => (deck.current?.slides.length ?? 0) > 0 && ui.overlay === null;

/** Last pointer position in client px, or null when the pointer is not over the stage area. */
let pointer: { clientX: number; clientY: number } | null = null;

function setCamera(next: Camera, animate: boolean): void {
  const { W, H } = size();
  const c = clampCamera(next, W, H);
  ui.cameraAnimate = animate;
  ui.camera.k = c.k;
  ui.camera.x = c.x;
  ui.camera.y = c.y;
  syncPointer();
}

/**
 * The camera moved under a pointer that did not: keep `ui.pointer` (slide
 * coordinates, used by `n`) pointing at what is under the pointer now.
 */
function syncPointer(): void {
  if (!pointer) return;
  const f = clientToFrame(pointer);
  if (!f) return;
  const { W, H } = size();
  const p = frameToSlide(ui.camera, f.x, f.y);
  ui.pointer.x = p.x;
  ui.pointer.y = p.y;
  ui.pointer.inside = p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
}

/** Where a key zoom anchors: the pointer if it is over the stage area, else the stage centre. */
function keyAnchor(): { x: number; y: number } {
  const f = pointer ? clientToFrame(pointer) : null;
  if (f) return f;
  const { W, H } = size();
  return { x: W / 2, y: H / 2 };
}

function zoomKeyTo(k: number): void {
  const a = keyAnchor();
  const { W, H } = size();
  setCamera(zoomAt(ui.camera, k, a.x, a.y, W, H), true);
}

function isReset(): boolean {
  return ui.camera.k === 1 && ui.camera.x === 0 && ui.camera.y === 0;
}

/** Reset to 100%, easing (keys, Esc, the bottom bar's percentage). */
export function resetZoom(): void {
  if (isReset()) return;
  resetCamera(true);
  syncPointer();
}

implement('zoom', () => (zoomed() ? resetZoom() : zoomKeyTo(ZOOM_TOGGLE)), canZoom);
implement('zoomIn', () => zoomKeyTo(ui.camera.k * ZOOM_STEP), canZoom);
implement('zoomOut', () => zoomKeyTo(ui.camera.k / ZOOM_STEP), canZoom);
// Go-to (earlier in the registry) claims `0` while digits are typed; otherwise it lands here.
implement('zoomReset', resetZoom, canZoom);

onEscape('zoom', ESCAPE_RANK.zoom, () => {
  if (isReset()) return false;
  resetZoom();
  return true;
});

// ── Pointer input ───────────────────────────────────────────────────────────

/** Elements a press must reach untouched: sticky notes, form controls, video controls. */
const OWN_POINTER = '.sticky, button, input, textarea, select, [contenteditable], video[controls]';

/**
 * Wheel, pinch, and drag-to-pan on the stage area. Returns the cleanup.
 *
 * - Ctrl/⌘ + wheel, and trackpad pinch (a wheel event with ctrlKey), zoom
 *   around the cursor, immediately. The listener is not passive, and calls
 *   preventDefault so the browser's own page zoom never runs.
 * - A plain wheel pans while zoomed.
 * - With no tool on and k > 1, dragging pans. A press on a sticky note, a
 *   control or video controls is left alone. A press that does not move past
 *   PAN_SLOP stays a click (a link still follows); one that does pans, and
 *   the click its release would make is swallowed.
 */
export function attachZoom(viewport: HTMLElement): () => void {
  const scaleOf = () => {
    const stage = viewport.querySelector<HTMLElement>('.stage');
    if (!stage || stage.offsetWidth === 0) return 1;
    return stage.getBoundingClientRect().width / stage.offsetWidth || 1;
  };

  const track = (e: PointerEvent) => {
    pointer = e.target instanceof Node && viewport.contains(e.target) ? { clientX: e.clientX, clientY: e.clientY } : null;
  };
  const forget = () => {
    pointer = null;
  };

  const wheel = (e: WheelEvent) => {
    if (!canZoom()) return;
    const { W, H } = size();
    const pinch = e.ctrlKey || e.metaKey;
    if (pinch) {
      // Anywhere in the app (bars included): the page itself must never zoom.
      e.preventDefault();
      const f = clientToFrame(e);
      if (!f) return;
      const dy = wheelPixels(e.deltaY, e.deltaMode, viewport.clientHeight);
      setCamera(zoomAt(ui.camera, ui.camera.k * wheelZoomFactor(dy), f.x, f.y, W, H), false);
      return;
    }
    if (!zoomed() || !(e.target instanceof Node) || !viewport.contains(e.target)) return;
    e.preventDefault();
    const scale = scaleOf();
    const dx = wheelPixels(e.deltaX, e.deltaMode, viewport.clientWidth) / scale;
    const dy = wheelPixels(e.deltaY, e.deltaMode, viewport.clientHeight) / scale;
    setCamera(panBy(ui.camera, -dx, -dy, W, H), false);
  };

  // Drag to pan.
  let press: { id: number; clientX: number; clientY: number; camera: Camera; scale: number } | null = null;
  let suppressClick = false;

  const canPan = () => zoomed() && ui.tool === null && ui.overlay === null;

  const down = (e: PointerEvent) => {
    if (press || e.button !== 0 || !e.isPrimary || !canPan()) return;
    if (e.target instanceof Element && e.target.closest(OWN_POINTER)) return;
    press = { id: e.pointerId, clientX: e.clientX, clientY: e.clientY, camera: { ...ui.camera }, scale: scaleOf() };
  };

  const move = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.clientX;
    const dy = e.clientY - press.clientY;
    if (!ui.panning) {
      if (Math.hypot(dx, dy) < PAN_SLOP) return;
      ui.panning = true;
      viewport.setPointerCapture(e.pointerId);
    }
    const { W, H } = size();
    setCamera(panBy(press.camera, dx / press.scale, dy / press.scale, W, H), false);
  };

  const up = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (!ui.panning) return;
    ui.panning = false;
    // The release after a pan is not a click on whatever is under it.
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  };

  const click = (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // While pan is armed, images must not start a native drag.
  const dragstart = (e: DragEvent) => {
    if (canPan()) e.preventDefault();
  };

  window.addEventListener('pointermove', track, { passive: true });
  window.addEventListener('pointerdown', track, { passive: true });
  document.documentElement.addEventListener('pointerleave', forget);
  window.addEventListener('wheel', wheel, { passive: false });
  viewport.addEventListener('pointerdown', down);
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('dragstart', dragstart);
  window.addEventListener('click', click, true);
  return () => {
    window.removeEventListener('pointermove', track);
    window.removeEventListener('pointerdown', track);
    document.documentElement.removeEventListener('pointerleave', forget);
    window.removeEventListener('wheel', wheel);
    viewport.removeEventListener('pointerdown', down);
    viewport.removeEventListener('pointermove', move);
    viewport.removeEventListener('pointerup', up);
    viewport.removeEventListener('pointercancel', up);
    viewport.removeEventListener('dragstart', dragstart);
    window.removeEventListener('click', click, true);
    press = null;
    pointer = null;
    ui.panning = false;
  };
}
