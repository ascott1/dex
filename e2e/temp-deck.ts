// The end-to-end tests' decks. The servers under test are pointed (DEX_DECKS,
// see playwright.config.ts) at a folder of the tests' own, e2e/.decks
// (gitignored), not at decks/: whatever decks this machine has, the tests see a
// copy of the demo and nothing else, and they never write to decks/demo.
// Temporary decks are e2e/.decks/zz-e2e-*, removed even when a test fails.

import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DECKS = fileURLToPath(new URL('./.decks/', import.meta.url));
/** The folder as the app prints it: relative to the project. */
export const DECKS_SHOWN = 'e2e/.decks';
export const TEMP_PREFIX = 'zz-e2e-';

const DEMO = fileURLToPath(new URL('../decks/demo/', import.meta.url));

/** A fresh copy of decks/demo, without the owner's marks. */
export function copyDemo(): void {
  mkdirSync(DECKS, { recursive: true });
  rmSync(join(DECKS, 'demo'), { recursive: true, force: true });
  cpSync(DEMO, join(DECKS, 'demo'), { recursive: true, filter: (src) => basename(src) !== 'marks.json' });
}

export function writeDeck(slug: string, source: string): void {
  if (!slug.startsWith(TEMP_PREFIX)) throw new Error(`temporary deck slugs must start with ${TEMP_PREFIX}`);
  mkdirSync(join(DECKS, slug), { recursive: true });
  writeFileSync(join(DECKS, slug, 'deck.md'), source);
}

export function removeTempDecks(): void {
  mkdirSync(DECKS, { recursive: true });
  for (const name of readdirSync(DECKS)) {
    if (name.startsWith(TEMP_PREFIX)) rmSync(join(DECKS, name), { recursive: true, force: true });
  }
}
