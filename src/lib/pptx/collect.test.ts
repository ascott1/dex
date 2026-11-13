// collect.ts is tested end to end (e2e/pptx.spec.ts), since it measures a real
// layout. Its colour parser needs no DOM for what computed styles return. (Hex
// tokens are read end to end: the pen and sticky-note colours in the e2e spec.)
import { describe, expect, it } from 'vitest';
import { parseColor } from './collect';

describe('parseColor', () => {
  it('reads what computed styles give: rgb(), rgba(), and color(srgb …) from color-mix()', () => {
    expect(parseColor('rgb(15, 20, 19)')).toEqual({ color: '0F1413', alpha: 1 });
    expect(parseColor('rgba(15, 20, 19, 0.05)')).toEqual({ color: '0F1413', alpha: 0.05 });
    expect(parseColor('rgb(15 20 19 / 0.05)')).toEqual({ color: '0F1413', alpha: 0.05 });
    expect(parseColor('rgb(15 20 19 / 50%)')).toEqual({ color: '0F1413', alpha: 0.5 });
    expect(parseColor('color(srgb 1 0.5 0 / 0.6)')).toEqual({ color: 'FF8000', alpha: 0.6 });
    expect(parseColor('color(srgb 0.2 0.4 0.6)')).toEqual({ color: '336699', alpha: 1 });
  });

  it('treats transparent, empty and out-of-range values safely', () => {
    expect(parseColor('transparent').alpha).toBe(0);
    expect(parseColor('').alpha).toBe(0);
    expect(parseColor('rgba(0, 0, 0, 0)').alpha).toBe(0);
    expect(parseColor('rgb(300, -5, 19.6)')).toEqual({ color: 'FF0014', alpha: 1 });
  });
});
