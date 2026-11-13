export type ThemeName = 'paper' | 'ink';

export type LayoutName =
  | 'default' | 'title' | 'section' | 'statement' | 'quote'
  | 'image' | 'figure' | 'split' | 'gallery' | 'columns' | 'full';

export interface DeckMeta {
  title: string;
  author?: string;
  date?: string;
  theme: ThemeName;
  aspect: '16:9' | '16:10' | '4:3';
  build: boolean;
  transition: 'fade' | 'none';
  lang: string;
}

export interface SlideOptions {
  layout?: LayoutName;
  invert?: boolean;
  build?: boolean;
  image?: 'left' | 'right';
  fit?: 'cover' | 'contain';
  align?: 'top' | 'center';
  bg?: string;            // rewritten URL, or a CSS color
  class?: string;
  id?: string;
  skip?: boolean;
  transition?: 'fade' | 'none';
}

export interface Slide {
  id: string;             // stable key: options.id, else slug of the title, else `slide-<n>`
  index: number;          // 0-based position in the deck
  title: string | null;
  layout: LayoutName;
  html: string;           // inner HTML of the slide element (§6 HTML contract)
  attrs: Record<string, string>;   // data-* attributes for the slide element, plus `style` when the slide has a `bg`
  notes: string;          // speaker notes as HTML, '' when none
  steps: number;          // number of build steps, 0 when none
  options: SlideOptions;
  source: string;         // this slide's raw Markdown
  line: number;           // 1-based line in deck.md where the slide starts
  hash: string;           // changes when the slide's rendered output would change
}

// `slide` is the 0-based slide index, or -1 for frontmatter. `line` is 1-based in deck.md.
export interface CompileWarning { slide: number; line: number; message: string }

export interface Deck {
  slug: string;
  meta: DeckMeta;
  slides: Slide[];
  assets: string[];       // deck-relative paths referenced by the deck
  warnings: CompileWarning[];
}

export interface DeckSummary { slug: string; title: string; slides: number; modified: string }

// Marks: drawings and sticky notes. Coordinates are stage logical pixels.
export type PenColor = 'ink' | 'red' | 'blue';
export type NoteColor = 'yellow' | 'pink' | 'blue';

export interface Stroke {
  id: string;
  tool: 'pen' | 'marker' | 'arrow' | 'box';
  color: PenColor;
  size: number;
  points: [x: number, y: number, pressure: number][];   // arrow and box: exactly two points, start and end
}
export interface Note { id: string; x: number; y: number; w: number; h: number; text: string; color: NoteColor }
export interface SlideMarks { strokes: Stroke[]; notes: Note[] }
export interface Marks { version: 1; slides: Record<string, SlideMarks> }   // keyed by Slide.id

export interface Settings {
  textScale: 'quiet' | 'regular' | 'loud';
  builds: boolean;
  motion: boolean;
  chrome: 'auto' | 'always' | 'hidden';
  marks: boolean;         // show drawings and sticky notes
  followEdits: boolean;   // dev: jump to the slide that just changed
  pen: { tool: 'pen' | 'marker' | 'arrow' | 'box' | 'eraser'; color: PenColor; size: number };
}

export const DEFAULT_SETTINGS: Settings = {
  textScale: 'regular', builds: true, motion: true, chrome: 'auto',
  marks: true, followEdits: true, pen: { tool: 'pen', color: 'ink', size: 6 },
};

// BroadcastChannel messages between windows of the same deck (Phase 8).
// `nav`, `theme` and `blackout` are last-writer-wins: a window applies one only
// when its stamp is newer than the stamp of the value it holds (see SyncStamp).
export type SyncMessage =
  | { type: 'hello' }
  | { type: 'nav'; index: number; step: number; stamp: SyncStamp }
  | { type: 'marks'; slideId: string; marks: SlideMarks }
  | { type: 'theme'; theme: ThemeName; stamp: SyncStamp }
  | { type: 'blackout'; on: boolean; stamp: SyncStamp };

// Orders changes made in different windows so they all settle on the same value.
// `seq` is a Lamport clock: higher wins. On a tie the older window (smaller
// `origin`, its `performance.timeOrigin`) wins, then the smaller `id`.
export interface SyncStamp { seq: number; origin: number; id: string }

// Custom HMR events the dev server sends (dev only; see §7 "Server contract").
export interface DexUpdateEvent { slug: string }                                      // `dex:update`
export interface DexErrorEvent { slug: string; error: string; line: number | null }   // `dex:error`; `line` is 1-based in deck.md
export interface DexIndexEvent { slugs: string[] }                                    // `dex:index`; sorted
