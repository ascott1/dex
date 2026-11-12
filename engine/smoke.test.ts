import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types.ts';

describe('toolchain', () => {
  it('runs TypeScript tests against shared types', () => {
    expect(DEFAULT_SETTINGS.textScale).toBe('regular');
    expect(DEFAULT_SETTINGS.pen).toEqual({ tool: 'pen', color: 'ink', size: 6 });
  });
});
