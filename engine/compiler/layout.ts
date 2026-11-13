import { toString } from 'mdast-util-to-string';
import type { LayoutName, SlideOptions } from '../../shared/types.ts';
import type { MdBlock, MdHeading } from './ast.ts';

/** Number of images if `node` is a media block (a paragraph of only images), else 0. */
export function mediaCount(node: MdBlock): number {
  if (node.type !== 'paragraph') return 0;
  let images = 0;
  for (const child of node.children) {
    if (child.type === 'image' || child.type === 'imageReference') images++;
    else if (child.type === 'text' && child.value.trim() === '') continue;
    else if (child.type === 'break') continue;
    else return 0;
  }
  return images;
}

export function isHeading(node: MdBlock): node is MdHeading {
  return node.type === 'heading' && node.depth <= 5;
}

export interface Analysis {
  /** A leading depth-6 heading, set aside. */
  eyebrow: MdHeading | null;
  /** Root blocks after the eyebrow, ignoring footnote and link definitions. */
  blocks: MdBlock[];
  /** Total images across media blocks. */
  images: number;
  /** Number of media blocks, counting each image in a multi-image paragraph. */
  mediaBlocks: number;
}

export function analyze(children: MdBlock[]): Analysis {
  let blocks = children.filter((n) => n.type !== 'definition' && n.type !== 'footnoteDefinition');
  let eyebrow: MdHeading | null = null;
  const first = blocks[0];
  if (first && first.type === 'heading' && first.depth === 6) {
    eyebrow = first;
    blocks = blocks.slice(1);
  }
  const images = blocks.reduce((sum, b) => sum + mediaCount(b), 0);
  return { eyebrow, blocks, images, mediaBlocks: images };
}

export interface InferContext {
  /** Number of `|||` markers on the slide. */
  breaks: number;
  /** Whether this is the deck's first slide. */
  first: boolean;
}

/** The layout-inference rules of PLAN.md §6, first match wins. */
export function inferLayout(a: Analysis, ctx: InferContext): LayoutName {
  const { blocks } = a;
  const media = blocks.filter((b) => mediaCount(b) > 0);
  const others = blocks.filter((b) => mediaCount(b) === 0);
  const headings = blocks.filter(isHeading);

  // 1
  if (blocks.length === 0) return 'default';
  // 2
  if (others.length === 0) return a.images === 1 ? 'image' : 'gallery';
  // 3
  if (headings.length === 1 && headings[0]!.depth <= 2 && others.length === 1 && media.length > 0) {
    return a.images === 1 ? 'figure' : 'gallery';
  }
  // 4
  if (a.mediaBlocks === 1) return 'split';
  // 5
  if (blocks.length === 1 && blocks[0]!.type === 'blockquote') return 'quote';
  // 6
  if (ctx.breaks > 0) return 'columns';
  // 7
  if (headings.length === 1 && headings[0]!.depth === 1) {
    const rest = blocks.filter((b) => b !== headings[0]);
    if (rest.every((b) => b.type === 'paragraph') && rest.length <= 2) {
      return rest.length === 0 && !ctx.first ? 'section' : 'title';
    }
  }
  // 8
  if (
    headings.length === 0 &&
    blocks.length <= 2 &&
    blocks.every((b) => b.type === 'paragraph') &&
    blocks.reduce((n, b) => n + toString(b).trim().length, 0) <= 200
  ) {
    return 'statement';
  }
  // 9
  const h3 = headings.filter((h) => h.depth === 3);
  if (h3.length >= 2 && h3.length <= 6) {
    const firstIdx = blocks.indexOf(h3[0]!);
    const before = blocks.slice(0, firstIdx).filter(isHeading);
    const beforeOk =
      before.length === 0 ||
      (before.length === 1 && blocks[0] === before[0] && before[0]!.depth <= 2);
    const afterOk = blocks.slice(firstIdx + 1).filter(isHeading).every((h) => h.depth >= 3);
    if (beforeOk && afterOk) return 'columns';
  }
  // 10
  return 'default';
}

function lenClass(chars: number): string {
  if (chars <= 8) return 'xs';
  if (chars <= 40) return 's';
  if (chars <= 100) return 'm';
  return 'l';
}

/**
 * Characters in a quote, without its attribution (the paragraph `regions.ts`
 * marked with class `attrib`). Over 140 the quote is set smaller (§8 "Type").
 */
function quoteChars(quote: MdBlock): number {
  const children = 'children' in quote ? (quote.children as MdBlock[]) : [];
  return children
    .filter((child) => {
      const cls = (child.data as { hProperties?: { className?: unknown } } | undefined)?.hProperties?.className;
      return !(Array.isArray(cls) && cls.includes('attrib'));
    })
    .map((child) => toString(child).replace(/\s+/g, ' ').trim())
    .join(' ')
    .length;
}

const DEFAULT_FIT: Partial<Record<LayoutName, 'cover' | 'contain'>> = {
  image: 'cover',
  split: 'cover',
  figure: 'contain',
};

/**
 * The computed `data-*` attributes (and `style`) for a slide. `count` is the
 * number of columns for `columns`; `bg` must already be rewritten.
 */
export function computeAttrs(
  layout: LayoutName,
  a: Analysis,
  options: SlideOptions,
  count: number,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (layout === 'split') {
    const firstIsMedia = a.blocks[0] !== undefined && mediaCount(a.blocks[0]) > 0;
    attrs['data-image'] = options.image ?? (firstIsMedia ? 'left' : 'right');
  }
  if (layout === 'statement') {
    const p = a.blocks.find((b) => b.type === 'paragraph');
    attrs['data-len'] = lenClass(p ? toString(p).trim().length : 0);
  }
  if (layout === 'quote') {
    const quote = a.blocks.find((b) => b.type === 'blockquote');
    if (quote) attrs['data-len'] = quoteChars(quote) > 140 ? 'l' : 'm';
  }
  if (layout === 'gallery') attrs['data-count'] = String(a.images);
  if (layout === 'columns') attrs['data-count'] = String(count);
  const fit = options.fit ?? DEFAULT_FIT[layout];
  if (fit && (layout === 'image' || layout === 'split' || layout === 'figure')) attrs['data-imgfit'] = fit;
  if (options.align) attrs['data-align'] = options.align;
  return attrs;
}
