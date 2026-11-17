// Embedding the deck's fonts in an SVG (`pnpm fonts`, see fonts.mjs).
//
// The browser draws an image file on its own: an SVG shown through <img>, as
// every deck image is, cannot use the page's fonts, so its text is in DM Sans
// and DM Mono only where they are installed. A <style> inside the SVG with the
// fonts as data: URLs travels with the file and works everywhere.
//
// This module has no file access of its own except `loadFaces`, which reads the
// same @fontsource packages the app imports (src/main.ts).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** The id of the <style> this writes, which is how a second run finds and replaces it. */
export const STYLE_ID = 'dex-fonts';

// Each family, the package CSS that describes its files, and when a sheet is wanted.
// DM Sans is the optical-size build, as in the app, so text is drawn as the slide draws it.
const SOURCES = [
  { family: 'DM Sans', css: '@fontsource-variable/dm-sans/opsz.css', when: 'always' },
  { family: 'DM Mono', css: '@fontsource/dm-mono/400.css', when: 'always' },
  { family: 'DM Mono', css: '@fontsource/dm-mono/500.css', when: 'bold' },
];

const STYLE_RE = new RegExp(`\\s*<style id="${STYLE_ID}">[^<]*</style>`, 'g');
const SVG_OPEN_RE = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/;
// `font-weight` of 500 or more, as an attribute or in CSS.
const BOLD_RE = /font-weight\s*[:=]\s*["']?\s*(?:[5-9]\d\d|bold)/;

/** `U+0000-00FF,U+0131` → [[0, 255], [305, 305]] */
function parseRanges(text) {
  return text.split(',').map((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(from, 16), parseInt(to, 16)];
  });
}

/**
 * The font faces that can be embedded, read from the @fontsource packages:
 * one per family, weight, and subset (latin, latin-ext), with the file as base64.
 */
export function loadFaces() {
  const require = createRequire(import.meta.url);
  const faces = [];
  for (const { family, css, when } of SOURCES) {
    const cssFile = require.resolve(css);
    for (const block of readFileSync(cssFile, 'utf8').matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const body = block[1];
      const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1].trim();
      const file = /url\(([^)]+\.woff2)\)/.exec(body)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim();
      if (!weight || !file || !range) throw new Error(`cannot read a font face in ${css}`);
      const data = readFileSync(path.resolve(path.dirname(cssFile), file)).toString('base64');
      faces.push({ family, weight, when, range, ranges: parseRanges(range), data });
    }
  }
  return faces;
}

/** The characters of the SVG's text: everything outside tags, with character references decoded. */
function textCodePoints(svg) {
  const text = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(?:amp|lt|gt|quot|apos);/g, 'x');
  const points = new Set();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp > 0x20) points.add(cp);
  }
  return points;
}

const covers = (face, cp) => face.ranges.some(([from, to]) => cp >= from && cp <= to);

/**
 * Returns the SVG with the fonts its text uses embedded in a <style> after the
 * opening tag. A style from an earlier run is replaced, so this can be run again
 * after an edit. `families` lists what was embedded; it is empty, and the SVG is
 * returned without a style, when the file has no text in either font. `missing`
 * lists characters that neither font has, which the browser draws in another font.
 */
export function embedFonts(svg, faces) {
  const bare = svg.replace(STYLE_RE, '');
  const open = SVG_OPEN_RE.exec(bare);
  if (!open || !/<text\b/.test(bare)) return { svg: bare, families: [], missing: [] };

  const points = textCodePoints(bare);
  const bold = BOLD_RE.test(bare);
  const rules = [];
  const families = [];
  for (const family of new Set(faces.map((f) => f.family))) {
    if (!bare.includes(family)) continue;
    // The app's own name for the variable font, for an SVG that uses only that.
    const name = family === 'DM Sans' && !/DM Sans(?! Variable)/.test(bare) ? 'DM Sans Variable' : family;
    for (const face of faces) {
      if (face.family !== family || (face.when === 'bold' && !bold)) continue;
      if (![...points].some((cp) => covers(face, cp))) continue;
      rules.push(
        `@font-face{font-family:'${name}';font-weight:${face.weight};` +
          `src:url(data:font/woff2;base64,${face.data}) format('woff2');unicode-range:${face.range}}`,
      );
      if (!families.includes(family)) families.push(family);
    }
  }
  if (rules.length === 0) return { svg: bare, families: [], missing: [] };

  const used = faces.filter((f) => families.includes(f.family));
  const missing = [...points].filter((cp) => !used.some((f) => covers(f, cp))).map((cp) => String.fromCodePoint(cp));
  const at = open.index + open[0].length;
  const style = `\n<style id="${STYLE_ID}">${rules.join('')}</style>`;
  return { svg: bare.slice(0, at) + style + bare.slice(at), families, missing };
}
