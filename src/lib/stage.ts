// Stage geometry (§7 "Stage fit") and client → stage coordinate conversion.

import type { DeckMeta } from '$shared/types';

export const STAGE_H = 900;

export function stageSize(aspect: DeckMeta['aspect'] = '16:9'): { W: number; H: number } {
  const W = aspect === '16:10' ? 1440 : aspect === '4:3' ? 1200 : 1600;
  return { W, H: STAGE_H };
}

export interface StageFit {
  scale: number;
  left: number;   // CSS px offset of the stage's top-left corner inside the viewport
  top: number;
}

/** Scale the W×H stage to fit a viewport, centered. */
export function fitStage(viewportW: number, viewportH: number, W: number, H: number): StageFit {
  if (viewportW <= 0 || viewportH <= 0) return { scale: 1, left: 0, top: 0 };
  const scale = Math.min(viewportW / W, viewportH / H);
  return { scale, left: (viewportW - W * scale) / 2, top: (viewportH - H * scale) / 2 };
}

// The reference overlay is an empty <svg viewBox="0 0 W H"> that fills `.camera`
// (Stage.svelte registers it). Its screen CTM includes the stage scale, the
// stage offset, and the camera transform, so inverting it maps a client point
// to the slide's logical coordinates under any zoom or pan.
let overlay: SVGSVGElement | null = null;

export function registerStageOverlay(el: SVGSVGElement | null): void {
  overlay = el;
}

/**
 * Convert a pointer or mouse event's client position to logical stage
 * coordinates (1600×900 space, camera applied). Returns null before the stage
 * exists.
 */
export function clientToStage(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const ctm = overlay?.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/**
 * Convert a client position to stage-frame coordinates: logical stage pixels
 * before the camera (what zoom anchors on, and where the laser is drawn).
 * Unlike clientToStage, it does not depend on the camera, so it is right even
 * while a camera transition is running. Returns null before the stage exists.
 */
export function clientToFrame(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const stage = overlay?.closest<HTMLElement>('.stage');
  if (!stage || stage.offsetWidth === 0) return null;
  const rect = stage.getBoundingClientRect();
  const scale = rect.width / stage.offsetWidth;
  if (!(scale > 0)) return null;
  return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
}
