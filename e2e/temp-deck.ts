// Temporary decks for end-to-end tests. They live in decks/zz-e2e-* (gitignored)
// so tests never touch decks/demo, and are removed even when a test fails.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DECKS = fileURLToPath(new URL('../decks/', import.meta.url));
export const TEMP_PREFIX = 'zz-e2e-';

export function writeDeck(slug: string, source: string): void {
  if (!slug.startsWith(TEMP_PREFIX)) throw new Error(`temporary deck slugs must start with ${TEMP_PREFIX}`);
  mkdirSync(join(DECKS, slug), { recursive: true });
  writeFileSync(join(DECKS, slug, 'deck.md'), source);
}

export function removeTempDecks(): void {
  for (const name of readdirSync(DECKS)) {
    if (name.startsWith(TEMP_PREFIX)) rmSync(join(DECKS, name), { recursive: true, force: true });
  }
}
