// Global settings (persisted under `dex:settings`) and the per-deck theme
// override (persisted under `dex:theme:<slug>`), §5.

import { DEFAULT_SETTINGS, type Settings, type Slide, type ThemeName } from '$shared/types';
import { readJSON, readString, writeJSON, writeString } from '../lib/storage';
import { deck } from './deck.svelte';

const SETTINGS_KEY = 'dex:settings';

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function loadSettings(): Settings {
  const d = DEFAULT_SETTINGS;
  const s = readJSON<Partial<Settings>>(SETTINGS_KEY) ?? {};
  const pen: Partial<Settings['pen']> = typeof s.pen === 'object' && s.pen ? s.pen : {};
  return {
    textScale: pick(s.textScale, ['quiet', 'regular', 'loud'] as const, d.textScale),
    builds: typeof s.builds === 'boolean' ? s.builds : d.builds,
    motion: typeof s.motion === 'boolean' ? s.motion : d.motion,
    chrome: pick(s.chrome, ['auto', 'always', 'hidden'] as const, d.chrome),
    marks: typeof s.marks === 'boolean' ? s.marks : d.marks,
    followEdits: typeof s.followEdits === 'boolean' ? s.followEdits : d.followEdits,
    pen: {
      tool: pick(pen.tool, ['pen', 'marker', 'arrow', 'box', 'eraser'] as const, d.pen.tool),
      color: pick(pen.color, ['ink', 'red', 'blue'] as const, d.pen.color),
      size: typeof pen.size === 'number' && pen.size > 0 ? pen.size : d.pen.size,
    },
  };
}

export const settings: Settings = $state(loadSettings());

// Persist on every change. The snapshot reads every field, so the effect
// depends on all of them.
$effect.root(() => {
  $effect(() => {
    writeJSON(SETTINGS_KEY, $state.snapshot(settings));
  });
});

/** The theme the user picked for the open deck, overriding its frontmatter. */
export const deckTheme = $state({ slug: null as string | null, override: null as ThemeName | null });

export function loadDeckTheme(slug: string): void {
  const stored = readString(`dex:theme:${slug}`);
  deckTheme.slug = slug;
  deckTheme.override = stored === 'paper' || stored === 'ink' ? stored : null;
}

export function setDeckTheme(theme: ThemeName): void {
  if (!deckTheme.slug) return;
  deckTheme.override = theme;
  writeString(`dex:theme:${deckTheme.slug}`, theme);
}

/** Deck theme before per-slide changes: the user's override, else the frontmatter. */
export function baseTheme(): ThemeName {
  const current = deck.current;
  if (current && deckTheme.slug === current.slug && deckTheme.override) return deckTheme.override;
  return current?.meta.theme ?? 'paper';
}

/** A slide's own theme: flipped by `invert`, forced to Ink by a `bg` image (§7). */
export function slideTheme(slide: Slide | undefined, base: ThemeName = baseTheme()): ThemeName {
  if (!slide) return base;
  if (slide.attrs['data-bg'] === 'image') return 'ink';
  if (slide.options.invert) return base === 'paper' ? 'ink' : 'paper';
  return base;
}
