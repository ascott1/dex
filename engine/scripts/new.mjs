// `pnpm new <slug>`: create decks/<slug>/deck.md from the starter template.
// Decks live in `decks/` under the current directory, which is the project root when run
// through pnpm, or in the folder DEX_DECKS names (engine/decks-dir.mjs).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decksDir, showPath } from '../decks-dir.mjs';
import { starterDeck } from './template.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(`dex: ${message}`);
  process.exit(1);
}

const slug = process.argv[2];
if (!slug) fail('usage: pnpm new <slug>   (lowercase letters, digits, and hyphens, e.g. pnpm new my-talk)');
if (!SLUG_RE.test(slug)) {
  fail(`"${slug}" is not a valid deck name. Use lowercase letters, digits, and hyphens, starting with a letter or digit.`);
}

const deckDir = path.join(decksDir(), slug);
const file = path.join(deckDir, 'deck.md');
const shownDir = showPath(deckDir);
const shown = `${shownDir}/deck.md`;
if (existsSync(file)) fail(`${shown} already exists; not overwriting it.`);

mkdirSync(path.join(deckDir, 'media'), { recursive: true });
writeFileSync(file, starterDeck(slug), { flag: 'wx' });

console.log(`Created ${shown}`);
console.log(`Put images in ${shownDir}/media/ and run: pnpm start ${slug}`);
