import type { LayoutName, SlideOptions } from '../../shared/types.ts';
import type { MdRoot } from './ast.ts';
import type { LineWarning } from './frontmatter.ts';

const LAYOUTS: readonly LayoutName[] = [
  'default', 'title', 'section', 'statement', 'quote',
  'image', 'figure', 'split', 'gallery', 'columns', 'full',
];

const COMMENT = /^<!--([\s\S]*?)-->$/;
/** A directive-shaped segment: a lowercase identifier, a colon, then the value. */
const PAIR = /^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)([?#].*)?$/i;

type Validator = (value: string) => unknown;

const bool: Validator = (v) => (v === 'true' ? true : v === 'false' ? false : undefined);
const oneOf = (...allowed: string[]): Validator => (v) => (allowed.includes(v) ? v : undefined);
const text: Validator = (v) => (v === '' ? undefined : v);

const DIRECTIVES: Record<keyof SlideOptions, Validator> = {
  layout: oneOf(...LAYOUTS),
  invert: bool,
  build: bool,
  image: oneOf('left', 'right'),
  fit: oneOf('cover', 'contain'),
  align: oneOf('top', 'center'),
  bg: text,
  class: text,
  id: text,
  skip: bool,
  transition: oneOf('fade', 'none'),
};

export function isImagePath(value: string): boolean {
  return IMAGE_EXT.test(value);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** The directive key that `key` is probably a typo of, if any. */
export function nearestDirective(key: string): string | null {
  let best: string | null = null;
  let bestDistance = 3;
  for (const known of Object.keys(DIRECTIVES)) {
    const d = editDistance(key, known);
    // Allow one slip in short keys and two in longer ones.
    if (d < bestDistance && d <= (known.length <= 4 ? 1 : 2)) {
      best = known;
      bestDistance = d;
    }
  }
  return best;
}

/** Split a comment body on commas and newlines, but not on commas inside parentheses. */
export function splitSegments(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ',' && depth === 0) || ch === '\n') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/** Remove common leading indentation and surrounding blank lines. */
function dedent(body: string): string {
  const lines = body.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n').trim();
}

export interface CommentResult {
  options: SlideOptions;
  /** Speaker-note bodies, in source order (Markdown). */
  notes: string[];
  /** `line` is 1-based within the parsed chunk text. */
  warnings: LineWarning[];
}

/**
 * Remove root-level HTML comments from `root`, turning each into slide options
 * (a directive) or a speaker note.
 */
export function extractComments(root: MdRoot): CommentResult {
  const options: SlideOptions = {};
  const notes: string[] = [];
  const warnings: LineWarning[] = [];

  root.children = root.children.filter((node) => {
    if (node.type !== 'html') return true;
    const value = node.value.trim();
    const line = node.position?.start.line ?? 1;
    const m = COMMENT.exec(value);
    if (!m) {
      if (!value.startsWith('<!--') || value.includes('-->')) return true;
      // An unclosed comment would swallow the rest of the slide. The usual cause
      // is a `---` line inside a note, which always starts a new slide.
      warnings.push({
        line,
        message: 'comment is never closed on this slide (a `---` line starts a new slide even inside a comment)',
      });
      const note = dedent(value.slice(4));
      if (note) notes.push(note);
      return false;
    }
    const body = m[1]!;
    const segments = splitSegments(body);
    const pairs = segments.map((s) => PAIR.exec(s));
    const allPairs = pairs.length > 0 && pairs.every((p) => p !== null);
    const allKnown = allPairs && pairs.every((p) => Object.hasOwn(DIRECTIVES, p![1]!));

    if (allKnown) {
      for (const p of pairs) {
        const key = p![1]! as keyof SlideOptions;
        const raw = p![2]!.trim();
        const value = DIRECTIVES[key](raw);
        if (value === undefined) {
          warnings.push({ line, message: `invalid value for directive "${key}": "${raw}"` });
        } else {
          (options as Record<string, unknown>)[key] = value;
        }
      }
    } else {
      if (allPairs) {
        // Warn only when this was clearly meant as a directive: it mixes in a real
        // key, or a key is a near miss. `todo: fix this` is just a note.
        const keys = pairs.map((p) => p![1]!);
        const unknown = keys.filter((k) => !Object.hasOwn(DIRECTIVES, k));
        const someKnown = unknown.length < keys.length;
        for (const key of unknown) {
          const guess = nearestDirective(key);
          if (guess) warnings.push({ line, message: `unknown directive "${key}" (did you mean "${guess}"?)` });
          else if (someKnown) warnings.push({ line, message: `unknown directive "${key}"; the whole comment was kept as a note` });
        }
      }
      const note = dedent(body);
      if (note) notes.push(note);
    }
    return false;
  });

  return { options, notes, warnings };
}
