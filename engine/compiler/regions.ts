import { toString } from 'mdast-util-to-string';
import type { LayoutName } from '../../shared/types.ts';
import { hProps, region, type MdBlock, type MdBlockquote, type MdParagraph, type MdPhrasing, type MdRoot } from './ast.ts';
import { analyze, isHeading, mediaCount } from './layout.ts';

const ATTRIB = /^\s*(—|--)\s*/;

/**
 * If the blockquote's last line starts with `—` or `--`, make it a paragraph
 * of its own with class `attrib`, without the dashes.
 */
export function markAttribution(quote: MdBlockquote): void {
  const last = quote.children[quote.children.length - 1];
  if (!last || last.type !== 'paragraph') return;

  let para: MdParagraph = last;
  // The attribution may be the last line of the quote's last paragraph.
  if (!ATTRIB.test(toString(para))) {
    const kids = para.children;
    let split = -1;
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i]!;
      if (k.type === 'text' && k.value.includes('\n')) { split = i; break; }
      if (k.type === 'break') { split = i; break; }
    }
    if (split === -1) return;
    const at = kids[split]!;
    let tail: MdPhrasing[];
    let head: MdPhrasing[];
    if (at.type === 'text') {
      const cut = at.value.lastIndexOf('\n');
      const before = at.value.slice(0, cut);
      const after = at.value.slice(cut + 1);
      head = [...kids.slice(0, split), ...(before ? [{ ...at, value: before }] : [])];
      tail = [...(after ? [{ ...at, value: after }] : []), ...kids.slice(split + 1)];
    } else {
      head = kids.slice(0, split);
      tail = kids.slice(split + 1);
    }
    const tailPara: MdParagraph = { type: 'paragraph', children: tail };
    if (!ATTRIB.test(toString(tailPara)) || head.length === 0) return;
    para.children = head;
    para = tailPara;
    quote.children.push(para);
  }

  const first = para.children[0];
  if (first && first.type === 'text') {
    first.value = first.value.replace(ATTRIB, '');
    if (first.value === '') para.children.shift();
  }
  hProps(para).className = ['attrib'];
}

const MEDIA_LAYOUTS: LayoutName[] = ['image', 'figure', 'split', 'gallery'];

/**
 * Regroup the root's children into the wrappers of the HTML contract
 * (PLAN.md §6). `breaks` are the `|||` positions from `extractMarkers`.
 * Returns the number of columns (0 unless the layout is `columns`).
 */
export function applyRegions(root: MdRoot, layout: LayoutName, breaks: number[]): number {
  const all = root.children;
  const defs: MdBlock[] = all.filter((n) => n.type === 'definition' || n.type === 'footnoteDefinition');
  const content = all.filter((n) => !defs.includes(n));

  if (layout === 'full') {
    root.children = [region('s-main', content), ...defs];
    return 0;
  }

  const a = analyze(all);
  const firstHeading = a.blocks.find(isHeading);
  const headHeading = firstHeading && firstHeading.depth <= 2 ? firstHeading : null;
  const headBlocks = [a.eyebrow, headHeading].filter((n): n is NonNullable<typeof n> => n !== null);
  const rest = a.blocks.filter((b) => b !== headHeading);

  const header = headBlocks.length ? region('s-head', headBlocks, 'header') : null;
  const body = (blocks: MdBlock[]) => (blocks.length ? region('s-body', blocks) : null);
  const main = (...inner: (MdBlock | null)[]) => region('s-main', [header, ...inner].filter((n) => n !== null));

  const out: MdBlock[] = [];
  let count = 0;

  if (layout === 'columns') {
    let lede: MdBlock[] = [];
    let cols: MdBlock[][];
    if (breaks.length > 0) {
      cols = [];
      for (const b of rest) {
        const seg = breaks.filter((at) => all.indexOf(b) >= at).length;
        (cols[seg] ??= []).push(b);
      }
      cols = cols.filter((c) => c && c.length > 0);
    } else {
      const firstH3 = rest.findIndex((b) => b.type === 'heading' && b.depth === 3);
      if (firstH3 === -1) {
        cols = rest.length ? [rest] : [];
      } else {
        lede = rest.slice(0, firstH3);
        cols = [];
        for (const b of rest.slice(firstH3)) {
          if (b.type === 'heading' && b.depth === 3) cols.push([b]);
          else cols[cols.length - 1]!.push(b);
        }
      }
    }
    count = cols.length;
    out.push(
      main(
        lede.length ? region('s-lede', lede) : null,
        region('s-cols', cols.map((c) => region('s-col', c, 'section'))),
      ),
    );
  } else if (MEDIA_LAYOUTS.includes(layout)) {
    const media = layout === 'split' ? rest.filter((b) => mediaCount(b) > 0).slice(0, 1) : rest.filter((b) => mediaCount(b) > 0);
    const text = rest.filter((b) => !media.includes(b));
    if (header || text.length || layout === 'split') out.push(main(body(text)));
    if (media.length) out.push(region('s-media', media));
  } else {
    if (layout === 'quote') {
      for (const b of rest) if (b.type === 'blockquote') markAttribution(b);
    }
    out.push(main(body(rest)));
  }

  root.children = [...out, ...defs];
  return count;
}
