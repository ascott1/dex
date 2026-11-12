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
    const m = COMMENT.exec(node.value.trim());
    if (!m) return true;
    const line = node.position?.start.line ?? 1;
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
        const unknown = pairs.map((p) => p![1]!).filter((k) => !Object.hasOwn(DIRECTIVES, k));
        warnings.push({
          line,
          message: `unknown directive ${unknown.map((k) => `"${k}"`).join(', ')}`,
        });
      }
      const note = dedent(body);
      if (note) notes.push(note);
    }
    return false;
  });

  return { options, notes, warnings };
}
