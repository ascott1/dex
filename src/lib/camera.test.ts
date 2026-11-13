import { describe, expect, it } from 'vitest';
import { clampCamera, frameToSlide, panBy, wheelPixels, wheelZoomFactor, zoomAt } from './camera';

const W = 1600;
const H = 900;
const ID = { k: 1, x: 0, y: 0 };

describe('camera', () => {
  it('clamps k to 1–6 and the offset so the slide covers the stage', () => {
    expect(clampCamera({ k: 0.5, x: 10, y: 10 }, W, H)).toEqual(ID);
    expect(clampCamera({ k: 9, x: 0, y: 0 }, W, H).k).toBe(6);
    expect(clampCamera({ k: 2, x: 50, y: 50 }, W, H)).toEqual({ k: 2, x: 0, y: 0 });
    expect(clampCamera({ k: 2, x: -5000, y: -5000 }, W, H)).toEqual({ k: 2, x: -1600, y: -900 });
    expect(clampCamera({ k: 1.0004, x: -1, y: -1 }, W, H)).toEqual(ID);
    expect(Object.is(clampCamera({ k: 1, x: -0, y: -0 }, W, H).x, 0)).toBe(true);
    expect(clampCamera({ k: Number.NaN, x: 0, y: 0 }, W, H)).toEqual(ID);
  });

  it('zooming at a point keeps that point fixed', () => {
    const c = zoomAt(ID, 2, 400, 300, W, H);
    expect(c).toEqual({ k: 2, x: -400, y: -300 });
    // The slide point under (400, 300) is the same before and after.
    expect(frameToSlide(ID, 400, 300)).toEqual(frameToSlide(c, 400, 300));
    const d = zoomAt(c, 3.3, 1000, 700, W, H);
    const before = frameToSlide(c, 1000, 700);
    const after = frameToSlide(d, 1000, 700);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zooming at a corner stays on that corner, and zooming out returns to the identity', () => {
    expect(zoomAt(ID, 2, W, H, W, H)).toEqual({ k: 2, x: -1600, y: -900 });
    expect(zoomAt(ID, 2, 0, 0, W, H)).toEqual({ k: 2, x: 0, y: 0 });
    expect(zoomAt({ k: 2, x: -800, y: -450 }, 1, 123, 456, W, H)).toEqual(ID);
    expect(zoomAt(ID, 100, 800, 450, W, H).k).toBe(6);
  });

  it('pans within the clamp', () => {
    const c = { k: 2, x: -800, y: -450 };
    expect(panBy(c, 100, -100, W, H)).toEqual({ k: 2, x: -700, y: -550 });
    expect(panBy(c, 5000, 5000, W, H)).toEqual({ k: 2, x: 0, y: 0 });
    expect(panBy(c, -5000, -5000, W, H)).toEqual({ k: 2, x: -1600, y: -900 });
    expect(panBy(ID, 100, 100, W, H)).toEqual(ID);
  });

  it('wheel deltas', () => {
    expect(wheelPixels(3, 1, 900)).toBe(48);
    expect(wheelPixels(1, 2, 900)).toBe(900);
    expect(wheelPixels(7, 0, 900)).toBe(7);
    expect(wheelZoomFactor(-10)).toBeCloseTo(Math.exp(0.1), 12);
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.25), 12);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});
