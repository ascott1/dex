// DOM → model (§9 Phase 11 tasks 3–5). The only file in this folder that
// touches the DOM. It measures the print view: every `.print-page` is a slide
// laid out at stage coordinates with all builds revealed, and each box in it
// becomes an item in the same place.
//
// Two kinds of numbers come out of the DOM. A position from a client rect is
// on screen, so it is taken relative to the page and divided by the page's
// on-screen scale. A length from a computed style (font size, line height,
// padding, border width, letter-spacing) is already in stage pixels.
//
// The rules are about elements, not layouts, so raw HTML and the `full` layout
// come through the same way as everything else.

import type { Marks, NoteColor, PenColor, Slide, SlideMarks } from '$shared/types';
import { MARKER_OPACITY, boxRect, freehandOutline } from '../strokes';
import type { PptxCell, PptxDeck, PptxFill, PptxItem, PptxPalette, PptxParagraph, PptxRow, PptxRun, PptxSlide } from './model';

type TextRun = Exclude<PptxRun, { break: true }>;

export interface CollectInput {
  /** The print view. Every `.print-page` inside it becomes a slide, in order. */
  root: HTMLElement;
  title: string;
  author?: string;
  lang: string;
  /** The deck's stage size, used when there is no page to measure. */
  size: { W: number; H: number };
  /** The deck's slides, for their speaker notes (matched by id). */
  slides: readonly Slide[];
  /** The deck's marks, or null to leave them out. */
  marks: Marks | null;
}

// ── Colours ─────────────────────────────────────────────────────────────────

interface Rgba {
  color: string;   // RRGGBB
  alpha: number;   // 0–1
}


const hex2 = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
const rgbHex = (r: number, g: number, b: number): string => hex2(r) + hex2(g) + hex2(b);
const unit = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1);

// What an unreadable or fully transparent colour parses to. Callers test `alpha`.
const TRANSPARENT: Rgba = { color: rgbHex(0, 0, 0), alpha: 0 };

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour → `RRGGBB` plus alpha. Computed colours are `rgb()`, `rgba()` or `color(srgb …)`; tokens are hex. */
export function parseColor(css: string): Rgba {
  const value = css.trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'none') return TRANSPARENT;

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 6 || h.length === 8) {
      return { color: h.slice(0, 6).toUpperCase(), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
  }

  const fn = /^(rgba?|color)\(([^()]+)\)$/.exec(value);
  if (fn) {
    const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
    const srgb = fn[1] === 'color' && parts[0] === 'srgb';
    if (srgb) parts.shift();
    const channel = (p: string): number => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : srgb ? parseFloat(p) * 255 : parseFloat(p));
    const [r, g, b] = parts.slice(0, 3).map(channel);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (parts.length >= 3 && [r, g, b].every((n) => Number.isFinite(n)) && (srgb || fn[1] !== 'color')) {
      return { color: rgbHex(r!, g!, b!), alpha: unit(a) };
    }
  }

  // Anything else (a named colour, hsl(), a wider gamut): let a canvas resolve it.
  if (typeof CSS === 'undefined' || !CSS.supports('color', value)) return TRANSPARENT;
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return TRANSPARENT;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return a ? { color: rgbHex(r!, g!, b!), alpha: a / 255 } : TRANSPARENT;
}

/** A translucent colour flattened onto an opaque one. */
function over(top: Rgba, bottom: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return rgbHex(
    ...([0, 2, 4].map((i) => channel(top.color, i) * top.alpha + channel(bottom, i) * (1 - top.alpha)) as [number, number, number]),
  );
}

/** A colour with the inherited opacity folded in; `alpha` is left out when it is 1. */
function fillOf(c: Rgba, opacity = 1): PptxFill {
  const alpha = c.alpha * opacity;
  return alpha < 0.999 ? { color: c.color, alpha: Math.round(alpha * 1000) / 1000 } : { color: c.color };
}

/** Reads colour tokens (`--red`, …) from an element's computed style. */
function tokenReader(el: Element): (name: string) => Rgba {
  const cs = getComputedStyle(el);
  const seen = new Map<string, Rgba>();
  return (name) => {
    let c = seen.get(name);
    if (!c) seen.set(name, (c = parseColor(cs.getPropertyValue(name))));
    return c;
  };
}

function readPalette(el: Element): PptxPalette {
  const token = tokenReader(el);
  const bg = token('--bg').color;
  const solid = (name: string) => over(token(name), bg);
  return {
    bg,
    ink: solid('--ink'),
    ink2: solid('--ink-2'),
    ink3: solid('--ink-3'),
    line: solid('--line'),
    red: solid('--red'),
    blue: solid('--blue'),
    marker: solid('--marker'),
  };
}

// ── Small readers ───────────────────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A computed length in pixels; `normal`, `auto` and `none` are 0. */
const px = (value: string): number => parseFloat(value) || 0;

function opacityOf(cs: CSSStyleDeclaration): number {
  const o = parseFloat(cs.opacity);
  return Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 1;
}

function hidden(el: Element, cs: CSSStyleDeclaration): boolean {
  return cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || el.classList.contains('sr-only');
}

const lineHeightOf = (cs: CSSStyleDeclaration): number => px(cs.lineHeight) || px(cs.fontSize) * 1.2;

const alignOf = (cs: CSSStyleDeclaration): PptxParagraph['align'] =>
  cs.textAlign === 'center' ? 'ctr' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'r' : 'l';

const fontOf = (cs: CSSStyleDeclaration): string => (/mono/i.test(cs.fontFamily.split(',')[0] ?? '') ? 'DM Mono' : 'DM Sans');

function contentBox(cs: CSSStyleDeclaration, r: Box): Box {
  const left = px(cs.borderLeftWidth) + px(cs.paddingLeft);
  const top = px(cs.borderTopWidth) + px(cs.paddingTop);
  return {
    x: r.x + left,
    y: r.y + top,
    w: r.w - left - px(cs.borderRightWidth) - px(cs.paddingRight),
    h: r.h - top - px(cs.borderBottomWidth) - px(cs.paddingBottom),
  };
}

const INLINE = /^(inline|inline-block|contents)$/;
// Elements that are drawn, not read: never part of a run of text.
const REPLACED = /^(IMG|VIDEO|IFRAME|CANVAS|OBJECT|EMBED|AUDIO|TABLE|UL|OL|PRE|HR)$/;

const isInline = (el: Element, cs: CSSStyleDeclaration): boolean =>
  el instanceof HTMLElement && INLINE.test(cs.display) && !REPLACED.test(el.tagName);

/** True when everything inside `el` is inline (hidden things aside); with `lists`, simple nested lists are allowed too. */
function inlineOnly(el: Element, lists: boolean): boolean {
  for (const child of el.children) {
    const cs = getComputedStyle(child);
    if (hidden(child, cs) || child.tagName === 'BR') continue;
    if (lists && (child.tagName === 'UL' || child.tagName === 'OL')) {
      if (!isSimpleList(child)) return false;
      continue;
    }
    if (!isInline(child, cs) || !inlineOnly(child, false)) return false;
  }
  return true;
}

/** A list whose items hold only inline content and simple nested lists: it becomes one text box. */
function isSimpleList(list: Element): boolean {
  return [...list.children].every((li) => li.tagName === 'LI' && inlineOnly(li, true));
}

/** A plain grid of inline-only cells: it becomes a native table. */
function isSimpleTable(table: HTMLTableElement, cs: CSSStyleDeclaration): boolean {
  const rows = [...table.rows];
  const columns = rows[0]?.cells.length ?? 0;
  if (cs.display !== 'table' || table.caption || columns === 0) return false;
  return rows.every(
    (tr) => tr.cells.length === columns && [...tr.cells].every((cell) => cell.colSpan === 1 && cell.rowSpan === 1 && inlineOnly(cell, false)),
  );
}

/** A computed `content` value as text: its strings joined, with `counter()` replaced by `n`. */
function contentText(content: string, n?: number): string {
  let out = '';
  for (const m of content.matchAll(/"((?:[^"\\]|\\.)*)"|counter\(([^)]*)\)/g)) {
    if (m[1] !== undefined) out += m[1].replace(/\\(.)/g, '$1');
    else if (n !== undefined) out += m[2]!.includes('decimal-leading-zero') ? String(n).padStart(2, '0') : String(n);
  }
  return out;
}

const hasContent = (pseudo: CSSStyleDeclaration): boolean =>
  pseudo.display !== 'none' && pseudo.content !== '' && pseudo.content !== 'none' && pseudo.content !== 'normal';

// ── Text: runs ──────────────────────────────────────────────────────────────

type WhiteSpace = 'collapse' | 'preserve' | 'breaks';

interface RunStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: PptxFill;
  spacing: number;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  highlight?: string;
  transform: string;
  /** Two runs with the same key are set alike and can be joined. */
  key: string;
}

type Raw = { br: true } | { text: string; node: Text | null; style: RunStyle; ws: WhiteSpace };
type Part = { runs: Raw[] } | { block: Element };
type Piece = { br: true } | { text: string; style: RunStyle };

function styleFrom(cs: CSSStyleDeclaration, opacity: number): RunStyle {
  const style: RunStyle = {
    font: fontOf(cs),
    size: px(cs.fontSize),
    // 500 is DM Sans's medium, which reads as regular beside a real bold.
    bold: Number(cs.fontWeight) >= 600,
    italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
    color: fillOf(parseColor(cs.color), opacity),
    spacing: px(cs.letterSpacing),
    underline: false,
    strike: false,
    superscript: false,
    transform: cs.textTransform,
    key: '',
  };
  return style;
}

function withKey(style: RunStyle): RunStyle {
  style.key = '';
  style.key = JSON.stringify(style);
  return style;
}

function whiteSpaceOf(cs: CSSStyleDeclaration): WhiteSpace {
  const collapse = cs.whiteSpaceCollapse as string | undefined;
  if (collapse) return collapse === 'preserve' || collapse === 'break-spaces' ? 'preserve' : collapse === 'preserve-breaks' ? 'breaks' : 'collapse';
  return cs.whiteSpace === 'pre-line' ? 'breaks' : cs.whiteSpace.startsWith('pre') ? 'preserve' : 'collapse';
}

function toRun(text: string, style: RunStyle): TextRun {
  const cased = style.transform === 'uppercase' ? text.toUpperCase() : style.transform === 'lowercase' ? text.toLowerCase() : text;
  const run: TextRun = { text: cased, font: style.font, size: style.size, bold: style.bold, italic: style.italic, color: style.color };
  if (style.spacing) run.spacing = style.spacing;
  if (style.underline) run.underline = true;
  if (style.strike) run.strike = true;
  if (style.superscript) run.superscript = true;
  if (style.highlight) run.highlight = style.highlight;
  return run;
}

const hasText = (runs: Raw[]): boolean => runs.some((run) => !('br' in run) && /\S/.test(run.text));

/**
 * Raw runs → paragraphs of model runs. White space collapses as CSS does,
 * across run boundaries, with nothing leading or trailing; where it is
 * preserved (`pre`) it is kept and a tab becomes two spaces. A newline that
 * counts starts a new paragraph or is a break, as `newline` says. `breaks`
 * holds the places the browser wrapped (see `measure`), to be made explicit.
 */
function build(runs: Raw[], breaks: Set<string> | null, newline: 'paragraph' | 'break'): PptxRun[][] {
  const paragraphs: Piece[][] = [[]];
  const current = () => paragraphs[paragraphs.length - 1]!;
  // Nothing has been written on this line yet, so white space is dropped.
  let atStart = true;
  // The last thing written is a collapsible space, to take back if the line ends here.
  let trailing = false;

  const push = (text: string, style: RunStyle) => {
    if (!text) return;
    const list = current();
    const last = list[list.length - 1];
    if (last && !('br' in last) && last.style.key === style.key) last.text += text;
    else list.push({ text, style });
  };
  const trim = () => {
    if (!trailing) return;
    trailing = false;
    const list = current();
    const last = list[list.length - 1];
    if (!last || 'br' in last || !last.text.endsWith(' ')) return;
    last.text = last.text.slice(0, -1);
    if (!last.text) list.pop();
  };
  const endLine = (how: 'paragraph' | 'break') => {
    trim();
    if (how === 'paragraph') paragraphs.push([]);
    else current().push({ br: true });
    atStart = true;
  };

  runs.forEach((run, index) => {
    if ('br' in run) {
      endLine('break');
      return;
    }
    if (run.ws === 'preserve') {
      run.text
        .replace(/\r/g, '')
        .replace(/\t/g, '  ')
        .split('\n')
        .forEach((line, i) => {
          if (i > 0) endLine(newline);
          if (!line) return;
          push(line, run.style);
          atStart = false;
          trailing = false;
        });
      return;
    }
    let out = '';
    const flush = () => {
      push(out, run.style);
      out = '';
    };
    for (let i = 0; i < run.text.length; i++) {
      const ch = run.text[i]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
        if (ch === '\n' && run.ws === 'breaks') {
          flush();
          endLine(newline);
        } else if (!atStart && !trailing) {
          out += ' ';
          trailing = true;
        }
        continue;
      }
      if (breaks?.has(`${index}:${i}`) && !atStart) {
        flush();
        trim();
        current().push({ br: true });
      }
      out += ch;
      atStart = false;
      trailing = false;
    }
    flush();
  });
  trim();

  return paragraphs.map((pieces) => pieces.map((piece) => ('br' in piece ? { break: true } : toRun(piece.text, piece.style))));
}

interface Measure {
  /** Lines the browser made. 0 when the text has no boxes (it is not drawn). */
  lines: number;
  /** `run:char` of every word that starts a new line. */
  breaks: Set<string>;
  /** Client coordinates: the text's left and right edges, and the middle of its first line. */
  left: number;
  right: number;
  firstMid: number;
}

/** Where the browser put the text: a `Range` per word, comparing tops. */
function measure(runs: Raw[]): Measure {
  const out: Measure = { lines: 0, breaks: new Set(), left: Infinity, right: -Infinity, firstMid: 0 };
  const range = document.createRange();
  let line: { top: number; bottom: number } | null = null;
  runs.forEach((run, index) => {
    if ('br' in run || !run.node) return;
    for (const word of run.text.matchAll(/\S+/g)) {
      const at = word.index ?? 0;
      range.setStart(run.node, at);
      range.setEnd(run.node, at + word[0].length);
      let first = true;
      for (const rect of range.getClientRects()) {
        if (rect.width === 0 && rect.height === 0) continue;
        const mid = (rect.top + rect.bottom) / 2;
        if (!line) {
          line = { top: rect.top, bottom: rect.bottom };
          out.lines = 1;
          out.firstMid = mid;
        } else if (mid > line.bottom - 1) {
          line = { top: rect.top, bottom: rect.bottom };
          out.lines++;
          // A word broken in the middle is a new line but not a place to break.
          if (first) out.breaks.add(`${index}:${at}`);
        } else {
          line.top = Math.min(line.top, rect.top);
          line.bottom = Math.max(line.bottom, rect.bottom);
        }
        out.left = Math.min(out.left, rect.left);
        out.right = Math.max(out.right, rect.right);
        first = false;
      }
    }
  });
  return out;
}

// ── Speaker notes ───────────────────────────────────────────────────────────

const NOTE_BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|SECTION|DL|DT|DD|HR)$/;

/** `Slide.notes` (HTML) → one plain-text paragraph per block; a list item gets a leading `• `. */
export function notesParagraphs(html: string): string[] {
  if (!html.trim()) return [];
  // DOMParser documents are inert: nothing in them loads or runs.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  const visit = (node: Node, prefix: string) => {
    let lead = prefix;
    let buffer = '';
    const flush = () => {
      const text = buffer.replace(/\s+/g, ' ').trim();
      buffer = '';
      if (!text) return;
      out.push(lead + text);
      lead = '';
    };
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) buffer += (child as Text).data;
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (el.tagName === 'BR') {
        flush();
      } else if (el.tagName === 'PRE') {
        flush();
        for (const line of (el.textContent ?? '').split('\n')) if (line.trim()) out.push(line.replace(/\s+$/, ''));
      } else if (NOTE_BLOCK.test(el.tagName)) {
        flush();
        visit(el, el.tagName === 'LI' ? '• ' : lead);
        lead = '';
      } else {
        buffer += el.textContent ?? '';
      }
    }
    flush();
  };
  visit(doc.body, '');
  return out;
}

// ── Marks ───────────────────────────────────────────────────────────────────

const PEN_TOKEN: Record<PenColor, string> = { ink: '--ink', red: '--red', blue: '--blue' };
const NOTE_TOKEN: Record<NoteColor, string> = { yellow: '--note-yellow', pink: '--note-pink', blue: '--note-blue' };
// StickyNote.svelte: 16 of padding, DM Sans 22 on a 1.3 line.
const NOTE_INSET = 16;
const NOTE_SIZE = 22;
const NOTE_LINE = NOTE_SIZE * 1.3;

/** A slide's drawings and sticky notes, from the marks data: strokes first, then notes. */
function markItems(marks: SlideMarks | undefined, page: HTMLElement): PptxItem[] {
  if (!marks) return [];
  const token = tokenReader(page);
  const theme = page.dataset.theme === 'ink' ? 'ink' : 'paper';
  const items: PptxItem[] = [];

  for (const stroke of marks.strokes) {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    if (!first || !last) continue;
    const colour = token(PEN_TOKEN[stroke.color] ?? PEN_TOKEN.ink);
    if (stroke.tool === 'arrow') {
      items.push({ kind: 'line', x1: first[0], y1: first[1], x2: last[0], y2: last[1], line: { ...fillOf(colour), width: stroke.size }, cap: 'round', arrow: true });
    } else if (stroke.tool === 'box') {
      const r = boxRect(stroke);
      items.push({ kind: 'rect', x: r.x, y: r.y, w: r.width, h: r.height, line: { ...fillOf(colour), width: stroke.size } });
    } else {
      const points = freehandOutline(stroke).map((p) => [p[0]!, p[1]!] as [number, number]);
      if (points.length < 3) continue;
      // No blend modes in a .pptx: the marker is its colour at DrawLayer's opacity.
      const fill = stroke.tool === 'marker' ? fillOf(token('--marker'), MARKER_OPACITY[theme]) : fillOf(colour);
      items.push({ kind: 'path', points, fill });
    }
  }

  for (const note of marks.notes) {
    const ink = fillOf(token('--note-ink'));
    const paragraphs: PptxParagraph[] = note.text.split('\n').map((line) => ({
      runs: line ? [{ text: line, font: 'DM Sans', size: NOTE_SIZE, bold: false, italic: false, color: ink }] : [],
      align: 'l',
      lineHeight: NOTE_LINE,
    }));
    // The note grows with its text; `h` is only its least height. The print
    // view has it laid out, so its real height is read there when it is shown.
    const el = [...page.querySelectorAll<HTMLElement>('.sticky')].find((sticky) => sticky.dataset.note === note.id);
    const h = Math.max(note.h, el?.offsetHeight ?? 0, 2 * NOTE_INSET + paragraphs.length * NOTE_LINE);
    items.push({ kind: 'text', x: note.x, y: note.y, w: note.w, h, wrap: true, paragraphs, fill: fillOf(token(NOTE_TOKEN[note.color] ?? NOTE_TOKEN.yellow)), inset: NOTE_INSET });
  }
  return items;
}

// ── Pictures ────────────────────────────────────────────────────────────────

interface Stored {
  type: 'png' | 'jpeg';
  data: Uint8Array;
}

const PICTURE_SCALE = 2;
const PICTURE_MAX = 4096;

const isJpeg = (src: string): boolean => /^data:image\/jpe?g[;,]/i.test(src) || /\.jpe?g(?:[?#]|$)/i.test(src);

function encode(canvas: HTMLCanvasElement, type: 'png' | 'jpeg'): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      // Throws when a cross-origin image has tainted the canvas.
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error('the canvas could not be encoded'));
          else blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
        },
        type === 'jpeg' ? 'image/jpeg' : 'image/png',
        0.92,
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

/** The last segment of a URL's path, as a label for something that cannot be shown. */
function fileName(src: string): string {
  if (src.startsWith('data:')) return 'data';
  const path = src.split(/[?#]/)[0] ?? '';
  const name = path.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** One length of `object-position`: a share of the free space, or an offset. */
function positionOffset(token: string | undefined, free: number): number {
  if (!token) return free / 2;
  if (token.endsWith('%')) return (free * parseFloat(token)) / 100;
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : free / 2;
}

// ── One page ────────────────────────────────────────────────────────────────

async function collectPage(page: HTMLElement, pictures: Map<string, Stored>): Promise<PptxSlide> {
  const W = page.offsetWidth;
  const H = page.offsetHeight;
  const origin = page.getBoundingClientRect();
  // The page is scaled to fit the window; W is its width in stage pixels.
  const k = origin.width / W || 1;
  const rel = (r: { left: number; top: number; width: number; height: number }): Box => ({
    x: (r.left - origin.left) / k,
    y: (r.top - origin.top) / k,
    w: r.width / k,
    h: r.height / k,
  });
  const token = tokenReader(page);
  const items: PptxItem[] = [];

  const pageBg = parseColor(getComputedStyle(page).backgroundColor);
  const slideEl = page.querySelector<HTMLElement>(':scope > .slide');
  if (!slideEl) return { bg: pageBg.color, items, notes: [] };
  const slideBg = parseColor(getComputedStyle(slideEl).backgroundColor);
  const bg = over(slideBg, pageBg.color);

  // ── Boxes: backgrounds and borders ──

  function decorate(cs: CSSStyleDeclaration, r: Box, opacity: number, root: boolean): void {
    if (r.w <= 0 && r.h <= 0) return;
    // The slide's own colour is the slide background.
    const fill = root ? TRANSPARENT : parseColor(cs.backgroundColor);
    const side = (width: string, style: string, color: string) => {
      const w = style === 'none' || style === 'hidden' ? 0 : px(width);
      const c = parseColor(color);
      return { w: c.alpha > 0 ? w : 0, c };
    };
    const top = side(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);
    const right = side(cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor);
    const bottom = side(cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor);
    const left = side(cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor);
    const sides = [top, right, bottom, left];
    const same = sides.every((s) => s.w > 0 && s.w === top.w && s.c.color === top.c.color && s.c.alpha === top.c.alpha);

    if (same && r.w > top.w && r.h > top.w) {
      // One outlined rectangle. A viewer centres a line on the edge, so the
      // rectangle is inset by half the border.
      const w = top.w;
      items.push({
        kind: 'rect',
        x: r.x + w / 2,
        y: r.y + w / 2,
        w: r.w - w,
        h: r.h - w,
        ...(fill.alpha > 0 ? { fill: fillOf(fill, opacity) } : {}),
        line: { ...fillOf(top.c, opacity), width: w },
      });
      return;
    }
    if (fill.alpha > 0 && r.w > 0 && r.h > 0) items.push({ kind: 'rect', ...r, fill: fillOf(fill, opacity) });
    // Otherwise a line per side, centred on the border. Never a thin filled
    // rectangle: Quick Look does not draw one a pixel high.
    const line = (s: { w: number; c: Rgba }, x1: number, y1: number, x2: number, y2: number) => {
      if (s.w > 0) items.push({ kind: 'line', x1, y1, x2, y2, line: { ...fillOf(s.c, opacity), width: s.w }, cap: 'flat' });
    };
    line(top, r.x, r.y + top.w / 2, r.x + r.w, r.y + top.w / 2);
    line(bottom, r.x, r.y + r.h - bottom.w / 2, r.x + r.w, r.y + r.h - bottom.w / 2);
    line(left, r.x + left.w / 2, r.y, r.x + left.w / 2, r.y + r.h);
    line(right, r.x + r.w - right.w / 2, r.y, r.x + r.w - right.w / 2, r.y + r.h);
  }

  // ── Text ──

  /** The style of the text held directly by `el`, inside the block `block`. */
  function runStyle(el: Element, block: Element, opacity: number): RunStyle {
    const cs = getComputedStyle(el);
    const style = styleFrom(cs, opacity);
    for (let n: Element | null = el; n; n = n.parentElement) {
      const s = n === el ? cs : getComputedStyle(n);
      if (s.textDecorationLine.includes('underline')) style.underline = true;
      if (s.textDecorationLine.includes('line-through')) style.strike = true;
      if (n === block) break;
      // A background on an inline ancestor (mark, inline code) is a highlight,
      // flattened onto the slide's colour because a highlight has no alpha.
      if (!style.highlight && s.display === 'inline') {
        const back = parseColor(s.backgroundColor);
        if (back.alpha > 0) style.highlight = over(back, bg);
      }
      // Viewers shrink a superscript themselves: give it its parent's size.
      if (n.tagName === 'SUP' && n.parentElement) {
        style.superscript = true;
        style.size = px(getComputedStyle(n.parentElement).fontSize);
      }
    }
    return withKey(style);
  }

  /**
   * What a block holds, in order: runs of inline content, and the block-level
   * children that are walked on their own. An inline-block with a background
   * (a highlighted code line) is drawn here as a rectangle, under the text.
   */
  function gather(block: Element, opacity: number): Part[] {
    const parts: Part[] = [];
    let open: Raw[] | null = null;
    const runs = (): Raw[] => {
      if (!open) parts.push({ runs: (open = []) });
      return open;
    };
    const visit = (parent: Element, op: number) => {
      let style: RunStyle | null = null;
      let ws: WhiteSpace = 'collapse';
      const styled = () => {
        if (!style) {
          style = runStyle(parent, block, op);
          ws = whiteSpaceOf(getComputedStyle(parent));
        }
        return style;
      };
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = (child as Text).data;
          if (text) runs().push({ text, node: child as Text, style: styled(), ws });
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const el = child as Element;
        const cs = getComputedStyle(el);
        if (hidden(el, cs)) continue;
        if (el.tagName === 'BR') {
          runs().push({ br: true });
        } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
          // A task-list box: its state is content, so it is written as a character.
          runs().push({ text: el.checked ? '☑ ' : '☐ ', node: null, style: styled(), ws: 'preserve' });
        } else if (isInline(el, cs)) {
          const inner = op * opacityOf(cs);
          if (inner <= 0) continue;
          if (cs.display === 'inline-block') {
            const back = parseColor(cs.backgroundColor);
            const r = rel(el.getBoundingClientRect());
            if (back.alpha > 0 && r.w > 0 && r.h > 0) items.push({ kind: 'rect', ...r, fill: fillOf(back, inner) });
          }
          visit(el, inner);
        } else {
          parts.push({ block: el });
          open = null;
        }
      }
    };
    visit(block, opacity);
    return parts;
  }

  /** One run of inline content as a text box. Returns false when it holds nothing that is drawn. */
  function textBox(cs: CSSStyleDeclaration, r: Box, raw: Raw[], first: boolean): boolean {
    if (!hasText(raw)) return false;
    const m = measure(raw);
    if (m.lines === 0) return false;
    // PowerPoint cannot balance lines. Where the browser did, its breaks were
    // chosen, so they are kept and the box does not wrap.
    const balanced = m.lines > 1 && (cs.textWrapStyle === 'balance' || cs.textWrap.includes('balance'));
    const runs = build(raw, balanced ? m.breaks : null, 'break')[0]!;
    const lineHeight = lineHeightOf(cs);

    let box = contentBox(cs, r);
    // In a flex or grid box the text is an item placed by the container, and
    // after a block child or in a cell that is not top-aligned it does not
    // start at the top of the content box: put the box where the lines are.
    const placed = /flex|grid/.test(cs.display);
    const top = (m.firstMid - origin.top) / k - lineHeight / 2;
    if (placed) box = { x: (m.left - origin.left) / k, y: top, w: (m.right - m.left) / k, h: m.lines * lineHeight };
    else if (!first || box.w <= 0 || (cs.display === 'table-cell' && Math.abs(top - box.y) > 1)) box = { ...box, y: top, h: m.lines * lineHeight };

    items.push({
      kind: 'text',
      ...box,
      // One line never wraps, so a wider substitute font cannot push a title
      // onto a second line. Several unbalanced lines reflow at the box's width.
      wrap: m.lines > 1 && !balanced,
      paragraphs: [{ runs, align: alignOf(cs), lineHeight }],
    });
    return true;
  }

  /** A `pre`: its box, then one paragraph per line, never wrapped. Returns its block children. */
  function preBox(el: Element, cs: CSSStyleDeclaration, r: Box, opacity: number): Element[] {
    decorate(cs, r, opacity, false);
    const parts = gather(el, opacity);
    const raw = parts.flatMap((part) => ('runs' in part ? part.runs : []));
    const lines = build(raw, null, 'paragraph');
    while (lines.length > 1 && lines[lines.length - 1]!.length === 0) lines.pop();
    if (lines.some((line) => line.length > 0)) {
      const lineHeight = lineHeightOf(cs);
      items.push({ kind: 'text', ...contentBox(cs, r), wrap: false, paragraphs: lines.map((runs) => ({ runs, align: 'l', lineHeight })) });
    }
    return parts.flatMap((part) => ('block' in part ? [part.block] : []));
  }

  // ── Lists ──

  /** A list item's number: its place among the items, from the list's `start`. */
  function itemNumber(li: Element): number {
    const list = li.parentElement;
    const start = list instanceof HTMLOListElement ? list.start : 1;
    let n = start;
    for (const sibling of list?.children ?? []) {
      if (sibling === li) break;
      if (sibling.tagName === 'LI') n++;
    }
    return n;
  }

  /**
   * The marker the CSS draws with `li::before`: the square bullet (an empty
   * box with a background), a dash (its `content`), or a number (a counter).
   */
  function markerOf(li: Element, ls: CSSStyleDeclaration, opacity: number): { square: Rgba | null; run: TextRun | null; before: CSSStyleDeclaration } {
    const before = getComputedStyle(li, '::before');
    if (!hasContent(before)) return { square: null, run: null, before };
    const text = contentText(before.content, itemNumber(li));
    const back = parseColor(before.backgroundColor);
    if (!text) {
      if (back.alpha === 0) return { square: null, run: null, before };
      // DM Sans has no square; Arial does. The one place a third font is named.
      return { square: back, run: { text: '▪', font: 'Arial', size: px(ls.fontSize), bold: false, italic: false, color: fillOf(back, opacity) }, before };
    }
    return { square: null, run: toRun(text, styleFrom(before, opacity)), before };
  }

  /** A simple list as one text box: a paragraph per item, nested items included. */
  function listBox(list: Element, cs: CSSStyleDeclaration, r: Box, opacity: number): void {
    decorate(cs, r, opacity, false);
    const box = contentBox(cs, r);
    const paragraphs: PptxParagraph[] = [];
    let bottom = box.y;

    const add = (ul: Element, inherited: number) => {
      for (const li of ul.children) {
        const ls = getComputedStyle(li);
        const op = inherited * opacityOf(ls);
        if (hidden(li, ls) || op <= 0) continue;
        const content = contentBox(ls, rel(li.getBoundingClientRect()));
        const lineHeight = lineHeightOf(ls);
        const hang = px(ls.paddingLeft);
        const marginLeft = Math.max(0, content.x - box.x);
        const marker = markerOf(li, ls, op).run;
        // The marker is typed, followed by a tab to the text's edge: native
        // bullets land outside the box in Quick Look (§2).
        const lead: PptxRun[] = marker ? [{ ...marker, text: marker.text + (hang > 0 ? '\t' : ' ') }] : [];
        let first = true;
        const paragraph = (runs: PptxRun[], top: number, lines: number) => {
          paragraphs.push({
            runs: first ? [...lead, ...runs] : runs,
            align: alignOf(ls),
            lineHeight,
            ...(top - bottom > 0.01 ? { spaceBefore: top - bottom } : {}),
            marginLeft,
            indent: -Math.min(hang, marginLeft),
            ...(hang > 0 ? { tab: marginLeft } : {}),
          });
          bottom = top + Math.max(1, lines) * lineHeight;
          first = false;
        };
        const nested: [Element, number][] = [];
        for (const part of gather(li, op)) {
          if ('block' in part) {
            const tag = part.block.tagName;
            if (tag === 'UL' || tag === 'OL') nested.push([part.block, op * opacityOf(getComputedStyle(part.block))]);
            continue;
          }
          if (!hasText(part.runs)) continue;
          const m = measure(part.runs);
          if (m.lines === 0) continue;
          // An item's own nested lists come after its text; flush them in order.
          for (const [inner, innerOp] of nested.splice(0)) add(inner, innerOp);
          const top = first ? content.y : (m.firstMid - origin.top) / k - lineHeight / 2;
          paragraph(build(part.runs, null, 'break')[0]!, top, m.lines);
        }
        // An item with nothing but a nested list still shows its marker.
        if (first && lead.length > 0) paragraph([], content.y, 1);
        for (const [inner, innerOp] of nested) add(inner, innerOp);
      }
    };
    add(list, opacity);
    if (paragraphs.length > 0) items.push({ kind: 'text', ...box, wrap: true, paragraphs });
  }

  /** In a list that is walked as ordinary blocks, an item's marker is drawn where the CSS put it. */
  function listMarker(li: Element, cs: CSSStyleDeclaration, r: Box, opacity: number): void {
    const { square, run, before } = markerOf(li, cs, opacity);
    if (square) {
      // Absolutely placed against the item's padding edge.
      const x = r.x + px(cs.borderLeftWidth) + px(before.left);
      const y = r.y + px(cs.borderTopWidth) + px(before.top);
      items.push({ kind: 'rect', x, y, w: px(before.width), h: px(before.height), fill: fillOf(square, opacity) });
    } else if (run) {
      const lineHeight = lineHeightOf(cs);
      const content = contentBox(cs, r);
      const hang = px(cs.paddingLeft);
      items.push({ kind: 'text', x: content.x - hang, y: content.y, w: hang, h: lineHeight, wrap: false, paragraphs: [{ runs: [run], align: 'l', lineHeight }] });
    }
  }

  // ── Tables ──

  function tableFrame(table: HTMLTableElement, r: Box, opacity: number): void {
    const rows: PptxRow[] = [];
    const columns: number[] = [];
    for (const tr of table.rows) {
      const rs = getComputedStyle(tr);
      const rowBack = parseColor(rs.backgroundColor);
      const cells: PptxCell[] = [];
      for (const td of tr.cells) {
        const cs = getComputedStyle(td);
        const op = opacity * opacityOf(rs) * opacityOf(cs);
        if (rows.length === 0) columns.push(rel(td.getBoundingClientRect()).w);
        const raw = gather(td, op).flatMap((part) => ('runs' in part ? part.runs : []));
        const back = parseColor(cs.backgroundColor);
        const fill = back.alpha > 0 ? back : rowBack;
        const rule = cs.borderBottomStyle === 'none' || cs.borderBottomStyle === 'hidden' ? 0 : px(cs.borderBottomWidth);
        const ruleColour = parseColor(cs.borderBottomColor);
        cells.push({
          paragraphs: [{ runs: build(raw, null, 'break')[0]!, align: alignOf(cs), lineHeight: lineHeightOf(cs) }],
          padding: [px(cs.paddingLeft), px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom)],
          anchor: cs.verticalAlign === 'bottom' ? 'b' : cs.verticalAlign === 'middle' ? 'ctr' : 't',
          ...(rule > 0 && ruleColour.alpha > 0 ? { borderBottom: { ...fillOf(ruleColour, op), width: rule } } : {}),
          ...(fill.alpha > 0 ? { fill: over({ color: fill.color, alpha: fill.alpha * op }, bg) } : {}),
        });
      }
      rows.push({ h: rel(tr.getBoundingClientRect()).h, cells });
    }
    items.push({ kind: 'table', ...r, columns, rows });
  }

  // ── Pictures ──

  /** A 1px `--line` frame with a label in it, as a missing image has: for what cannot be shown. */
  function placeholder(box: Box, label: string, opacity: number): void {
    if (box.w <= 1 || box.h <= 1) return;
    items.push({ kind: 'rect', x: box.x + 0.5, y: box.y + 0.5, w: box.w - 1, h: box.h - 1, line: { ...fillOf(token('--line'), opacity), width: 1 } });
    if (!label) return;
    const size = 13;
    const lineHeight = size * 1.3;
    items.push({
      kind: 'text',
      x: box.x,
      y: box.y + (box.h - lineHeight) / 2,
      w: box.w,
      h: lineHeight,
      wrap: false,
      paragraphs: [
        {
          runs: [{ text: label, font: 'DM Mono', size, bold: false, italic: false, color: fillOf(token('--ink-3'), opacity), spacing: size * 0.12 }],
          align: 'ctr',
          lineHeight,
        },
      ],
    });
  }

  /**
   * Draws part of an image through a canvas and adds it as a picture at `box`.
   * `crop` is in the image's own pixels; without one the whole image is drawn.
   * Returns false when the image cannot be read (cross-origin, or broken).
   */
  async function draw(
    img: HTMLImageElement,
    src: string,
    crop: { x: number; y: number; w: number; h: number } | null,
    box: Box,
    opts: { alt: string; opacity: number; scrim?: string },
  ): Promise<boolean> {
    if (box.w <= 0 || box.h <= 0) return true;
    // JPEG stays JPEG; anything else, and anything translucent, is PNG.
    const type: Stored['type'] = isJpeg(src) && opts.opacity >= 1 ? 'jpeg' : 'png';
    const scale = Math.min(PICTURE_SCALE, PICTURE_MAX / Math.max(box.w, box.h));
    const cw = Math.max(1, Math.round(box.w * scale));
    const ch = Math.max(1, Math.round(box.h * scale));
    const round = (n: number) => Math.round(n * 100) / 100;
    // The source plus the crop and size: a picture drawn the same way twice is stored once.
    const key = [src, crop ? [crop.x, crop.y, crop.w, crop.h].map(round).join(',') : 'all', `${cw}x${ch}`, type, opts.scrim ?? '', round(opts.opacity)].join('|');
    let stored = pictures.get(key);
    if (!stored) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        ctx.globalAlpha = opts.opacity;
        if (crop) ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
        else ctx.drawImage(img, 0, 0, cw, ch);
        if (opts.scrim) {
          ctx.fillStyle = opts.scrim;
          ctx.fillRect(0, 0, cw, ch);
        }
        stored = { type, data: await encode(canvas, type) };
      } catch (error) {
        console.warn(`dex: ${fileName(src) || 'a picture'} could not be read for the PowerPoint export`, error);
        return false;
      }
      pictures.set(key, stored);
    }
    items.push({ kind: 'picture', ...box, key, type: stored.type, data: stored.data, alt: opts.alt });
    return true;
  }

  /** An `img`, at the area the image actually covers given `object-fit` and `object-position`. */
  async function picture(img: HTMLImageElement, cs: CSSStyleDeclaration, r: Box, opacity: number): Promise<void> {
    decorate(cs, r, opacity, false);
    const box = contentBox(cs, r);
    if (box.w <= 0 || box.h <= 0) return;
    const src = img.currentSrc || img.src;
    const alt = img.alt;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    let ok: boolean;
    if (!nw || !nh) {
      // An SVG with no size of its own is drawn at its box.
      ok = await draw(img, src, null, box, { alt, opacity });
    } else {
      const fit = cs.objectFit;
      const contain = Math.min(box.w / nw, box.h / nh);
      const s = fit === 'cover' ? Math.max(box.w / nw, box.h / nh) : fit === 'contain' ? contain : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, contain) : 0;
      // The image as laid out in the box, before the box clips it.
      const dw = s ? nw * s : box.w;
      const dh = s ? nh * s : box.h;
      const [px0, py0] = cs.objectPosition.split(/\s+/);
      const dx = positionOffset(px0, box.w - dw);
      const dy = positionOffset(py0, box.h - dh);
      // What shows is where the two overlap: `cover` crops, `contain` shrinks the box.
      const x0 = Math.max(0, dx);
      const y0 = Math.max(0, dy);
      const x1 = Math.min(box.w, dx + dw);
      const y1 = Math.min(box.h, dy + dh);
      if (x1 <= x0 || y1 <= y0) return;
      const crop = { x: ((x0 - dx) / dw) * nw, y: ((y0 - dy) / dh) * nh, w: ((x1 - x0) / dw) * nw, h: ((y1 - y0) / dh) * nh };
      const whole = crop.x < 0.01 && crop.y < 0.01 && Math.abs(crop.w - nw) < 0.01 && Math.abs(crop.h - nh) < 0.01;
      ok = await draw(img, src, whole ? null : crop, { x: box.x + x0, y: box.y + y0, w: x1 - x0, h: y1 - y0 }, { alt, opacity });
    }
    if (!ok) placeholder(box, fileName(img.getAttribute('src') ?? src), opacity);
  }

  /** `.slide-bleed`: a `bg` image becomes one full-slide picture, cover and centred, with its scrim painted in. */
  async function background(cs: CSSStyleDeclaration, opacity: number): Promise<void> {
    const image = cs.backgroundImage;
    const url = /url\((["']?)(.*?)\1\)/.exec(image);
    // A `bg` colour is the slide's own background: nothing to add.
    if (!url) return;
    const src = url[2]!;
    try {
      const img = await loadImage(src);
      const nw = img.naturalWidth || W;
      const nh = img.naturalHeight || H;
      const s = Math.max(W / nw, H / nh);
      const crop = { x: (nw - W / s) / 2, y: (nh - H / s) / 2, w: W / s, h: H / s };
      // The scrim is the gradient layered over the picture (slide.css): a flat colour.
      const scrim = /rgba?\([^()]*\)|color\([^()]*\)/.exec(image.slice(0, url.index))?.[0];
      await draw(img, src, img.naturalWidth && img.naturalHeight ? crop : null, { x: 0, y: 0, w: W, h: H }, { alt: '', opacity, scrim });
    } catch (error) {
      console.warn(`dex: the background ${fileName(src)} could not be read for the PowerPoint export`, error);
    }
  }

  /** What stands in for a video or an iframe: its file name, or its address. */
  function mediaLabel(el: Element): string {
    if (el instanceof HTMLIFrameElement) return el.getAttribute('src') ?? '';
    const src = el.getAttribute('src') ?? el.querySelector('source')?.getAttribute('src') ?? '';
    return fileName(src);
  }

  // ── The section number, drawn by `.slide::before` (layouts.css) ──

  function sectionNumber(opacity: number): void {
    const before = getComputedStyle(slideEl!, '::before');
    const main = slideEl!.querySelector(':scope > .s-main');
    if (!hasContent(before) || !main) return;
    const text = contentText(before.content) || slideEl!.dataset.section || '';
    if (!text) return;
    // It hangs above .s-main in the slide's flex column, as wide as the column.
    const m = rel(main.getBoundingClientRect());
    const lineHeight = lineHeightOf(before);
    items.push({
      kind: 'text',
      x: m.x,
      y: m.y - px(before.marginBottom) - lineHeight,
      w: m.w,
      h: lineHeight,
      wrap: false,
      paragraphs: [{ runs: [toRun(text, styleFrom(before, opacity))], align: alignOf(before), lineHeight }],
    });
  }

  // ── The walk: document order, which is paint order closely enough ──

  async function walk(el: Element, inherited: number): Promise<void> {
    // Inline SVG and other foreign content is not exported.
    if (!(el instanceof HTMLElement)) return;
    const cs = getComputedStyle(el);
    if (hidden(el, cs)) return;
    // The product of the ancestors' opacity becomes the alpha of everything below.
    const opacity = inherited * opacityOf(cs);
    if (opacity <= 0) return;
    const r = rel(el.getBoundingClientRect());

    if (el.classList.contains('slide-bleed')) return background(cs, opacity);
    if (el instanceof HTMLImageElement) return picture(el, cs, r, opacity);
    if (el.tagName === 'VIDEO' || el.tagName === 'IFRAME') return placeholder(r, mediaLabel(el), opacity);
    if ((el.tagName === 'UL' || el.tagName === 'OL') && isSimpleList(el)) return listBox(el, cs, r, opacity);
    if (el instanceof HTMLTableElement && isSimpleTable(el, cs)) return tableFrame(el, r, opacity);
    if (el.tagName === 'PRE') {
      for (const child of preBox(el, cs, r, opacity)) await walk(child, opacity);
      return;
    }

    const root = el === slideEl;
    decorate(cs, r, opacity, root);
    if (el.tagName === 'LI') listMarker(el, cs, r, opacity);
    if (root) sectionNumber(opacity);

    // A block's own text becomes a text box at its content box; its block
    // children are walked on their own.
    let first = true;
    for (const part of gather(el, opacity)) {
      if ('block' in part) {
        await walk(part.block, opacity);
        first = false;
      } else if (textBox(cs, r, part.runs, first)) {
        first = false;
      }
    }
  }

  await walk(slideEl, 1);
  return { bg, items, notes: [] };
}

// ── The deck ────────────────────────────────────────────────────────────────

/** Measures the print view and returns the deck to write. Fonts and pictures must already be in (see index.ts). */
export async function collectDeck(input: CollectInput): Promise<PptxDeck> {
  const pages = [...input.root.querySelectorAll<HTMLElement>('.print-page')];
  const notes = new Map(input.slides.map((slide) => [slide.id, slide.notes]));
  const pictures = new Map<string, Stored>();
  const slides: PptxSlide[] = [];
  for (const page of pages) {
    const id = page.parentElement?.dataset.slide ?? '';
    const slide = await collectPage(page, pictures);
    // Marks go on top, from the data rather than the DOM.
    if (input.marks) slide.items.push(...markItems(input.marks.slides[id], page));
    slide.notes = notesParagraphs(notes.get(id) ?? '');
    slides.push(slide);
  }
  return {
    title: input.title,
    ...(input.author ? { author: input.author } : {}),
    lang: input.lang,
    w: pages[0]?.offsetWidth || input.size.W,
    h: pages[0]?.offsetHeight || input.size.H,
    // The deck's own theme, which the print view inherits; a page may be inverted.
    palette: readPalette(input.root),
    slides,
  };
}
