// Camera math for zoom and pan (§9 Phase 7). Pure functions, unit tested.
//
// The camera is `translate(x, y) scale(k)` on `.camera`, origin 0 0, in stage
// logical pixels. A point `p` in slide coordinates is drawn at `x + k·p` in the
// stage frame (stage coordinates before the camera).

export interface Camera {
  k: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** `+` and `-` multiply or divide by this. */
export const ZOOM_STEP = 1.25;
/** `z` toggles between 1× and this. */
export const ZOOM_TOGGLE = 2;
/** Largest |deltaY| one wheel event may use (a mouse notch is about 100). */
export const MAX_WHEEL_DELTA = 25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `+ 0` turns -0 into 0, so a reset camera compares equal to { k: 1, x: 0, y: 0 }. */
const tidy = (v: number) => v + 0;

/**
 * Clamp a camera so the scaled slide always covers the stage: `k` to 1–6, `x`
 * to `[W·(1−k), 0]`, `y` to `[H·(1−k), 0]`. A `k` within 0.001 of 1 snaps to 1.
 */
export function clampCamera(c: Camera, W: number, H: number): Camera {
  let k = clamp(Number.isFinite(c.k) ? c.k : 1, MIN_ZOOM, MAX_ZOOM);
  if (Math.abs(k - 1) < 1e-3) k = 1;
  return {
    k,
    x: tidy(clamp(c.x, W * (1 - k), 0)),
    y: tidy(clamp(c.y, H * (1 - k), 0)),
  };
}

/**
 * Zoom to `k` keeping the stage-frame point (px, py) fixed on screen:
 * `x' = px − (px − x)·k'/k`. The result is clamped, so near an edge the point
 * moves only as far as the clamp needs.
 */
export function zoomAt(c: Camera, k: number, px: number, py: number, W: number, H: number): Camera {
  const next = clamp(k, MIN_ZOOM, MAX_ZOOM);
  const r = next / c.k;
  return clampCamera({ k: next, x: px - (px - c.x) * r, y: py - (py - c.y) * r }, W, H);
}

/** Move the camera by (dx, dy) stage pixels, clamped. */
export function panBy(c: Camera, dx: number, dy: number, W: number, H: number): Camera {
  return clampCamera({ k: c.k, x: c.x + dx, y: c.y + dy }, W, H);
}

/** A wheel delta in CSS pixels, whatever its `deltaMode` (pixels, lines, pages). */
export function wheelPixels(delta: number, deltaMode: number, page: number): number {
  return deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * page : delta;
}

/**
 * Zoom factor for a Ctrl/⌘ + wheel or pinch event: `exp(−deltaY · 0.01)`, with
 * deltaY capped so one mouse-wheel notch is a step (about 1.28×), not 2.7×.
 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-clamp(deltaY, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA) * 0.01);
}

/** Slide coordinates of a stage-frame point under a camera. */
export function frameToSlide(c: Camera, px: number, py: number): { x: number; y: number } {
  return { x: (px - c.x) / c.k, y: (py - c.y) / c.k };
}
