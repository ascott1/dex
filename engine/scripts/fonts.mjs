// `pnpm fonts <deck>` or `pnpm fonts <file.svg>...`: embed DM Sans and DM Mono in
// SVG images, so their text is drawn in the deck's fonts on any computer.
// See embed-fonts.mjs for why, and docs/images.md for when.
// Decks live in `decks/` under the current directory, which is the project root when run
// through pnpm, or in the folder DEX_DECKS names (engine/decks-dir.mjs).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decksDir, showPath } from '../decks-dir.mjs';
import { embedFonts, loadFaces } from './embed-fonts.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message) {
  console.error(`dex: ${message}`);
  process.exit(1);
}

/** Every .svg under a folder, sorted, skipping dotfiles. */
function svgsIn(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return svgsIn(full);
      return entry.name.toLowerCase().endsWith('.svg') ? [full] : [];
    });
}

const args = process.argv.slice(2);
if (args.length === 0) {
  fail('usage: pnpm fonts <deck>   or   pnpm fonts <file.svg>...   (e.g. pnpm fonts talk, pnpm fonts decks/talk/media/flow.svg)');
}

const files = [];
for (const arg of args) {
  if (arg.toLowerCase().endsWith('.svg')) {
    const file = path.resolve(arg);
    if (!existsSync(file) || !statSync(file).isFile()) fail(`${arg} does not exist.`);
    files.push(file);
  } else if (SLUG_RE.test(arg)) {
    const deckDir = path.join(decksDir(), arg);
    if (!existsSync(deckDir)) fail(`${showPath(deckDir)} does not exist.`);
    const found = svgsIn(deckDir);
    if (found.length === 0) console.log(`${showPath(deckDir)} has no SVG images.`);
    files.push(...found);
  } else {
    fail(`"${arg}" is neither a deck name nor an .svg file.`);
  }
}

const faces = loadFaces();
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

for (const file of files) {
  const shown = showPath(file);
  const before = readFileSync(file, 'utf8');
  const { svg, families, missing } = embedFonts(before, faces);
  if (families.length === 0) {
    // Nothing to embed. Fonts left by an earlier run, before the text went, are taken out.
    if (svg !== before) writeFileSync(file, svg);
    console.log(`${shown}: no text in DM Sans or DM Mono, ${svg === before ? 'left as it is' : 'embedded fonts removed'}`);
    continue;
  }
  if (svg === before) {
    console.log(`${shown}: ${families.join(' and ')} already embedded`);
  } else {
    writeFileSync(file, svg);
    console.log(`${shown}: embedded ${families.join(' and ')} (${kb(Buffer.byteLength(svg))})`);
  }
  if (missing.length > 0) {
    console.log(`  not in these fonts, so drawn in another: ${missing.join(' ')}`);
  }
}
