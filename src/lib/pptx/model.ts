// The plain-data description of a deck to write as a .pptx (§9 Phase 11).
// Types only, and no DOM types: this is the contract between collect.ts (DOM →
// model) and write.ts (model → bytes). Positions and lengths are stage logical
// pixels; colours are `RRGGBB`.

export interface PptxDeck {
  title: string;
  author?: string;
  lang: string;
  /** Stage size: 1600, 1440 or 1200 by 900. */
  w: number;
  h: number;
  /** For the file's theme part, read from tokens.css at export time. */
  palette: PptxPalette;
  slides: PptxSlide[];
}

export interface PptxPalette {
  bg: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  red: string;
  blue: string;
  marker: string;
}

export interface PptxSlide {
  bg: string;
  /** In paint order: later items are drawn over earlier ones. */
  items: PptxItem[];
  /** Speaker notes as plain-text paragraphs; empty when the slide has none. */
  notes: string[];
}

/** `alpha` is 0–1 and defaults to 1. */
export interface PptxFill {
  color: string;
  alpha?: number;
}

export interface PptxStroke extends PptxFill {
  width: number;
}

export type PptxItem =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: PptxFill; line?: PptxStroke }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; line: PptxStroke; cap: 'flat' | 'round'; arrow?: boolean }
  /** A closed polygon. */
  | { kind: 'path'; points: [number, number][]; fill: PptxFill }
  /** `key` names the stored bytes: two pictures with the same key share one media part. */
  | { kind: 'picture'; x: number; y: number; w: number; h: number; key: string; type: 'png' | 'jpeg'; data: Uint8Array; alt: string }
  /** `inset` is the padding on all four sides (default 0); a `fill` makes it a filled box. */
  | { kind: 'text'; x: number; y: number; w: number; h: number; wrap: boolean; paragraphs: PptxParagraph[]; fill?: PptxFill; inset?: number }
  | { kind: 'table'; x: number; y: number; w: number; h: number; columns: number[]; rows: PptxRow[] };

export interface PptxParagraph {
  runs: PptxRun[];
  align: 'l' | 'ctr' | 'r';
  /** Exact line pitch. */
  lineHeight: number;
  spaceBefore?: number;
  /** Left edge of the text; with a negative `indent` the first line hangs to its left. */
  marginLeft?: number;
  indent?: number;
  /** A left tab stop, measured from the box's left edge. */
  tab?: number;
}

export type PptxRun =
  | { break: true }
  | {
      text: string;
      font: string;
      size: number;
      bold: boolean;
      italic: boolean;
      color: PptxFill;
      /** Letter-spacing. */
      spacing?: number;
      underline?: boolean;
      strike?: boolean;
      superscript?: boolean;
      /** An opaque colour behind the text. */
      highlight?: string;
    };

export interface PptxRow {
  h: number;
  cells: PptxCell[];
}

export interface PptxCell {
  paragraphs: PptxParagraph[];
  padding: [l: number, t: number, r: number, b: number];
  anchor: 't' | 'ctr' | 'b';
  borderBottom?: PptxStroke;
  fill?: string;
}
