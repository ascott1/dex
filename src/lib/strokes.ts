// Geometry for drawn marks (§9 Phase 6 "Drawing"). Pure functions, stage logical pixels.

import { getStroke } from 'perfect-freehand';
import type { Stroke } from '$shared/types';

export const PEN_SIZES = [4, 6, 10] as const;
export const MARKER_SIZE = 28;
/** The marker's opacity per theme. DrawLayer's `.marker` rule holds the same two numbers. */
export const MARKER_OPACITY = { paper: 0.45, ink: 0.6 } as const;
/** Arrow and box drags shorter than this are discarded. */
export const MIN_SHAPE = 8;

/**
 * Mouse and touch input store a constant pressure of 0.5; a stroke whose
 * pressures are all 0.5 is drawn with simulated pressure, as when it was drawn
 * live, so the shape after a reload is the shape that was drawn.
 */
export const NO_PRESSURE = 0.5;

const average = (a: number, b: number) => (a + b) / 2;

/** The quadratic-curve helper from the perfect-freehand README. */
export function svgPathFromStroke(points: number[][], closed = true): string {
  const len = points.length;
  if (len < 4) return '';
  let a = points[0]!;
  let b = points[1]!;
  const c = points[2]!;
  let result = `M${a[0]!.toFixed(2)},${a[1]!.toFixed(2)} Q${b[0]!.toFixed(2)},${b[1]!.toFixed(2)} ${average(b[0]!, c[0]!).toFixed(2)},${average(b[1]!, c[1]!).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i]!;
    b = points[i + 1]!;
    result += `${average(a[0]!, b[0]!).toFixed(2)},${average(a[1]!, b[1]!).toFixed(2)} `;
  }
  if (closed) result += 'Z';
  return result;
}

/**
 * The outline polygon of a pen or marker stroke, as `[x, y]` points. `last` is
 * false while it is being drawn.
 */
export function freehandOutline(stroke: Pick<Stroke, 'tool' | 'size' | 'points'>, last = true): number[][] {
  const marker = stroke.tool === 'marker';
  const simulatePressure = stroke.points.every((p) => p[2] === NO_PRESSURE);
  return getStroke(stroke.points, {
    size: marker ? MARKER_SIZE : stroke.size,
    thinning: marker ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure,
    last,
  });
}

/** Filled outline of a pen or marker stroke, as an SVG path. `last` is false while it is being drawn. */
export function freehandPath(stroke: Pick<Stroke, 'tool' | 'size' | 'points'>, last = true): string {
  return svgPathFromStroke(freehandOutline(stroke, last));
}

/** The two arms of an arrow head: `max(14, size·3)` long at ±28° from the shaft. */
export function arrowHead(stroke: Pick<Stroke, 'size' | 'points'>): [number, number, number, number][] {
  const [x1, y1] = stroke.points[0]!;
  const [x2, y2] = stroke.points[stroke.points.length - 1]!;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const arm = Math.max(14, stroke.size * 3);
  const spread = (28 * Math.PI) / 180;
  return [angle + Math.PI - spread, angle + Math.PI + spread].map(
    (a) => [x2, y2, x2 + arm * Math.cos(a), y2 + arm * Math.sin(a)] as [number, number, number, number],
  );
}

/** The rectangle spanned by a box's two points. */
export function boxRect(stroke: Pick<Stroke, 'points'>): { x: number; y: number; width: number; height: number } {
  const [x1, y1] = stroke.points[0]!;
  const [x2, y2] = stroke.points[stroke.points.length - 1]!;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function shapeLength(points: Stroke['points']): number {
  const [x1, y1] = points[0]!;
  const [x2, y2] = points[points.length - 1]!;
  return Math.hypot(x2 - x1, y2 - y1);
}

/** The next pen size up (`]`) or down (`[`), cycling. */
export function cyclePenSize(size: number, dir: 1 | -1): number {
  const i = PEN_SIZES.indexOf(size as (typeof PEN_SIZES)[number]);
  const from = i >= 0 ? i : PEN_SIZES.indexOf(6);
  return PEN_SIZES[(from + dir + PEN_SIZES.length) % PEN_SIZES.length]!;
}
