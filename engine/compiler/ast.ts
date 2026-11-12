// Syntax-tree types for the compiler.
//
// `@types/mdast` and `@types/hast` are only transitive dependencies (pnpm does
// not hoist them), so `import type … from 'mdast'` does not resolve. The mdast
// types are derived from the parser's own signature instead; hast is small
// enough to describe structurally.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

/** The parser used for slide bodies and notes: CommonMark + GFM. */
export function markdownParser() {
  return unified().use(remarkParse).use(remarkGfm);
}

export type MdRoot = ReturnType<ReturnType<typeof markdownParser>['parse']>;
export type MdBlock = MdRoot['children'][number];
export type MdNodeOf<T extends MdBlock['type']> = Extract<MdBlock, { type: T }>;
export type MdParagraph = MdNodeOf<'paragraph'>;
export type MdHeading = MdNodeOf<'heading'>;
export type MdList = MdNodeOf<'list'>;
export type MdHtml = MdNodeOf<'html'>;
export type MdBlockquote = MdNodeOf<'blockquote'>;
export type MdPhrasing = MdParagraph['children'][number];

export interface NodeData {
  hName?: string;
  hProperties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A custom mdast parent; `remark-rehype` turns it into `data.hName`. */
export interface DexRegion {
  type: 'dexRegion';
  data: { hName: string; hProperties: Record<string, unknown> };
  children: MdBlock[];
}

/** Read or create `node.data.hProperties`. */
export function hProps(node: { data?: unknown }): Record<string, unknown> {
  const n = node as { data?: NodeData };
  n.data ??= {};
  n.data.hProperties ??= {};
  return n.data.hProperties;
}

export function region(className: string | null, children: MdBlock[], tagName = 'div'): MdBlock {
  const node: DexRegion = {
    type: 'dexRegion',
    data: { hName: tagName, hProperties: className ? { className: [className] } : {} },
    children,
  };
  return node as unknown as MdBlock;
}

// hast, structurally.
export interface HText { type: 'text'; value: string }
export interface HElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HNode[];
}
export interface HOther { type: 'comment' | 'doctype' | 'raw'; value?: string }
export type HNode = HElement | HText | HOther;
export interface HRoot { type: 'root'; children: HNode[] }
export type HParent = HRoot | HElement;
