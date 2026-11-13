# dex — implementation plan

Markdown in, deck out. You write `decks/<name>/deck.md` in your editor, run `pnpm start`, and present from the browser. Saving the file updates the open deck in place.

Written 2026-11-12. §1–§8 are the spec. §9 is the build order, one phase per agent session.

---

## 0. How to use this plan

**Kickoff prompt for each phase** (paste into a fresh session on the executing model):

```
Read PLAN.md: all of §0–§8, then Phase N in §9. Implement Phase N only.
Follow the ground rules in §3. When every acceptance check for the phase passes,
tick the phase in §0, record any deviation from the plan in §11, and commit.
```

**Status** (executors tick these):

| # | Phase | Size | Needs | Suggested tier | Done |
|---|---|---|---|---|---|
| 0 | Scaffold, fonts, tokens | S | — | Haiku | [x] |
| 1 | Compiler: markdown → deck JSON | L | 0 | Sonnet | [x] |
| 2 | Vite plugin, dev server, scripts | M | 1 | Sonnet | [x] |
| 3 | Runtime shell: stage, nav, builds, chrome, live reload | L | 2 | Sonnet | [x] |
| 4 | Slide design: typography, all layouts, demo deck | L | 3 | Sonnet | [x] |
| 5 | Settings sheet, overview, source view | M | 3 | Sonnet | [x] |
| 6 | Marks: draw, sticky notes, laser, persistence | L | 3 | Sonnet | [x] |
| 7 | Zoom and pan | S | 3 | Sonnet | [x] |
| 8 | Presenter view, speaker notes, timer, blackout | M | 3 | Sonnet | [x] |
| 9 | Print/PDF and static export | S | 4 | Haiku | [ ] |
| 10 | QA, polish, README | M | all | Sonnet, then a human or stronger-model design review | [ ] |

Phases 4–8 only depend on 3 and touch separate files, so they can run in parallel in separate worktrees. Running them in order is simpler and is the default.

**Reference images:** `docs/reference/` holds three John Maeda screenshots: `maeda-title.png` (title slide), `maeda-draw.png` (content slide with the draw bar open), and `maeda-settings.png` (settings sheet). The folder is gitignored, so it exists only in the main checkout. An executor in a worktree or a fresh clone will not have it and works from the reference measurements in §8.

---

## 1. Product

### What it is

A local tool for writing and giving presentations.

- **Write** in Markdown, one file per deck, images in the same folder.
- **Run** `pnpm start`. The browser opens the live deck. Saving the file updates the deck without a reload and without losing your place.
- **Present** from the same page: keyboard navigation, builds, fullscreen, presenter window, zoom, drawing, sticky notes.
- **Look**: two themes, Paper and Ink, modeled on John Maeda's deck UI. Cool off-white (not white, not tan), near-black ink, DM Sans for text, DM Mono for small uppercase labels, hairlines, square corners, almost no chrome.

### Principles

1. **Authoring ease comes first.** A slide should need no syntax beyond Markdown. Layout is inferred from what is on the slide. Directives exist but are rarely needed.
2. **The chrome stays out of the way.** One thin bar on top, one on the bottom, one settings sheet. Everything else is a single key.
3. **Offline.** Fonts and assets are local. Nothing is fetched from the network while presenting.
4. **Markdown is the source of truth.** The browser never edits `deck.md`. The only thing the browser writes is `marks.json` (drawings and sticky notes).

### Standard deck features and where they land

| Feature | Phase |
|---|---|
| Title, section, bullets, statement/big number, quote, columns, table, code | 1, 4 |
| Images: full-bleed, split with text, titled figure, gallery, background image; video | 1, 4 |
| Builds (step-by-step reveals), slide transitions | 1, 3 |
| Keyboard and clicker navigation, deep links, fullscreen, progress, slide numbers | 3 |
| Themes (Paper, Ink), per-slide invert, text size | 0, 3, 4, 5 |
| Slide overview grid, go-to-slide, skip/hide a slide | 5 |
| Speaker notes, presenter window, timer, blackout | 8 |
| Drawing, highlighter, laser pointer, sticky notes | 6 |
| Zoom and pan | 7 |
| Footnotes and sources | 1, 4 |
| PDF via print, static export for hosting | 9 |

### Not in v1

In-browser editing of slide text, AI features (auto-staging, translation, captions), collaboration or cloud sync, PPTX/Keynote export, more than two themes, math, diagrams, phone remote. See §10.

---

## 2. Decisions

### Stack (versions current on 2026-11-12)

| Purpose | Package | Version |
|---|---|---|
| Dev server and build | `vite` | ^8.3 |
| UI | `svelte` (runes), `@sveltejs/vite-plugin-svelte` | ^5.57, ^7.3 |
| Types | `typescript`, `@types/node` | **^6.0.3, not 7**; ^22 |
| Type check | `svelte-check` | ^4.7 |
| Markdown | `unified` ^11, `remark-parse` ^11, `remark-gfm` ^4, `remark-rehype` ^11, `rehype-raw` ^7, `rehype-stringify` ^10 | |
| Markdown helpers | `unist-util-visit` ^5, `mdast-util-to-string` ^4, `github-slugger` ^2, `yaml` ^2.9 | |
| Code highlighting | `shiki`, `@shikijs/rehype`, `@shikijs/transformers` | ^4.6 |
| Pen strokes | `perfect-freehand` | ^1.2 |
| Fonts | `@fontsource-variable/dm-sans`, `@fontsource/dm-mono` | ^5.3 |
| Tests | `vitest` ^5.1, `@playwright/test` ^1.65 (Chromium only) | |

Nothing else. No CSS framework, UI kit, icon library, router, or state library.

TypeScript is pinned to 6 because `svelte-check` 4.7 declares `typescript: ^5 || ^6` as its peer range. Node is 22, package manager is pnpm 10.

### Why these

- **Custom engine instead of Slidev, Marp, or reveal.js.** The requirements that matter here are the minimal chrome, the inferred layouts, and marks that live with the deck. Each of those means fighting an existing framework's UI.
- **Svelte 5.** The app is small: slide HTML injected into a stage, a few bars and overlays, a handful of shared state objects. Runes in `.svelte.ts` modules cover the state with no library.
- **Fixed logical stage.** Every slide is laid out on a 1600×900 canvas that is scaled to fit the window. The page background is the same color as the slide, so no slide edge is visible and it reads as fluid. Fixed coordinates are what make zoom, drawing, sticky notes, thumbnails, and print line up exactly.
- **Deck JSON over HTTP.** The compiler turns `deck.md` into `deck.json`. The dev server compiles on request and on save; the build writes the same file to `dist/`. The client fetches the same URL in both cases.

### Architecture

```
your editor ──► decks/<slug>/deck.md
                      │
              engine/compiler            pure TypeScript, no fs, unit tested
                      │  Deck (JSON)
              engine/vite-plugin.ts
                dev    GET decks/<slug>/deck.json     compiled on request, cached
                       watch deck.md → recompile → custom event `dex:update`
                       PUT /__dex/marks/<slug> → decks/<slug>/marks.json
                build  emits decks/index.json, decks/<slug>/deck.json, copies media
                      │
              src/ (Svelte SPA)
                fetches deck.json, renders slides on a 1600×900 stage,
                hash routes: #/ · #/<slug>/<n> · #/<slug>/presenter · #/<slug>/print
```

### Repository layout

```
dex/
├─ PLAN.md  CLAUDE.md  README.md
├─ package.json  vite.config.ts  svelte.config.js  tsconfig.json  playwright.config.ts  index.html
├─ decks/
│  └─ demo/
│     ├─ deck.md            kitchen-sink deck: living spec, test fixture, visual QA target
│     ├─ marks.json         written by the dev server (drawings, sticky notes)
│     └─ media/
├─ docs/reference/          Maeda screenshots (gitignored)      docs/shots/   generated screenshots
├─ shared/types.ts          types used by both sides (§5)
├─ engine/                  Node side
│  ├─ compiler/             index.ts frontmatter.ts split.ts comments.ts builds.ts layout.ts
│  │                        regions.ts media.ts highlight.ts  + *.test.ts
│  ├─ vite-plugin.ts
│  └─ scripts/              start.mjs  new.mjs
├─ src/                     browser side
│  ├─ main.ts  App.svelte
│  ├─ state/                deck.svelte.ts nav.svelte.ts settings.svelte.ts ui.svelte.ts marks.svelte.ts sync.ts
│  ├─ lib/                  router.ts commands.ts keys.ts stage.ts storage.ts
│  ├─ components/           Stage SlideView TopBar BottomBar Icon Segmented SettingsSheet Overview
│  │                        SourceView DrawLayer DrawBar NotesLayer StickyNote Laser Blackout
│  │                        PresenterView PrintView DeckIndex ErrorOverlay   (all .svelte)
│  └─ styles/               tokens.css base.css chrome.css slide.css layouts.css code.css print.css
└─ e2e/                     smoke.spec.ts  shots.spec.ts
```

### Scripts

| Command | Does |
|---|---|
| `pnpm start` | Start the dev server and open the browser at the deck index |
| `pnpm start <slug>` | Same, opening `#/<slug>` directly |
| `pnpm new <slug>` | Create `decks/<slug>/deck.md` from the starter template |
| `pnpm build` / `pnpm preview` | Static export to `dist/` / serve it |
| `pnpm check` | `svelte-check` for browser code (`src/`, `shared/`), then `tsc -p tsconfig.node.json` for Node code (`engine/`, `e2e/`, config files) |
| `pnpm test` / `pnpm test:e2e` | Vitest unit tests / Playwright smoke tests |
| `pnpm shots` | Screenshot every demo slide in both themes into `docs/shots/` |

`npm start` works too. `start` runs `node engine/scripts/start.mjs`, not bare `vite`, because `vite <arg>` would treat the slug as a root directory.

### Verified in a spike on 2026-11-12

These were run against the versions above. Build on them without re-deriving.

- A custom mdast parent node with `data: { hName, hProperties }` becomes that element in `remark-rehype` output. This is how regions are wrapped (§6).
- `data.hProperties = { 'data-step': 1 }` on a `listItem` reaches the `<li>`.
- The bullet character of a list is `source.charAt(list.children[0].position.start.offset)`. mdast does not store it.
- With `allowDangerousHtml: true` plus `rehype-raw`, raw HTML in Markdown comes through as real elements. HTML comments arrive as root-level `html` nodes whose `value` starts with `<!--`.
- GFM footnotes render as `<section data-footnotes class="footnotes">` at the end of the root.
- Shiki 4: `createCssVariablesTheme` and `createHighlighter` are exported from `shiki`. `@shikijs/rehype/core` default-exports a plugin called as `.use(plugin, highlighter, { theme, transformers, fallbackLanguage: 'text' })`. `transformerMetaHighlight()` turns ` ```ts {2} ` into `class="line highlighted"` (the spike had no `rehype-raw` in the pipeline; with it, the fence meta must first be copied to `hProperties.metastring`, see §6). Token colors are emitted as `var(--shiki-token-keyword)` and similar.
- Vite 8: middleware added in `configureServer` runs before Vite's own static serving. Vite serves any file under the project root in dev, so `decks/<slug>/media/x.png` needs no extra middleware. `handleHotUpdate` fires when `deck.md` changes, and returning `[]` suppresses the default reload. `server.hot.send(event, data)` exists.
- `perfect-freehand` exports `getStroke`.
- Font CSS entry points: `@fontsource-variable/dm-sans/opsz.css` and `opsz-italic.css` (weight and optical-size axes), `@fontsource/dm-mono/400.css`, `500.css`, `400-italic.css`.

---

## 3. Ground rules for implementing agents

1. Do only your phase. Later phases have stubs waiting for them; leave other phases' stubs alone.
2. Add no dependency that is not in §2. If you believe one is needed, stop and record why in §11.
3. Several of these libraries are newer than most training data (Vite 8, Vitest 5, Shiki 4, TypeScript 6, Svelte 5.57). Before using an API you have not seen verified in §2, read its types or README in `node_modules`. Do not code from memory.
4. Svelte 5 runes only: `$state`, `$derived`, `$effect`, `$props`, `onclick={...}`, `{@render}`, `mount()`. Never `export let`, `on:click`, `$:`, `<slot>`, or `svelte/store`. Shared state lives in `src/state/*.svelte.ts` as an exported `const` object created with `$state({...})`; mutate its properties, never reassign the export.
5. Slide content is injected with `{@html}`, so component-scoped styles do not reach it. All slide and theme CSS goes in `src/styles/*.css`. Component `<style>` blocks are for chrome components only.
6. Every color, font, and duration comes from a token in `tokens.css`. No hex values anywhere else. No `border-radius`. No `box-shadow` except on sticky notes. No fonts other than DM Sans and DM Mono.
7. Inside the stage, sizes are logical pixels on the 1600×900 canvas. Never use `vw`, `vh`, or `rem` inside `.stage`. Chrome (bars, sheets) uses real CSS pixels.
8. `shared/types.ts` is the contract between phases. If you must change it, update §5 in the same commit and note it in §11.
9. Global key handling ignores events whose target is an `input`, `textarea`, `select`, or `contenteditable` element, except `Escape`.
10. Before saying a phase is done: `pnpm check`, `pnpm test`, and (from Phase 3 on) `pnpm test:e2e` all pass, and you have looked at the result in a browser or in screenshots. Report anything you could not verify.
11. Commit once per phase: `phase N: <summary>`.
12. If your environment offers them, load the `svelte5-best-practices` skill before writing Svelte, and `make-interfaces-feel-better` for Phases 4, 5, and 10.
13. Type checking is split in two. `tsconfig.json` covers browser code (`src/`, `shared/`) and has no Node types. `tsconfig.node.json` covers Node code (`engine/`, `e2e/`, `*.config.ts`, `shared/`). Code under `src/` must not import `node:*` or anything under `engine/`; the only code both sides share is `shared/`.

`CLAUDE.md` carries a copy of this list; keep the two in step.

---

## 4. Authoring format

This is the user-facing contract. Phase 10 turns this section into the README.

### A deck

`decks/<slug>/deck.md`, with media anywhere inside `decks/<slug>/`. `<slug>` is lowercase letters, digits, and hyphens.

````markdown
---
title: Product Simplicity
author: Adam Scott
theme: paper
---

# Product Simplicity

A simple recipe for making better products.

<!-- Open with the elevator story. -->

---

## Three ingredients

+ Subtract the obvious
+ Organize what is left
+ Save people time

---

![Paper prototypes on a desk](media/desk.jpg)

## Prototypes beat opinions

Every review starts with something you can click.

---

> Simplicity is about subtracting the obvious and adding the meaningful.
>
> — John Maeda

---

73%

of teams ship faster with fewer features
````

That file produces a title slide, a bullet slide that builds one item at a time, a split slide with the image on the left, a quote slide, and a big-number slide, with no layout syntax.

### Frontmatter (all optional)

| Key | Values | Default |
|---|---|---|
| `title` | text | first slide's heading, else the slug |
| `author`, `date` | text | none |
| `theme` | `paper`, `ink` | `paper` |
| `aspect` | `16:9`, `16:10`, `4:3` | `16:9` |
| `build` | `true`, `false` — do all lists build step by step | `false` |
| `transition` | `fade`, `none` | `fade` |
| `lang` | language tag | `en` |

The block between the first two `---` lines is frontmatter only if it is a `key: value` map. A deck may also simply begin with a `---` slide break.

### Slides

- A line containing only `---` starts a new slide. It always means a slide break, even directly under a line of text. It is ignored inside fenced code blocks, but not inside an HTML comment: keep `---` out of speaker notes. The compiler warns when a comment is left unclosed on a slide.
- Slide content is CommonMark plus GFM (tables, strikethrough, task lists, footnotes) plus raw HTML.
- Footnotes and link reference definitions must be on the slide that uses them.

### Headings are roles

| Markdown | Role |
|---|---|
| `#` | Display heading. A slide with only `#` and up to two paragraphs is a title slide. `#` alone (not on slide 1) is a section divider. |
| `##` | Slide title |
| `###` | Column heading (two to six on a slide make columns), otherwise a subheading |
| `####` | Small subheading |
| `######` | Eyebrow: a small uppercase mono label, usually placed above the heading |

### Layout inference

Layout is chosen from the slide's content. A `layout` directive overrides it.

| The slide contains | Layout |
|---|---|
| `#` and at most two paragraphs | `title` |
| `#` alone, not the first slide | `section` |
| One or two short paragraphs, no heading (≤ 200 characters) | `statement` — very large type; ≤ 8 characters in the first paragraph makes it a giant number with the second paragraph as its label |
| Only a blockquote | `quote` — a last line starting with `—` or `--` is the attribution |
| Only one image | `image` — full-bleed |
| A heading and one image, nothing else | `figure` — title on top, image fills the rest |
| One image plus other content | `split` — image on the left if it comes first in the source, otherwise on the right |
| Only images (two or more), with an optional `#` or `##` heading | `gallery` |
| Two to six `###` headings | `columns` — one column per `###` |
| A line containing only `\|\|\|` | `columns` — split at each `\|\|\|` |
| Anything else | `default` — title on top, content below |

### Builds

- A list written with `+` bullets reveals one item per step. `-` and `*` lists appear all at once.
- `build: true` in the frontmatter or in a slide directive makes every top-level list on the slide build, whatever the bullet. `build: false` on a slide turns builds off for that slide.
- A line containing only `. . .` is a pause: everything after it on the slide waits for the next step. A building list right after a pause shows its first item on that step.
- Nested list items appear with their parent.

### Comments: directives and speaker notes

An HTML comment is a **directive** if every `key: value` pair in it uses a key from the table below. Pairs are separated by commas or newlines. Any other comment is a **speaker note** (Markdown allowed), shown only in the presenter window.

```markdown
<!-- layout: statement, invert: true -->

<!-- Pause here. Ask who has shipped something this week. -->
```

| Directive | Values | Effect |
|---|---|---|
| `layout` | `default` `title` `section` `statement` `quote` `image` `figure` `split` `gallery` `columns` `full` | Override the inferred layout. `full` removes all padding (for an iframe or custom HTML). |
| `invert` | `true` | Show this slide in the other theme |
| `build` | `true`, `false` | See Builds |
| `image` | `left`, `right` | Which side the image takes in `split` |
| `fit` | `cover`, `contain` | How the main image fills its area. Default `cover` for `image` and `split`, `contain` for `figure`. |
| `align` | `top`, `center` | Vertical alignment of the content in `default` |
| `bg` | image path or CSS color | Slide background. An image gets a dark scrim and the slide switches to Ink. |
| `class` | class names | Extra classes on the slide element |
| `id` | text | Stable id for this slide (marks are keyed by it) |
| `skip` | `true` | Leave the slide out when presenting; it stays in the overview, dimmed |
| `transition` | `fade`, `none` | Transition into this slide |

A comment with an unknown key is kept as a note. The compiler warns only when it was clearly meant as a directive: the key is a near miss for a real one (`layuot`), or unknown keys are mixed with real ones. A note such as `todo: fix this` produces no warning.

### Media

- `![alt](media/photo.jpg "Caption")` — the quoted title becomes a visible caption.
- Paths are relative to the deck folder. `http(s):` and `data:` URLs pass through.
- A path ending in `.mp4`, `.webm`, or `.mov` becomes a video with controls. The words `autoplay`, `loop`, and `muted` in the alt text set those attributes; autoplay videos start when their slide is shown and pause when it is left.
- Code blocks: ` ```ts {2,4-5} ` highlights lines 2, 4, and 5.

---

## 5. Data model

`shared/types.ts`. Phase 0 creates it with exactly this content.

```ts
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
```

The theme a user toggles is stored per deck in `localStorage` under `dex:theme:<slug>` and overrides the frontmatter. Everything in `Settings` is global, stored under `dex:settings`.

---

## 6. Compiler

`compileDeck(source: string, opts: { slug: string }): Promise<Deck>` in `engine/compiler/index.ts`. It reads no files. It throws `DexCompileError` (with a `line`) only for invalid frontmatter YAML. Every content problem becomes a `CompileWarning`.

### Pipeline

1. **Normalize** line endings to `\n`.
2. **Frontmatter** (`frontmatter.ts`). If the source starts with `---\n`, take everything up to the next line that is exactly `---` and parse it with `yaml`. Validate against `DeckMeta`; an unknown key or bad value is a warning and the default is used. Keep count of the consumed lines so `Slide.line` stays correct. The block counts as frontmatter only if it is blank or parses to a key: value map; otherwise the leading `---` is an ordinary slide break and the block is the first slide.
3. **Split** (`split.ts`). Walk the body line by line. Track fenced code: a fence opens on a line matching `/^ {0,3}(`{3,}|~{3,})/` and closes on a line of the same character with at least the same length. Outside fences, a line matching `/^---+\s*$/` ends the current chunk. Drop chunks that are empty or whitespace. Record each chunk's starting line. This is deliberately line-based, not AST-based: `text` directly followed by `---` would otherwise parse as a heading.
4. **Per chunk** (cache the result by `hash`; see below):
   1. Parse with `remark-parse` and `remark-gfm`.
   2. **Comments** (`comments.ts`). Remove root-level `html` nodes that are whole comments (`/^<!--([\s\S]*?)-->$/`). Split the body on commas and newlines into `key: value` pairs. If there is at least one pair and every key is a known directive, merge into `SlideOptions` (validating values; bad value → warning, ignored). Otherwise append the comment body to the notes, and warn if it was clearly meant as a directive: an unknown key within two edits of a real one, or unknown keys mixed with real ones. A root-level comment that is never closed is removed, kept as a note, and warned about.
   3. **Markers.** Before parsing, put blank lines around every line that is exactly `. . .` or `|||` (outside fenced code), so each is its own paragraph. Then remove root-level paragraphs whose text is exactly `. . .` (pause) or `|||` (column break), remembering their positions.
   4. **Builds** (`builds.ts`). Walk root blocks in order with a counter starting at 0. A pause takes effect at the next block that needs a step: that block increments the counter, and every later root block gets `data-step` equal to the counter at that point. A building list directly after a pause puts its first item on the pause's step. A trailing pause adds no step. A top-level list builds if the slide's `build` option is `true`, or the option is unset and (deck `build` is true or the list's bullet is `+`). For a building list, each direct `listItem` increments the counter and gets that value as `data-step`; the list itself keeps the step it inherited. `Slide.steps` is the final counter. Set steps with `node.data.hProperties['data-step']`.
   5. **Layout** (`layout.ts`). Use `options.layout` if set; otherwise infer (rules below).
   6. **Regions** (`regions.ts`). Regroup the root's children into wrapper nodes per the HTML contract. Wrappers are custom mdast parent nodes: `{ type: 'dexRegion', data: { hName: 'div', hProperties: { className: ['s-main'] } }, children }`.
   7. **To HTML.** `remark-rehype` with `allowDangerousHtml: true` → `rehype-raw` → media plugin (`media.ts`) → Shiki (`highlight.ts`) → `rehype-stringify`. `rehype-raw` drops hast `data`, where the code fence's meta string lives, so copy each code node's meta to `hProperties.metastring` first; Shiki reads it from there.
   8. **Notes.** Join note comments with a blank line and render through a small pipeline of `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-stringify` (no raw HTML).
5. **Assemble.** Assign `index`. Assign `id` with one `github-slugger` instance per deck so duplicates get `-1`, `-2`. `title` is the text of the first heading of depth ≤ 3, else the first 60 characters of text, else `null`. Number `section` slides in order and set `attrs['data-section']` to a zero-padded count (`01`, `02`). `meta.title` falls back to the first slide's title, then the slug.

**Cache.** `hash` is the first 10 hex characters of SHA-1 over the chunk text, the slug, and `meta.build`. Keep a module-level `Map<hash, compiled chunk>` so editing one slide recompiles one slide. `index`, `id`, and `data-section` are assigned after the cache lookup.

### Layout inference

Definitions, applied to the root blocks after comments and markers are removed, ignoring footnote and link definitions:

- **eyebrow**: the first block, if it is a depth-6 heading. Set it aside; it does not count below.
- **media block**: a paragraph whose children, ignoring whitespace-only text, are all images. A paragraph with several images counts as that many media blocks.
- **heading**: a heading of depth 1–5.

First matching rule wins:

| # | Condition | Layout |
|---|---|---|
| 1 | No blocks | `default` (warn: empty slide) |
| 2 | Every block is a media block | 1 → `image`; 2+ → `gallery` |
| 3 | Exactly one heading of depth 1–2, at least one other block, and every other block is a media block | 1 media → `figure`; 2+ → `gallery` |
| 4 | Exactly one media block, plus other blocks | `split` |
| 5 | Exactly one block and it is a blockquote | `quote` |
| 6 | There is at least one `\|\|\|` marker | `columns` |
| 7 | Exactly one heading, it is depth 1, every other block is a paragraph, and there are at most two | no paragraphs and not the first slide → `section`; otherwise `title` |
| 8 | No headings, one or two blocks, all paragraphs, total text ≤ 200 characters | `statement` |
| 9 | Two to six depth-3 headings; before the first one there is at most one heading and it is the first block at depth 1–2; after it there is no heading shallower than depth 3 | `columns` |
| 10 | Otherwise | `default` |

Computed attributes:

- `split`: `data-image` is `options.image`, else `left` if the media block is the first block, else `right`.
- `statement`: `data-len` from the first paragraph's character count: ≤ 8 `xs`, ≤ 40 `s`, ≤ 100 `m`, else `l`.
- `quote`: `data-len` is `l` when the quote has more than 140 characters (the attribution not counted), else `m`; §8 sets long quotes smaller.
- `gallery` and `columns`: `data-count` is the number of images or columns.
- `image`, `split`, `figure`: `data-imgfit` is `options.fit` or the layout's default.
- `options.align` → `data-align`. `options.bg` that ends in an image extension → `data-bg="image"` and the rewritten URL in `attrs['style']` as `--slide-bg: url(...)`; any other `bg` value → `attrs['style']` as `background: <value>`.

Test fixtures for `layout.test.ts` (each row is one test):

| Slide source | Expect |
|---|---|
| `# Title` as slide 1 | `title` |
| `# Title` + one paragraph | `title` |
| `# Part two` as slide 3 | `section`, `data-section="01"` |
| `## Heading` + list | `default` |
| `# Heading` + list | `default` |
| `## Heading` alone | `default` |
| One 60-character paragraph | `statement`, `data-len="m"` |
| `73%` + one paragraph | `statement`, `data-len="xs"` |
| One 300-character paragraph | `default` |
| Blockquote only | `quote` |
| One image | `image` |
| `## H` + one image | `figure` |
| Image, then `## H`, then a paragraph | `split`, `data-image="left"` |
| `## H`, paragraph, image | `split`, `data-image="right"` |
| Same, with `<!-- image: left -->` | `split`, `data-image="left"` |
| Three images | `gallery`, `data-count="3"` |
| `## H` + three `###` groups | `columns`, `data-count="3"` |
| `## H`, text, `\|\|\|`, text | `columns`, `data-count="2"` |
| `## H` + two images + a paragraph | `default` |
| `###### Label` + `# Title` + paragraph | `title`, eyebrow inside the head |
| `<!-- layout: full -->` + raw HTML | `full` |

### HTML contract

The runtime renders each slide as:

```html
<section class="slide {options.class}" data-layout="split" data-theme="paper" data-id="…" {...slide.attrs}>
  {slide.html}
</section>
```

`slide.html` always has this shape. **head** is the eyebrow plus the first heading when that heading is depth 1–2; **rest** is everything else.

```html
<div class="s-main">                 text side; the box the auto-fit measures
  <header class="s-head">…</header>  omitted when there is no head
  <div class="s-body">…</div>        omitted when empty
</div>
<div class="s-media">…</div>         only in image, figure, split, gallery
```

| Layout | `.s-main` contains | `.s-media` contains |
|---|---|---|
| `default`, `title`, `section`, `statement` | head, body(rest) | — |
| `quote` | body(blockquote); the attribution paragraph gets class `attrib` and loses its leading dashes | — |
| `columns` | head, optional `<div class="s-lede">` (blocks before the first column), `<div class="s-cols">` of `<section class="s-col">` | — |
| `split` | head, body(rest without the media block) | the figure |
| `figure` | head | the figure |
| `gallery` | head, if any | all figures |
| `image` | omitted | the figure |
| `full` | every block, no head/body wrappers | — |

The media plugin (`media.ts`, a rehype plugin) does three things everywhere in the slide:

- A `<p>` containing only images becomes one `<figure class="media">` per image, with `<figcaption>` from the image's `title`. Images get `draggable="false"` and `decoding="async"`.
- An image whose `src` has a video extension becomes `<video controls playsinline preload="metadata">`, with `autoplay`, `loop`, `muted` taken from the alt text (`autoplay` is emitted as `data-autoplay` so the runtime controls playback).
- Relative URLs on `img`, `video`, `source`, `iframe` (`src`) and on `a` (`href`, when it points to a file) are rewritten to `decks/<slug>/<path>` with no leading slash, and added to `Deck.assets`. URLs starting with a scheme, `//`, `/`, or `#` are left alone.

`highlight.ts` creates one highlighter for the process: `createHighlighter({ themes: [createCssVariablesTheme({ name: 'dex', variablePrefix: '--shiki-', fontStyle: true })], langs: [...] })` with a starting set of languages (`ts`, `js`, `tsx`, `jsx`, `json`, `html`, `css`, `bash`, `python`, `rust`, `swift`, `sql`, `yaml`, `markdown`, `diff`), `fallbackLanguage: 'text'`, and `transformerMetaHighlight()`.

---

## 7. Runtime

### DOM contract

Phase 3 builds this skeleton with every component present. Components owned by later phases start as stubs that render nothing.

```html
<html data-theme="paper">                          effective theme of the current slide
<div class="app" data-text="regular" data-motion="on" data-chrome="shown|hidden" data-tool="draw|note|laser">
  <TopBar/>                                        fixed, 50px
  <main class="viewport">                          the stage area (see below)
    <div class="stage">                            1600×900 logical, scaled to fit, centered
      <div class="camera">                         zoom/pan transform (Phase 7)
        <div class="slides"> <SlideView/> … </div> previous, current, next
        <DrawLayer/>                               Phase 6
        <NotesLayer/>                              Phase 6
      </div>
      <Laser/>                                     Phase 6
    </div>
  </main>
  <BottomBar/>                                     fixed, 46px
  <Overview/> <SettingsSheet/> <SourceView/>       Phase 5
  <Blackout/>                                      Phase 8
  <ErrorOverlay/>
</div>
```

- **Stage fit** (`lib/stage.ts`): `W` is 1600, 1440, or 1200 for 16:9, 16:10, 4:3; `H` is 900. `scale = min(viewportWidth / W, viewportHeight / H)`. The stage is centered and gets `transform: scale(scale)` with `transform-origin: 0 0`. Recompute with a `ResizeObserver`.
- **Stage area.** In a window the bars are docked: they take their own space and the stage fits between them, so nothing on a slide runs under a bar. In fullscreen under `chrome: 'auto'`, and whenever the chrome is hidden, the bars are an overlay and the stage area is the whole window, so bars fading in and out never resize the slide. `chrome: 'always'` docks them everywhere. `.app` carries `data-dock` while docked; `.viewport` is the stage area.
- **Bleed.** A window is rarely the stage's shape, so the stage is letterboxed inside its area. `Stage` publishes the letterbox as `--bleed-x` and `--bleed-y` (logical pixels, per side). `.stage` does not clip; `.viewport` does. `SlideView` renders a `.slide-bleed` element first in every slide, which paints a `bg` colour or image out to the edges of the stage area; the `image` layout and the cover half of `split` extend the same way. Text never bleeds. Slides clip to the stage plus the bleed. Outside a stage (thumbnails, print) the bleed is 0, so a slide is exactly its own shape.
- `html` has `background: var(--bg)`, so the area around the stage matches the slide.
- **Effective theme**: the deck theme (per-deck override, else frontmatter), flipped when the current slide has `invert`, forced to `ink` when it has a `bg` image. It is set on `<html>` so the bars and letterbox flip with the slide. Every `SlideView` also sets `data-theme` on its own root, so thumbnails and print pages are themed independently. Tokens are therefore defined on `[data-theme=…]`, never on `:root`.
- **Slides rendered**: previous, current, and next. Only the current one is visible; the others are `visibility: hidden` so their images are already loaded. The transition is a CSS opacity change on a `.current` class.
- **Builds**: after the HTML is in the DOM, an effect toggles the class `is-pending` on every `[data-step]` element whose step is greater than the current step. Pending elements keep their space (`opacity: 0`), so nothing reflows. When `settings.builds` is off, nothing is pending.
- **Auto-fit**: after the HTML is in the DOM, after `document.fonts.ready`, and after each image in the slide loads: if `.s-main` has `scrollHeight > clientHeight + 1`, set `data-density="1"` on the slide; if still overflowing, `"2"`; if still overflowing, set `data-overflow` and log a console warning naming the slide. Skip for `figure`, `gallery`, `image`, `full`.

### Server contract (built in Phase 2)

What the browser can rely on. URLs are relative to the page.

| Request | Response |
|---|---|
| `GET decks/index.json` | `DeckSummary[]`, newest first. A deck that fails to compile is still listed, with its slug as the title and `slides: 0`. |
| `GET decks/<slug>/deck.json` | 200 with the `Deck`. 500 with `{ error, line }` when the frontmatter is invalid. 404 with `{ error }` when there is no such deck. |
| `GET decks/<slug>/marks.json` | The saved `Marks`, or 404 when nothing has been saved yet. A plain static file. |
| `PUT /__dex/marks/<slug>` (dev only) | 204 on success. 400 for a bad slug or a body that is not `{ version: 1, slides: {…} }`. 404 when the deck does not exist. 413 over 5 MB. |

Dev-only events, received with `import.meta.hot.on(name, callback)`. The payload types are in `shared/types.ts`.

| Event | Payload | Sent when |
|---|---|---|
| `dex:update` | `{ slug }` | A `deck.md` was added or changed and compiled, or was removed (its `deck.json` then returns 404). |
| `dex:error` | `{ slug, error, line }` | A `deck.md` changed and failed to compile. `line` is 1-based, or `null`. |
| `dex:index` | `{ slugs }` | A deck was added or removed. Not sent on edits. |

In a static build the same GET URLs are real files, and there is no PUT endpoint and no events.

An editor that saves by renaming can produce a remove followed by an add, so a fetch made between the two may return 404. On a 404 that follows `dex:update`, keep the deck that is showing and refetch once after 200ms.

Vite's own host check and CORS rules run before these endpoints (verified: a request with a foreign `Host` gets 403, and a cross-origin preflight gets no allow-origin header), so they need no checks of their own.

### State (`src/state/*.svelte.ts`)

| Module | Holds |
|---|---|
| `deck` | `list: DeckSummary[]`, `current: Deck \| null`, `error: string \| null`; `loadIndex()`, `loadDeck(slug)`, `reload()` |
| `nav` | `index`, `step`; `next()`, `prev()`, `nextSlide()`, `prevSlide()`, `goto(i)`, `first()`, `last()` |
| `settings` | a `Settings` object persisted to `localStorage` on change; `theme` per deck |
| `ui` | `overlay: null \| 'settings' \| 'overview' \| 'source'`, `tool: null \| 'draw' \| 'note' \| 'laser'`, `blackout`, `camera: { k, x, y }`, `pointer: { x, y, inside }` in stage coordinates, `fullscreen`, `idle` |
| `marks` | the deck's `Marks`, undo/redo stacks, load and save |
| `sync` | the `BroadcastChannel` wrapper |

Navigation rules:

- `next()`: if builds are on and `step < slide.steps`, increment `step`. Otherwise move to the next slide that is not `skip`, with `step = 0`.
- `prev()`: if `step > 0`, decrement. Otherwise move to the previous non-skipped slide with `step` set to its `steps` (fully revealed).
- `nextSlide()` / `prevSlide()` ignore builds. `goto(i)` sets `step = 0`.
- Changing slide resets the camera to `{ k: 1, x: 0, y: 0 }`.
- The URL hash follows the current slide via `history.replaceState` (`#/<slug>/<n>`, `n` 1-based). The step is not in the URL.

### Routes (`lib/router.ts`, hash-based)

| Hash | View |
|---|---|
| `#/` | Deck index. If there is exactly one deck, go straight to it. |
| `#/<slug>` or `#/<slug>/<n>` | The deck at slide `n` |
| `#/<slug>/presenter` | Presenter window (Phase 8) |
| `#/<slug>/print` | Print view (Phase 9) |

### Commands and keys (`lib/commands.ts`, `lib/keys.ts`)

One registry: `{ id, title, keys: string[], run(): void, when?(): boolean }`. `keys.ts` maps `keydown` to commands. The key list in the settings sheet is generated from the registry. Phase 3 registers every command below; commands owned by later phases start with an empty `run`. A later phase fills its stubs by calling `implement(id, run, when?)` from its own module, without editing `commands.ts`.

| Keys | Command | Phase |
|---|---|---|
| `→` `Space` `PageDown` | Next step or slide | 3 |
| `←` `Shift+Space` `PageUp` | Previous step or slide | 3 |
| `↓` / `↑` | Next / previous slide, skipping builds | 3 |
| `Home` / `End` | First / last slide | 3 |
| `f` | Fullscreen | 3 |
| `t` | Toggle Paper / Ink | 3 |
| `h` | Hide or show the chrome | 3 |
| `g` | Overview grid | 5 |
| digits then `Enter` | Go to slide number | 5 |
| `s` or `,` | Settings | 5 |
| `m` | Markdown source of this slide | 5 |
| `d` | Draw | 6 |
| `n` | New sticky note | 6 |
| `l` | Laser pointer | 6 |
| `a` | Show or hide all marks | 6 |
| `c` | Clear this slide's drawings (undoable) | 6 |
| `[` / `]` | Smaller / larger pen (cycles 4, 6, 10) | 6 |
| `Delete` `Backspace` / `Enter` | Delete / edit the selected sticky note | 6 |
| `⌘Z` / `⇧⌘Z` (`Ctrl` on other platforms) | Undo / redo marks | 6 |
| `z`, `+`, `-`, `0` | Zoom toggle, in, out, reset | 7 |
| `p` | Open presenter window | 8 |
| `b` or `.` | Blackout | 8 |
| `Esc` | Close the topmost thing: settings, overview, source, note editing, tool, zoom, blackout — in that order | 3 |

Presentation clickers send `PageDown`, `PageUp`, and often `b` or `.`; those are covered.

`Esc` is a ranked chain in `src/lib/escape.ts` (built in Phase 5). A phase adds a layer, or replaces a default one, with `onEscape(id, rank, close)`; `ESCAPE_RANK` holds the order. Overlays are exclusive: `ui.overlay` is a single value.

---

## 8. Design system

The reference is John Maeda's deck UI (`docs/reference/`). What makes it look the way it does:

- One pale mint-white surface and one near-black ink. A single orange-red accent appears only in draw mode.
- Small uppercase monospace labels with wide tracking carry all UI text.
- 1px hairlines and 1px borders. Square corners. No shadows, no gradients.
- Selected state is a solid ink fill with paper-colored text.
- A small solid square is the only ornament (before the deck title).
- Text is left-aligned in a column that itself sits near the center of the canvas, with a lot of empty space around it.

### Reference measurements

Measured from the three screenshots in `docs/reference/`. They are frames of a screen recording, enlarged 1.225× (calibrated on the browser's window buttons, which sit 20pt apart). Every value below is converted to true CSS pixels; the recorded viewport is 1366×817. Colors are sampled from the pixels, but video compression may have shifted them by a step or two.

| Element | Measured |
|---|---|
| Surface | `#ebf6f4` everywhere: bars, slide, and inside the settings sheet. No panels, no visible slide edge. |
| Ink | `#0f1413` for the title, the square, the rule, selected fills, and the sheet border. |
| Hairlines | 1px `#d8e3e1`, full width, under the top bar and above the bottom bar. |
| Top bar | 50px tall. A 10×10 ink square 16px from the left. Deck title 8px to its right: mono, about 9px, uppercase, about 0.12em tracking, gray-green. |
| Top-right buttons | Three 28×28 squares with a 1px light border, 6px apart, 16px from the right edge, each holding a 13px line icon (grid, fullscreen, gear). |
| Progress | A 1px ink segment on the top hairline from the left edge, `(index + 1) / count` of the width: 2.7% on slide 1 of 36, 16.5% on slide 6. |
| Bottom bar | 46px tall. `←` at 20px and `→` at 50px from the left, very light. The counter `06 / 36` at 69px, mono about 9px, gray-green. Idle `DRAW` at the right, very light. |
| Draw bar | `DRAW · BUILD` very light, then `MARKER` `ARROW` `RECTANGLE` in dark gray-green (`#485653`). The active tool has a 2px orange-red underline. `DEL` and `CLEAR` are nearly invisible when unavailable. `DONE` is orange-red, 17px from the right edge. The cursor is a thin crosshair. |
| Title slide | Title: left edge at 26.2% of the width, cap height 33px (Inter at about 46px; DM Sans needs about 47px for the same cap height), weight about 500. Lede: 16px on a 24.5px line. A 2px ink rule on its left, text 16px right of the rule; the top of the rule is 34px below the title's baseline. Lines wrap at about 585px. The block is centered vertically in the viewport, in a horizontally centered column about 650px wide. |
| Content slide | Slide title: uppercase as typed, regular weight, cap height 25px (Inter at about 35px), left edge at 12.9% of the width, cap top 110px below the top of the viewport (60px below the top bar). Content starts 24px below the title. The column is about 1010px wide and centered. Bold text in the body is weight 700. |
| Settings sheet | 433px wide, centered, 40px from the top and bottom of the viewport, 1px ink border, same background as the page, 18px padding, scrolls inside. Segmented cells are 41px tall with a sublabel and 30px without; selected fill `#121212`; unselected border `#dfeae8`. Section labels are mono, about 9px, uppercase. Control text is about 12–13px. The page behind is almost fully washed out. |

The stage is 1600 wide where the reference viewport is 1366, so reference sizes × 1.17 give stage sizes. The `Quiet` text size (below) is set to reproduce them: title 80 × 0.7 = 56, lede 27 × 0.7 = 19, slide title 60 × 0.7 = 42.

### `tokens.css` (Phase 0 creates exactly this)

```css
:root {
  --font-sans: 'DM Sans Variable', 'DM Sans', system-ui, sans-serif;
  --font-mono: 'DM Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --t-fast: 120ms;
  --t-med: 200ms;
  --t-slow: 260ms;
  --bar-top: 50px;
  --bar-bottom: 46px;
  --note-yellow: #ffe76a;
  --note-pink: #ffc4d0;
  --note-blue: #bfe0ff;
  --note-ink: #0f1413;
  --blackout: #000;        /* Phase 8: the blackout cover, in both themes */
}

[data-theme='paper'] {
  color-scheme: light;
  --bg: #ebf6f4;          /* sampled from the reference: pale mint-white; never white, never cream */
  --ink: #0f1413;         /* sampled */
  --ink-2: #485653;       /* secondary text; sampled from the reference's tool labels */
  --ink-3: #6e7b78;       /* chrome labels only, about 4:1 on --bg; never slide body text */
  --ink-4: #a3b0ad;       /* idle and disabled chrome affordances only */
  --line: #d8e3e1;        /* hairlines and control borders; sampled */
  --fill: #0f1413;        /* selected segment */
  --on-fill: #ebf6f4;
  --tint: rgb(15 20 19 / 0.05);
  --scrim: rgb(235 246 244 / 0.9);
  --red: #e04e2b;         /* orange-red: draw-mode accent and a pen color */
  --blue: #2b62e3;
  --marker: #ffd84a;
  --code-string: #2c6b5b;
  --code-const: #9a4a22;
}

[data-theme='ink'] {
  color-scheme: dark;
  --bg: #0d1211;
  --ink: #e6f2ef;
  --ink-2: #a6b5b1;
  --ink-3: #74827f;
  --ink-4: #46524f;
  --line: #232d2b;
  --fill: #e6f2ef;
  --on-fill: #0d1211;
  --tint: rgb(230 242 239 / 0.07);
  --scrim: rgb(13 18 17 / 0.9);
  --red: #ff6f52;
  --blue: #7da2ff;
  --marker: #ffd84a;
  --code-string: #8fd1bd;
  --code-const: #f0a57c;
}

[data-theme] {
  --shiki-foreground: var(--ink);
  --shiki-background: transparent;
  --shiki-token-keyword: var(--ink);
  --shiki-token-function: var(--ink);
  --shiki-token-parameter: var(--ink);
  --shiki-token-punctuation: var(--ink-2);
  --shiki-token-comment: var(--ink-3);
  --shiki-token-string: var(--code-string);
  --shiki-token-string-expression: var(--code-string);
  --shiki-token-constant: var(--code-const);
  --shiki-token-link: var(--blue);
}
```

The Paper values marked "sampled" come from the reference screenshots; the background reads `#ebf6f4` in all three. Treat them as correct unless a better source than video frames appears. The Ink theme is derived from Paper, not measured: the reference's Ink theme has not been seen.

### Type

DM Sans is loaded as a variable font with the optical-size axis; set `font-optical-sizing: auto` so large headings get the display cut. DM Mono is used at 400 and 500.

Slide type, in logical pixels on the 1600×900 stage, at the Regular text size. Every slide font size is `calc(<size> * var(--ts) * var(--density))`, where `--ts` is 0.7 (quiet), 1 (regular), or 1.25 (loud) from `data-text`, and `--density` is 1, 0.86, or 0.74 from `data-density`. Quiet reproduces the reference's sizes; Regular is about 1.4× larger so the deck reads from the back of a room. Mono roles never render below 11: use `max(11px, calc(...))`. Spacing given in `em` below follows the text size automatically.

| Role | Element | Size / line height | Weight | Tracking | Color |
|---|---|---|---|---|---|
| Display | `h1` | 80 / 1.02 | 500 | -0.015em | ink |
| Slide title | `h2` | 60 / 1.08 | 400 | -0.01em | ink |
| Subhead | `h3` | 30 / 1.15 | 500 | -0.01em | ink |
| Small subhead | `h4` | 22 / 1.2 | 500 | 0 | ink |
| Eyebrow | `h6` | 13 / 1.2, mono, uppercase | 500 | 0.14em | ink-2 |
| Body | `p`, `li` | 26 / 1.45 | 400 | 0 | ink |
| Lede | paragraphs under the `h1` in `title` and `section` | 27 / 1.5 | 400 | 0 | ink |
| Small | nested lists, column text, table cells | 21 / 1.4 | 400 | 0 | ink-2 |
| Caption, attribution, labels | `figcaption`, `.attrib`, `th` | 13 / 1.3, mono, uppercase | 400 | 0.12em | ink-2 |
| Code | `pre`, `code` | 20 / 1.5, mono | 400 | 0 | ink |
| Quote | `blockquote` in `quote` | 44 / 1.2 (32 / 1.3 above 140 characters, `data-len="l"`) | 400 | -0.01em | ink |
| Statement | `p` in `statement` | `xs` 240 / 0.9 · `s` 104 / 1.0 · `m` 72 / 1.08 · `l` 48 / 1.15 | 500 | -0.02em | ink |

Chrome type, in real CSS pixels:

| Role | Spec |
|---|---|
| Label | DM Mono 10px, uppercase, tracking 0.12em, `--ink-3`. Hover and active: `--ink`. Idle or disabled affordances: `--ink-4`. (The reference is about 9px; 10 is the floor here.) |
| Sublabel | DM Mono 9px, uppercase, tracking 0.12em, `--ink-3` |
| Control text | DM Sans 13px, weight 500, `--ink` |
| Help text | DM Sans 12px, `--ink-3` |

### Slide geometry

Safe margins on the stage: 128 left and right (8% of the width for other aspects), 112 top, 104 bottom.

| Layout | Composition |
|---|---|
| `default` | `.s-main` is a column `min(100%, calc(1700px * var(--ts)))` wide, centered horizontally in the safe area and filling its height. At Quiet this puts the left edge at about 13% of the width, as in the reference; at Regular and Loud it is the full safe area. Head on top; the body starts 0.6em (of the slide title's size) below it, max width 36em. `data-align="center"` centers the body vertically. `columns`, `figure`, and `gallery` use the same column. |
| `title`, `section` | A column `min(100%, calc(1080px * var(--ts)))` wide, centered horizontally, with its content centered vertically on the stage. Text stays left-aligned. At Quiet this puts the left edge at about 26% of the width, as in the reference. The paragraphs under the `h1` use the Lede role and sit in one block with a `--ink` rule on the left, 0.11em wide, and 1.05em of padding between rule and text. The block starts 1.57em below the heading (target: the top of the rule is about 0.7× the heading's font size below the heading's baseline). An eyebrow hangs above the heading and takes no space, so the heading and lede are what is centered. `section` shows `attr(data-section)` above the heading as an eyebrow, hanging the same way. |
| `statement` | Same centered column, `calc(1240px * var(--ts))` wide. A second paragraph becomes a caption (Caption role at 1.25× its size) 1.2em below. |
| `quote` | Same centered column, `calc(1160px * var(--ts))` wide. The blockquote has the same left rule (0.07em wide) and 0.8em of padding. Attribution 40 below, in caption style. No quotation-mark glyphs. |
| `columns` | Head on top. `.s-cols` is a grid of `data-count` equal columns (5 or 6 columns wrap to 3 per row), gap 56. Each column has a 1px `--ink` rule on top and 24 of padding above its content. Column text uses the Small role. |
| `split` | Two halves. The text half keeps the outer safe margin and a 72 inner margin, content centered vertically. The media half is full-bleed with `object-fit: cover`: to the stage edges, and beyond them to the edges of the stage area (§7 "Bleed"). With `data-imgfit="contain"` the media half gets 72 of padding and the image is contained. |
| `figure` | Head on top, the image fills the remaining safe area, contained, left-aligned. Caption below. |
| `image` | The image covers the whole stage area: the stage and its letterbox (§7 "Bleed"). The caption is placed from the stage, not from the picture's edge. A caption, if any, sits bottom-left on a `--bg` strip with 8×12 padding. |
| `gallery` | Optional head. Grid with 16 gaps: 2 → two columns, 3 → three, 4 → 2×2, 5–6 → 3×2. Images cover their cells. |
| `full` | No padding. Direct children fill the stage; an `iframe` is 100% × 100% with no border. |

Content elements (all layouts):

- **Bulleted lists**: the marker is a solid `--ink` square 0.3em on a side, vertically centered on the first line; 1.35em of indent; 0.65em between items. Nested lists use an en dash and the Small role.
- **Numbered lists**: the marker is the number in DM Mono, zero-padded (`counter(item, decimal-leading-zero)`), at 0.6em in `--ink-3`.
- **Blockquote** outside `quote`: left rule 0.11em wide, 1.05em padding, `--ink-2`.
- **Tables**: mono uppercase header in caption style, 1px `--line` under each row, 1px `--ink` under the header, no vertical lines, 14×20 cell padding, `font-variant-numeric: tabular-nums`.
- **Code blocks**: 1px `--line` border, 28×32 padding, `--tint` background. When any line is highlighted, the other lines drop to 45% opacity and highlighted lines get a `--tint` band.
- **Inline code**: mono at 0.88em on a `--tint` background with 0.1em×0.3em padding.
- **Links**: `--ink`, 1px underline, 0.18em offset. **Strong**: weight 700. **`mark`**: `--marker` background at 60%.
- **Footnotes** (`section.footnotes`): pinned to the bottom of the safe area, caption-sized sans text in `--ink-2`, with a 1px `--line` rule above. Hide the back-reference arrows and the "Footnotes" heading.
- **Background image** (`data-bg="image"`): the image covers the stage area (§7 "Bleed") under a `rgb(0 0 0 / 0.55)` scrim. A `bg` colour fills the same area.
- **Overflow flag** (`data-overflow`, dev only): a small `OVERFLOW` label in `--red`, mono, at the bottom-right of the slide.

### Chrome

| Element | Spec |
|---|---|
| Top bar | `--bar-top` (50px), transparent, 16px side padding. Left: 10×10 `--ink` square, 8px gap, deck title as a Label. Right: three 28×28 icon buttons with a 1px `--line` border, 6px apart, holding 13px icons: overview, fullscreen, settings. Hover turns the border `--ink`. A 1px `--line` hairline runs under the bar at full width. |
| Progress | A 1px `--ink` line on top of that hairline, from the left edge, width `(index + 1) / count`. |
| Bottom bar | `--bar-bottom` (46px), transparent, 20px side padding, 1px `--line` hairline above. Left: `←` `→` buttons in `--ink-4` (hover `--ink`), then the counter `01 / 36` as a Label with tabular numerals. Right: text buttons `NOTE` and `DRAW` as Labels in `--ink-4` (hover `--ink`). When zoomed, a `200%` Label appears before them and resets zoom on click. |
| Draw bar | Replaces the right side of the bottom bar in draw mode, as in the reference. A status Label `DRAW` in `--ink-4`, then tool names as Labels in `--ink-2`. The active tool has a 2px `--red` underline 4px below the text. Actions that are unavailable are `--ink-4`. `DONE` is `--red`. This is the only color in the chrome. |
| Icons | Inline SVG, 16×16 viewBox, 1px stroke, `stroke-linecap: square`, no fill, `currentColor`. Overview: a square divided 3×3. Fullscreen: four corner brackets. Settings: two horizontal lines each with a small square knob. |
| Auto-hide | `chrome: 'auto'`: bars are visible and docked in a window (the stage sits between them); in fullscreen they fade out after 2.5s without pointer movement and return on movement. `'always'` and `'hidden'` do what they say. Fading is opacity only. |
| Sheet (settings) | Centered, 432px wide, 40px from the top and bottom of the window (max height `100vh - 80px`), scrolls inside. 1px solid `--ink` border, `--bg` background, 18px padding. Backdrop is `--scrim`. Header row: `SETTINGS` Label left, `CLOSE` text button right. |
| Section label | A Label with 28px above and 10px below. |
| Segmented control | Equal-width cells in a row, 1px `--line` borders (shared between cells), 8px side padding. Each cell has Control text and a Sublabel under it, and every cell is 41px tall, so the controls in a sheet read as one family. (The reference leaves some controls without sublabels, at 30px; the owner asked for them all to match.) Selected: `--fill` background, `--on-fill` text, sublabel at 60% opacity. |
| Button | A Label in `--ink` with 8×12 padding and a 1px `--line` border. Hover: `--ink` border. Pressed: `--fill` background, `--on-fill` text. |
| Info rows | Bordered rows with a 96px Label column and a Control-text value, as in the reference's Directory / Media / Markdown block. |
| Focus | `:focus-visible { outline: 1px solid var(--ink); outline-offset: 2px }` everywhere. |

### Motion

| What | Spec |
|---|---|
| Slide change | Opacity cross-fade, `--t-med` |
| Build step | Opacity plus 8px upward translate, `--t-slow`, `--ease` |
| Theme change | `background-color` and `color`, `--t-med` |
| Sheets and overview | Opacity, `--t-fast` |

All durations become 0 when `data-motion="off"` or `prefers-reduced-motion: reduce`.

---

## 9. Phases

### Phase 0 — Scaffold, fonts, tokens

**Goal:** an empty app that proves the toolchain, the fonts, and both themes.

Tasks:

1. `git init`. `.gitignore` already exists and ignores `node_modules`, `dist`, `test-results`, `playwright-report`, `.DS_Store`, and `docs/reference/`. Keep it; never commit anything from `docs/reference/`.
2. `package.json`: `"type": "module"`, `"private": true`, `"packageManager": "pnpm@10.32.1"`, `"engines": { "node": ">=22.12" }`, the scripts from §2, and the dependencies from §2 (everything is a devDependency).
3. `vite.config.ts`: Svelte plugin, `base: './'`, alias `$shared` → `shared`. `svelte.config.js` with `vitePreprocess`. `tsconfig.json` (strict) covers `src` and `shared`; `tsconfig.node.json` extends it with Node types and covers `engine`, `shared`, `e2e`, and `*.config.ts`. Vitest configured for the `node` environment, matching `engine/**/*.test.ts`.
4. `index.html` with `<html lang="en" data-theme="paper">` and `<div id="app">`. `src/main.ts` imports the font CSS files listed in §2, then `tokens.css` and `base.css`, and mounts `App.svelte` with `mount()`.
5. `tokens.css` exactly as §8. `base.css`: a minimal reset, `html { background: var(--bg); color: var(--ink); font-family: var(--font-sans); font-optical-sizing: auto; -webkit-font-smoothing: antialiased }`, the focus rule.
6. `shared/types.ts` exactly as §5.
7. A placeholder `App.svelte`: the word `dex` in the Display role, a mono Label under it, and `t` toggles `data-theme` on `<html>`.
8. `CLAUDE.md` containing the ground rules from §3 and a pointer to `PLAN.md`.
9. `engine/scripts/start.mjs`: `createServer()` from `vite` with `server.open` set to `/#/<slug>` when an argument is given, else `true`; `listen()`, `printUrls()`, `bindCLIShortcuts({ print: true })`.
10. One trivial Vitest test so `pnpm test` has something to run.

Acceptance:

- `pnpm install`, `pnpm check`, and `pnpm test` succeed with no errors.
- `pnpm start` serves the page; `curl -s localhost:5173` returns the HTML.
- In the browser, the heading is DM Sans and the label is DM Mono (check `document.fonts`), the background is `rgb(235, 246, 244)`, and `t` switches to the Ink colors.
- The network panel shows no request to any host other than `localhost`.

### Phase 1 — Compiler

**Goal:** `compileDeck()` implements §4–§6 completely, proven by tests. No browser work.

Tasks:

1. Implement the modules listed under `engine/compiler/` per §6.
2. Write `decks/demo/deck.md`, the kitchen-sink deck. It must contain, in this order: title; statement; section; bullets with `+` builds; numbered list with a nested list; columns from `###`; columns from `|||`; split with the image on the right; split with the image on the left and `fit: contain`; figure; full-bleed image with a caption; gallery of three; quote with attribution; big number; code with highlighted lines; table; paragraphs separated by `. . .`; an `invert` slide; a `bg` image slide; a slide with a footnote; a `skip` slide; an overflow stress slide (14 long bullets); a closing title. Every slide has a speaker note saying what it demonstrates.
3. Demo media: create four abstract SVGs in `decks/demo/media/` (`plate-1.svg` … `plate-4.svg`): simple geometric compositions of squares, grids, and lines in `#0f1413` on `#dce9e6`, 1600×1000. No downloaded images.
4. Tests, one file per module:
   - `frontmatter`: none; valid; unknown key warns; invalid YAML throws `DexCompileError` with a line.
   - `split`: basic; `---` inside a backtick fence and inside a tilde fence; `---` directly under a text line still splits; leading and trailing separators produce no empty slides; `line` numbers are right with and without frontmatter.
   - `comments`: single directive; several pairs with commas; multi-line; bad value warns; unknown key becomes a note and warns; plain note; two notes are joined; Markdown in notes renders.
   - `builds`: `+` list; `-` list does not build; deck `build: true`; slide `build: false` beats `+`; pause marker; pause followed by a `+` list numbers correctly; nested items carry no step; `steps` is right.
   - `layout`: every row of the fixture table in §6.
   - `regions`: the HTML shape for every layout matches the contract table.
   - `media`: figure and caption; several images in one paragraph; video with flags; URL rewriting for each kind of URL; `assets` is collected.
   - `index`: ids, duplicate ids, `id` directive, section numbering, title fallback, hash stability (same input → same hash; changing one slide changes only that slide's hash), and a snapshot of the compiled demo deck.

Acceptance:

- `pnpm test` passes. `pnpm check` passes.
- Compiling the demo deck gives 23 slides and zero warnings.
- A second compile of the demo deck after changing one slide runs the Markdown pipeline once (assert with a counter or spy on the per-chunk function).

### Phase 2 — Vite plugin, dev server, scripts

**Goal:** the engine serves compiled decks in dev and emits them in the build.

Tasks, in `engine/vite-plugin.ts` (exported as `dex()` and added to `vite.config.ts`):

1. **Discovery.** A deck is any `decks/<slug>/deck.md` where the slug matches `/^[a-z0-9][a-z0-9-]*$/`.
2. **Dev middleware** in `configureServer`:
   - `GET /decks/index.json` → `DeckSummary[]`, sorted by `modified` descending.
   - `GET /decks/<slug>/deck.json` → the compiled `Deck`, from a per-slug cache. On `DexCompileError`, respond 500 with `{ error, line }`.
   - `PUT /__dex/marks/<slug>` → validate the slug with the regex above, cap the body at 5 MB, parse it as JSON, write `decks/<slug>/marks.json` with two-space indentation. Respond 204.
   - Send `Cache-Control: no-store` on all three.
3. **Watching.** On add, change, or unlink of a `deck.md`: recompile, update the cache, `server.hot.send('dex:update', { slug })`; on compile error send `dex:error` with `{ slug, error, line }`. When the set of decks changes, also send `dex:index`. In `handleHotUpdate`, return `[]` for any file under `decks/` so Vite never reloads the page for deck files or `marks.json`.
4. **Terminal output.** Print each warning once per compile as `demo:12  unknown directive "layuot"`. After compiling, check every path in `deck.assets` exists and print `demo  missing file media/desk.jpg` for those that do not.
5. **Build.** In `generateBundle`, emit `decks/index.json` and each `decks/<slug>/deck.json` as assets, and emit every other file inside each deck folder (except `deck.md`) at the same relative path.
6. `engine/scripts/new.mjs`: `pnpm new <slug>` validates the slug, refuses to overwrite, and writes `decks/<slug>/deck.md` from a starter template of five slides (title, bullets with builds, split with a placeholder comment where the image goes, quote, closing) with a short comment at the top pointing to the README.

Acceptance:

- With `pnpm start` running: `curl localhost:5173/decks/index.json` lists `demo`; `curl localhost:5173/decks/demo/deck.json` returns the deck; `curl localhost:5173/decks/demo/media/plate-1.svg` returns the SVG.
- `curl -X PUT -d '{"version":1,"slides":{}}' localhost:5173/__dex/marks/demo` returns 204 and the file exists. A slug containing `..` or `/` returns 400 and writes nothing.
- Breaking the frontmatter YAML makes `deck.json` return 500 with a line number, and fixing it recovers without restarting.
- `pnpm build` produces `dist/decks/index.json`, `dist/decks/demo/deck.json`, and `dist/decks/demo/media/plate-1.svg`.
- `pnpm new scratch` creates the deck; running it again fails with a clear message. Delete `decks/scratch` afterwards.

### Phase 3 — Runtime shell

**Goal:** the deck is presentable: slides render on the scaled stage, navigation and builds work, the chrome is in place, and saving `deck.md` updates the page. Slide styling is only basic here; Phase 4 does the design.

Tasks:

1. `router.ts`, `deck` state (fetch `decks/index.json` and `decks/<slug>/deck.json` with relative URLs and `cache: 'no-store'`), `DeckIndex.svelte` (a plain list of decks as bordered rows: title, slide count, modified date).
2. `Stage.svelte` and `lib/stage.ts` per §7. Export `clientToStage(event)` for later phases, implemented with the overlay's `getScreenCTM().inverse()` so it stays correct under stage scale and camera transforms.
3. `SlideView.svelte`: props `slide`, `step`, `revealAll`. Renders the element from the HTML contract, toggles `is-pending`, runs auto-fit, plays and pauses `video[data-autoplay]`. Apply `slide.attrs.style` as the element's `style` and every other key in `attrs` as an attribute. Before calling `play()`, set `video.muted = video.hasAttribute('muted')`, because `muted` set through `{@html}` does not always take effect. Code blocks are focusable (`<pre tabindex="0">`); navigation keys must keep working when focus is inside a slide.
4. `nav` state with the rules in §7, hash sync, clamping when the deck changes.
5. `commands.ts` and `keys.ts` with the full table from §7. Implement the Phase 3 commands; the rest are registered with empty `run` functions.
6. `settings` and `ui` state with every field from §5 and §7, persisted where specified.
7. `TopBar`, `BottomBar`, `Icon`, progress line, chrome auto-hide, fullscreen (`f`, and the top-bar button), theme toggle, effective theme on `<html>`.
8. Live reload, per the server contract in §7: `import.meta.hot.on('dex:update', …)` refetches the deck (and the deck index refetches on both `dex:update` and `dex:index`) and keeps the current slide by `id` when it still exists, otherwise clamps the index. With `settings.followEdits` on, jump to the first slide whose `hash` changed. `dex:error` shows `ErrorOverlay` (a mono `--red` line at the bottom-left with the message and line, dismissible) and keeps the last good deck.
9. Create every remaining component from the §7 skeleton as a stub, and mount them in `App.svelte`.
10. Basic slide CSS in `slide.css`: safe-area padding, the type roles from §8 for headings and body, `is-pending`, the `.current` fade. Enough to read the demo deck.
11. `playwright.config.ts` with a `webServer` that runs the dev server on a fixed port, Chromium only, viewport 1600×900. The `webServer` command is `vite --port <port> --strictPort`, not `pnpm start`, so no browser tab opens on the owner's machine. On a machine or worktree where Chromium is not installed yet, run `pnpm exec playwright install chromium` once. `e2e/smoke.spec.ts` covering the acceptance list.
12. Compile warnings in the browser, dev only: when `deck.warnings` is not empty, log each one with `console.warn` and show a Label in `--red` in the bottom bar, `N WARNINGS`. Clicking it lists them (slide number, line, message); clicking a row goes to that slide. This is how an author finds out about a typo in a directive or an unclosed comment without watching the terminal.
13. A deck with no slides shows a centered Label, `NO SLIDES YET`, with the deck's file path under it, and still live-reloads.

Acceptance (as Playwright tests where possible):

- Opening `/` goes to the demo deck. The counter reads `01 / NN`.
- `→` on the bullets slide reveals one item per press, then moves on. `←` returns to the previous slide fully revealed. `↓` skips builds.
- The hash updates to `#/demo/<n>`, and reloading stays on that slide.
- The `skip` slide is never shown by `→` or `←`.
- `t` flips `data-theme` on `<html>`; the `invert` slide shows the opposite theme and the bars follow.
- Resizing the window keeps the stage centered and fully visible at 1600×900, 1280×720, 1024×900, and 2560×1080.
- A test edits a temporary deck file on disk and the new text appears without a page load (assert `performance.getEntriesByType('navigation')` is unchanged). With follow-edits on, the edited slide becomes current.
- `pnpm check`, `pnpm test`, `pnpm test:e2e` pass.

Gotchas: wait for `document.fonts.ready` before measuring. Use `history.replaceState` for hash updates so Back does not step through slides. Fullscreen must be requested from the key or click handler itself.

### Phase 4 — Slide design

**Goal:** every layout looks finished in both themes at all three text sizes. This is the phase that decides whether the tool looks good; hold it to §8 exactly.

Tasks:

1. `slide.css`: all content elements from §8. Footnotes (`section.footnotes`) are a sibling of `.s-main`, not inside it, so position them against the slide. Add a visually-hidden `.sr-only` rule; the footnotes heading uses it. For the dev-only `OVERFLOW` label, have `App.svelte` set `data-dev` on `.app` when `import.meta.env.DEV`, and draw the label with `.app[data-dev] .slide[data-overflow]::after`.
2. `layouts.css`: one block per `data-layout`, per the geometry table. Derive every position from `--W`, `--H`, and the margin variables so 16:10 and 4:3 also work.
3. `code.css`: code blocks, line highlighting, inline code. Shiki writes `background-color: var(--shiki-background)` inline on every `pre`, which beats a stylesheet `background`; set `--shiki-background` on `pre.shiki` instead.
4. Density and text-scale variables wired into every font size.
5. `e2e/shots.spec.ts` (run by `pnpm shots`): for the demo deck, screenshot the stage for every slide in Paper and Ink at 1600×900 with builds fully revealed, into `docs/shots/<theme>/<nn>-<id>.png`. Also three slides at `quiet` and `loud`. Keep this spec out of `pnpm test:e2e` (a `testIgnore` in the default run, or its own Playwright project), so the smoke tests stay fast and `pnpm shots` is the only thing that writes to `docs/shots/`.
6. Chrome over background images. On a `bg` image slide the chrome sits on the picture and its labels disappear (seen in Phase 3 with the demo's light image). Raise the scrim to `rgb(0 0 0 / 0.55)`. When the current slide has `data-bg="image"`, set `data-over-image` on `.app` and step the chrome labels up one level there (`--ink-3` → `--ink-2`, `--ink-4` → `--ink-3`); the hairlines stay.
7. Review loop: run `pnpm shots`, open every image, fix, repeat. Compare, at the Quiet text size, the title slide with `docs/reference/maeda-title.png` and a default slide with `docs/reference/maeda-draw.png`, using the reference measurements in §8.

Acceptance:

- `pnpm shots` writes one image per slide per theme.
- At Quiet, the title slide matches the reference measurements in §8 within about 5%: heading size, lede size, rule and its padding, left edge at about 26% of the width, block vertically centered. A default slide's title starts at about 13% of the width, in regular weight.
- In every image: nothing is clipped; text stays inside the safe margins (full-bleed media excepted); left edges align within a layout; nothing is centered that §8 says is left-aligned; no rounded corners, shadows, or stray colors.
- No demo slide other than the overflow stress slide has `data-density` above 0 or `data-overflow`. The stress slide settles at density 1 or 2 without `data-overflow`.
- A deck with `aspect: 4:3` renders the demo's title, default, split, and columns slides without clipping (temporary deck, screenshots attached to the commit message or §11).
- Ink theme: every text color and rule is legible; the code block and table follow the theme.
- The executor lists in §11 any place where the result differs from §8 and why.

### Phase 5 — Settings sheet, overview, source view

**Goal:** everything that can be toggled is one key or one sheet away.

Tasks:

1. `Segmented.svelte`: props `options: { value, label, sublabel? }[]`, bindable `value`. Arrow keys move the selection.
2. `SettingsSheet.svelte` (`s`, `,`, or the settings icon), per the §8 sheet spec, with these sections in order:

   | Section | Control |
   |---|---|
   | THEME | Paper (light) · Ink (dark) |
   | TEXT | Quiet (screen share; the reference's size) · Regular (most rooms) · Loud (big rooms) |
   | BUILDS | On (step through lists) · Off (show everything) |
   | MOTION | On (fades and reveals) · Off (instant) |
   | CHROME | Auto (hides in fullscreen) · Always · Hidden |
   | MARKS | Shown (drawings and notes) · Hidden (kept, not shown), then buttons `CLEAR THIS SLIDE` and `CLEAR ALL` (wired in Phase 6) |
   | FOLLOW EDITS | On (jump to the slide you are editing) · Off — only rendered when `import.meta.env.DEV` |
   | KEYS | The cheat sheet generated from the command registry, as Help text: `← → move · space build · g slides · …` |
   | DECK | Info rows: deck (a `<select>` of all decks; changing it navigates), slides, source path. Buttons `PRESENTER` and `PRINT / PDF` (wired in Phases 8 and 9). |

3. `Overview.svelte` (`g` or the overview icon): a full-window overlay on `--bg`. A grid of thumbnails, `repeat(auto-fill, minmax(260px, 1fr))`, gap 24. Each thumbnail is a real `SlideView` with `revealAll`, scaled by CSS transform inside a box with the stage's aspect ratio and a 1px `--line` border, `inert`, with `content-visibility: auto`. Under it, a Label: the zero-padded number and the title. The current slide has an `--ink` border. Skipped slides are at 40% opacity with a `SKIP` Label. Arrow keys move the selection, `Enter` or click opens the slide, `g` or `Esc` closes. Opening scrolls the current slide into view.
4. Go to slide: typing digits shows them as a Label in the bottom bar (`GO TO 12`); `Enter` jumps; `Esc` or 1.5s of no input cancels. `0` is also zoom reset (Phase 7), so a `0` typed with no digits buffered is not a go-to digit; the `goto` command's `when` claims digits and `Enter` only in the cases that belong to it.
5. `SourceView.svelte` (`m`): replaces the stage content with the current slide's `source` in DM Mono, 22 logical px, inside the safe area, with a `MARKDOWN` Label above it. Navigation still works.
6. `Esc` ordering per §7.

Acceptance:

- Every control changes the app immediately and survives a reload. Text size changes all slide type. Builds off shows every item at once. Motion off removes all transitions.
- The overview shows all slides including the skipped one, and keyboard selection plus `Enter` lands on the chosen slide.
- `1`, `2`, `Enter` goes to slide 12.
- The sheet matches `docs/reference/maeda-settings.png` in structure and in the sizes given in §8: bordered sheet, mono section labels, segmented controls with ink-filled selection. Take a screenshot in each theme into `docs/shots/` and review it.
- Focus is trapped in the sheet while it is open and returns to the page on close.

### Phase 6 — Marks: draw, sticky notes, laser

**Goal:** write on a slide and stick notes to it while presenting; marks stay with the slide and survive reloads.

Storage:

- `marks` state loads `decks/<slug>/marks.json` (missing → empty). In dev, every change is saved with a debounced (500ms) `PUT /__dex/marks/<slug>`. In a static build, changes are saved to `localStorage` under `dex:marks:<slug>`, which overrides the bundled file on load.
- Marks are keyed by `Slide.id`. Marks for ids that no longer exist stay in the file untouched.
- Undo and redo are in-memory stacks of inverse operations for: add stroke, remove stroke, clear strokes, add note, remove note, edit note.

Drawing (`DrawLayer.svelte`, `DrawBar.svelte`):

- An `<svg viewBox="0 0 W H">` inside `.camera`, above the slides. `pointer-events: none` unless the draw tool is active; then `touch-action: none` and a crosshair cursor.
- On pointer down, capture the pointer and collect `[x, y, pressure]` in stage coordinates (use `getCoalescedEvents()` when available). Render the live stroke; commit it on pointer up. Ignore strokes with fewer than two points.
- Each pen or marker stroke is a filled `<path>` from `getStroke(points, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: pointerType !== 'pen' })`, converted to path data with the quadratic-curve helper from the `perfect-freehand` README.
- Pen: color token (`ink` follows the theme), sizes 4, 6, 10 cycled with `[` and `]`. Marker: size 28, `thinning: 0`, `--marker` at 45% opacity, `mix-blend-mode: multiply` on Paper and `screen` on Ink. Eraser: while the pointer is down, remove any mark under it (`document.elementFromPoint`; marks get `pointer-events: visiblePainted` in eraser mode).
- Arrow and box: press, drag, release. `points` holds exactly two entries, start and end. An arrow is a straight line `size` wide with round caps and a two-stroke head whose arms are `max(14, size * 3)` long at ±28° from the shaft. A box is an unfilled `<rect>` with a `size`-wide stroke. Show the shape live while dragging; discard drags shorter than 8.
- In draw mode the right side of the bottom bar becomes the draw bar, styled per the Draw bar row in §8: `DRAW`, then `PEN` `MARKER` `ARROW` `BOX` `ERASER`, three 10×10 color squares (ink, red, blue; the active one has a 1px outline offset 2px), `UNDO`, `CLEAR`, `DONE`. `UNDO` and `CLEAR` are `--ink-4` when there is nothing to undo or clear.
- `d` toggles draw mode. `c` clears the current slide's strokes. Navigation keys still work while drawing.

Sticky notes (`NotesLayer.svelte`, `StickyNote.svelte`):

- `n` adds a note at the pointer's stage position, or at the stage center if the pointer is outside, and focuses it for typing. The `NOTE` button in the bottom bar arms note mode: the next click on the stage places a note.
- A note is 220×220 by default, background from its color token, text in DM Sans 22 / 1.3 in `--note-ink`, 16 padding, square corners, and the one permitted shadow: `0 1px 0 rgb(0 0 0 / 0.08), 0 10px 24px -14px rgb(0 0 0 / 0.35)`. It grows downward with its text.
- Not editing: drag anywhere on the note to move it (clamped to the stage); click selects it (1px `--note-ink` outline); `Delete` or `Backspace` removes the selected note; double-click or `Enter` edits. When selected, a small row above the note shows three color squares and a `×`.
- Editing: a `<textarea>` filling the note. `Esc` or clicking outside finishes. An empty note is removed when editing ends. The default `editing` layer in the Esc chain only clears `ui.editing`; replace it with `onEscape('editing', ESCAPE_RANK.editing, …)` so that ending an edit with `Esc` also removes an empty note.
- Notes are inside `.camera`, so they scale and zoom with the slide.

Laser (`Laser.svelte`): `l` toggles. A 14px `--red` dot follows the pointer with a short fading trail (the last 12 positions). Nothing is stored. The system cursor is hidden while it is on. `Laser` is mounted outside `.camera`, so position it from the pointer's offset within `.stage` divided by the stage scale, not from `clientToStage` (which returns camera-space coordinates and would drift once zoom exists).

Also: `a` and the MARKS setting hide or show both layers. The overview shows a small solid square next to the number of any slide that has marks; it goes in the thumbnail's `.caption`, beside `.num`.

Clearing, three scopes:

- `c` and the draw bar's `CLEAR` remove the current slide's **drawings** (strokes, arrows, boxes). Sticky notes stay. Fill the `clear` command with this.
- The sheet's `CLEAR THIS SLIDE` removes the current slide's drawings **and** its sticky notes. Phase 5 wired that button to the `clear` command; point it at a new `clearSlideMarks()` in `marks.svelte.ts` instead.
- The sheet's `CLEAR ALL` removes every slide's marks, after a second click on a `CONFIRM` state. Fill the `clearAllMarks()` stub Phase 5 left in `marks.svelte.ts`.

All three are undoable.

Acceptance (Playwright):

- Draw a stroke with the mouse: a path appears; reload: it is still there; `decks/demo/marks.json` contains it. Use a temporary deck in tests so the demo's marks file stays clean.
- `⌘Z` removes it, `⇧⌘Z` restores it. `c` clears, undo restores.
- The eraser removes only the stroke it touches.
- An arrow and a box can be drawn, survive a reload, undo and redo, and can be erased.
- The draw bar matches `docs/reference/maeda-draw.png`: muted tool names, a `--red` underline on the active tool, `DONE` in `--red`.
- A stroke drawn at one window size sits on the same slide content after resizing the window.
- `n` creates a note with focus in it; typing `g` or `t` inside the note does not trigger commands. Dragging moves it; reload keeps text, position, and color. Emptying it deletes it.
- Moving to another slide shows that slide's marks only.
- Changing a slide's position in `deck.md` keeps its marks attached (same `id`).

### Phase 7 — Zoom and pan

**Goal:** zoom into any part of a slide and move around while zoomed.

Tasks:

1. `ui.camera = { k, x, y }` drives `transform: translate(x px, y px) scale(k)` on `.camera`, origin `0 0`. Clamp `k` to 1–6, `x` to `[W·(1−k), 0]`, `y` to `[H·(1−k), 0]`.
2. Zoom at a point: keep the stage point under the cursor fixed (`x' = px − (px − x)·k'/k`, same for `y`, with `px` in stage coordinates before the camera).
3. Inputs: `Ctrl`/`⌘` + wheel and trackpad pinch (a `wheel` event with `ctrlKey`), `k *= exp(−deltaY · 0.01)`, anchored at the cursor. The listener must be registered with `{ passive: false }` and call `preventDefault()` so the browser does not zoom the page. When zoomed, a plain wheel event pans. `z` toggles between 1× and 2× at the pointer. `+` and `-` step by 1.25× at the pointer. `0` resets.
4. When zoomed and no tool is active, dragging pans (grab cursor).
5. Animate key-triggered zooms over `--t-med`; wheel and drag are immediate.
6. The bottom bar shows the zoom percentage while `k > 1`; clicking it resets. Navigation resets the camera.
7. Confirm `clientToStage` still returns correct coordinates when zoomed: drawing and note placement must land under the cursor.

Acceptance:

- `z` zooms to 200% around the pointer and again returns to 100%. Pinch and `⌘`-wheel zoom smoothly around the cursor without the browser's own zoom changing.
- The slide can never be panned so that empty space shows inside the stage.
- A stroke drawn while zoomed stays on the same content after resetting zoom.
- Changing slide resets zoom.

### Phase 8 — Presenter view, notes, timer, blackout

**Goal:** a second window for the speaker that drives the audience window.

Tasks:

1. `sync.ts`: a `BroadcastChannel` named `dex:<slug>` carrying `SyncMessage`. Every window applies incoming `nav`, `theme`, `blackout`, and `marks` without re-broadcasting them. A new window sends `hello`; windows that receive it reply with their current `nav`, `theme`, and `blackout`. Only the window where a mark was made saves it.
2. `p` (and the `PRESENTER` button in settings) opens `#/<slug>/presenter` with `window.open(url, 'dex-presenter', 'width=1280,height=800')`.
3. `PresenterView.svelte`, on `--bg`, 24px padding, in two columns:
   - Left (about 62%): the current slide in a 1px `--line` frame, at its current build step. Under it, Labels: `SLIDE 07 / 36` and `STEP 2 / 4` when the slide has builds.
   - Right: the next slide, smaller, labelled `NEXT` (or `END` on the last slide); the timer in DM Mono 40px (`00:12:34`, starts on the first navigation, click to pause, double-click to reset) with the wall-clock time as a Label beside it; then the notes, in DM Sans 22px / 1.5, scrollable, with `NO NOTES` as a Label when empty.
   - All navigation keys work here and drive the audience window. The overlays (settings, overview, source) are not mounted on this route, so give their commands a `when` that is false here; otherwise `s`, `g` and `m` change state nothing shows.
4. `Blackout.svelte`: `b` or `.` covers the window with solid `#000`; any key or click clears it. Synced. "Any key" must be handled in `keys.ts` before the command lookup: while blackout is on, the next key clears it and does nothing else. Otherwise a digit would start a go-to, and `Esc` would close other layers first.

Acceptance (Playwright with two pages in one browser context):

- Navigating in the presenter page moves the deck page, and the reverse.
- The presenter shows the right notes for each slide, rendered as HTML, and the right next slide.
- The timer starts at the first navigation, pauses and resets.
- Blackout in either window blacks out the deck window.
- A stroke drawn in one window appears in the other.

### Phase 9 — Print/PDF and static export

**Goal:** a PDF from the browser's print dialog, and a `dist/` folder that works anywhere.

Tasks:

1. `PrintView.svelte` at `#/<slug>/print`: every non-skipped slide in order as its own block, using `SlideView` with `revealAll`, each with its own `data-theme`. A bar at the top (hidden when printing) with a `PRINT` button and toggles for including marks and skipped slides.
2. `print.css`: `@page { size: 1600px 900px; margin: 0 }` (use the deck's stage size), each slide block exactly that size with `break-after: page`, `print-color-adjust: exact`, chrome hidden. A mono page number in the bottom-left safe margin of each page.
3. The `PRINT / PDF` button in settings opens the print route in a new tab (`window.open`), so the deck stays where it is. Phase 5 wired it to navigate in the same window; change that.
4. Static build: confirm `pnpm build && pnpm preview` runs the full deck from `dist/` with relative URLs only, that marks fall back to `localStorage`, that the FOLLOW EDITS control is absent, and that `dist/` also works when served from a subpath.
5. Add a `<noscript>` line to `index.html`.

Acceptance:

- A Playwright test calls `page.pdf({ preferCSSPageSize: true, printBackground: true })` on the print route: the page count equals the number of non-skipped slides, and the first page's size is 1600×900 CSS pixels.
- The PDF shows the Paper background color, not white, and all build steps revealed.
- `pnpm preview` passes the Phase 3 navigation tests (run the smoke spec against the preview server, minus the live-reload test).
- Serving `dist/` from a subdirectory (`npx serve` on the parent folder is fine) loads the deck and its images.

### Phase 10 — QA, polish, README

**Goal:** it holds up in a real presentation, and a new deck can be written from the README alone.

Tasks:

1. **Design review** against `docs/reference/` and §8, in both themes: check every chrome element's size, tracking, and color against the reference measurements; check hover, pressed, focus, and disabled states on every control; check spacing is on a 4px grid in the chrome. Fix what is off and list what was changed in §11.
2. **Presentation rehearsal** with the demo deck, fullscreen at 1920×1080: go through every slide with a clicker's keys (`PageDown`, `PageUp`, `b`), draw, add notes, zoom, open the presenter window, toggle the theme mid-deck. Fix anything that stutters, flashes, or loses state.
3. **Robustness:** an empty `deck.md`; a deck with only frontmatter; a 150-slide deck (generate it; navigation and overview stay responsive, a one-slide edit shows in under 300ms); a missing image (broken-image box styled as a 1px `--line` frame with the path as a Label); very long words; an unknown code language; right-to-left text is out of scope.
4. **Accessibility:** every control reachable by keyboard with visible focus; `aria-label` on icon buttons; sheets are `role="dialog"` with `aria-modal`; the slide region has `aria-live="polite"` and `aria-roledescription="slide"`; `prefers-reduced-motion` respected.
5. **README.md:** install and start; "your first deck" in ten lines; the authoring format from §4 rewritten for a reader, with the example deck; the key table; presenting tips (presenter window, clicker, PDF, static export). Keep it under 250 lines.
6. Make `decks/demo` a good first impression: retitle it "dex" and rewrite its text so that reading the deck teaches the tool.

Acceptance:

- All checks pass: `pnpm check`, `pnpm test`, `pnpm test:e2e`, `pnpm shots`, `pnpm build`.
- A person who has not seen this plan can run `pnpm new talk`, write five slides with an image from the README alone, and present them.
- The §11 log is complete, and every phase in §0 is ticked.

---

## 10. Backlog (after v1)

- Math (KaTeX) and diagrams (Mermaid), loaded only when a deck uses them.
- `pnpm pdf <slug>`: PDF export from the command line with Playwright.
- Drop an image on the window to copy it into the deck folder and put the Markdown for it on the clipboard.
- Lists as boxes: a toggle that renders two-to-four-item lists as a row of bordered boxes (Maeda's "consultancy mode").
- Code stepping: reveal or highlight code lines across build steps.
- Decks outside the repo: `DEX_DECKS=/path pnpm start`.
- `split: heading` frontmatter option to start a slide at every `#` or `##` with no `---`.
- Touch: swipe to navigate, pinch to zoom.
- Phone remote over the local network.
- Sync the laser pointer to the audience window.
- Export a slide with its marks as a PNG.

---

## 11. Open decisions and deviations

### Decisions made in this plan that the owner may want to flip

| Decision | Chosen | Alternative |
|---|---|---|
| UI framework | Svelte 5 | React. The compiler, plugin, data model, and CSS would be unchanged; §7 and the component tasks would be rewritten. Decide before Phase 3. |
| Canvas | Fixed 1600×900 stage scaled to fit: between the bars in a window, the whole screen in fullscreen. Full-bleed pictures and backgrounds extend past the stage to fill whatever shape the window is. | Fluid layout that reflows with the window, as Maeda's appears to. Rejected because marks, zoom, thumbnails, and PDF all depend on fixed coordinates. |
| Default type size | `Regular`, about 1.4× the reference's type, for legibility in a room. `Quiet` reproduces the reference's sizes. | Make `Quiet` the default. One-line change in `DEFAULT_SETTINGS`. |
| Marks storage | `decks/<slug>/marks.json`, written by the dev server, so marks survive browsers and can be committed | Browser storage only. Add `marks.json` to `.gitignore` if they should stay local. |
| Color in the UI | One accent, orange-red, and only in draw mode (the active tool's underline and `DONE`), as in the reference. Otherwise red and blue exist only as pen colors; yellow, pink, and blue only as sticky notes. | Use the accent elsewhere in the chrome, or nowhere. |
| Draw tools | Pen, marker, arrow, box, eraser. Arrow and box were added because the reference's draw bar has them. | Drop arrow and box to make Phase 6 smaller. |

### Deviations log

Executors: add a line here whenever the implementation differs from this plan. Format: `Phase N — what changed — why`.

- Phase 0 — `tsconfig.json` sets `"types": ["vite/client"]`, `moduleResolution: "bundler"`, and `paths` for `$shared/*` (no `baseUrl`, which TypeScript 6 deprecates).
- Phase 0 (follow-up by the planner) — the plan omitted `@types/node`, so no `node:*` import under `engine/` could type-check. Added `@types/node` ^22 to §2 and split type checking: `tsconfig.json` now covers only `src/` and `shared/`; a new `tsconfig.node.json` extends it with Node types and covers `engine/`, `shared/`, `e2e/`, and `*.config.ts` (so `vite.config.ts` is now checked). `pnpm check` runs `svelte-check` and then `tsc -p tsconfig.node.json`. Ground rule 13 records the boundary.
- Phase 0 — the `new` script points at `engine/scripts/new.mjs`, which Phase 2 creates; `test:e2e` and `shots` point at Playwright files Phase 3/4 create. They fail until then.
- Phase 1 (follow-up by the planner) — three authoring hazards found by probing the compiler, fixed with tests. (1) A deck that began with `---`, a first slide of headings or text, then `---` lost that slide, because the block was read as frontmatter (`# Title` is a YAML comment); a leading block is now frontmatter only if it is blank or a key: value map. (2) Any note that started with a lowercase word and a colon (`todo: fix this`) warned as an unknown directive; warnings are now limited to near misses and to unknown keys mixed with real ones, and name the likely key. (3) A `---` line inside a multi-line comment splits the slide and used to pass silently; the unclosed comment now warns and its text is kept as a note. §4 and §6 are updated to match, along with the Phase 1 refinements below. §5 and `shared/types.ts` gained two clarifying comments (no type change).
- Phase 1 — builds: a pause takes effect at the next block that needs a step, not immediately. Literal §6 gives `Intro` / `. . .` / `+ a` / `+ b` the steps `ul=1, a=2, b=3`, so the first click after the pause reveals an empty list; now it is `ul=1, a=1, b=2` (`steps` 2). The same rule means a trailing pause, or several pauses in a row, add no empty step. Blocks after a pause still take the counter at their position, as specified.
- Phase 1 — markers: before parsing, every line that is exactly `. . .` or `|||` (outside fenced code) gets blank lines around it, so a marker written directly under a line of text is still a marker (§4 says "a line containing only `|||`"; §6 step 3 only removes whole paragraphs, which a lazy continuation line is not). Warning lines are mapped back to the original lines.
- Phase 1 — comments: a segment is "directive-shaped" only when its key is a lowercase identifier (`/^[a-z][a-z0-9_-]*\s*:/`), so a note such as `Remember: slow down` is a note without a warning, while `layuot: statement` still warns. Commas inside parentheses do not split segments, so `bg: rgb(0, 0, 0)` works.
- Phase 1 — `title` vs `section`: the per-chunk cache cannot know a slide's position, so a chunk whose inferred layout is `section` is turned into `title` in the assemble step when it is slide 1 (the HTML is the same for both). As with `data-section`, moving a slide to or from the front does not change its `hash`.
- Phase 1 — code highlighting: `rehype-raw` drops hast `data`, which is where `remark-rehype` puts the fence meta, so ` ```ts {2} ` highlighted nothing in the §6 pipeline order. The compiler copies the meta to `hProperties.metastring`, which `@shikijs/rehype` also reads. Shiki also gets `defaultLanguage: 'text'` so fences without a language get the same `pre.shiki` markup, and an unknown language warns (`unknown code language "x"; shown as plain text`).
- Phase 1 — raw HTML blocks after a pause are wrapped in `<div data-step="n">`, because raw nodes cannot carry properties.
- Phase 1 — HTML contract details the table leaves open: the head (eyebrow and/or first h1–h2) is emitted in every layout except `full`, including `quote`; `image` gets a `.s-main` only when it has a head or other text; `figure` and `gallery` omit an empty `.s-main`; non-media blocks forced into a media layout by a directive go in `.s-body`. A layout of `columns` set by directive with neither `|||` nor `###` makes one column. Empty `|||` segments are dropped. GFM footnotes stay as the `<section class="footnotes">` sibling after the regions, and footnote ids are prefixed per slide (`clobberPrefix: fn-<hash>-`) so that the three rendered slides never share ids; the `footnote-label` heading id is not prefixed by `remark-rehype`.
- Phase 1 — `CompileWarning.slide` is the 0-based slide index (like `Slide.index`); frontmatter warnings use `slide: -1`. `line` is always 1-based in deck.md. `Slide.line` is the chunk's first non-blank line and `Slide.source` excludes the blank lines around it. An empty slide (only comments) warns `empty slide`.
- Phase 1 — `id` directive values go through the same per-deck `github-slugger` as titles, so they are slugified and de-duplicated (`id: Intro` → `intro`).
- Phase 1 — small additions: frontmatter without a closing `---` is not frontmatter (the leading `---` is a slide break); YAML error messages drop the YAML-relative "at line N" text since `DexCompileError.line` is the deck.md line; relative paths that leave the deck folder (`../x.png`) are left unchanged and warn; a video's alt text minus the flag words becomes its `aria-label`; the `bg` style is written `--slide-bg: url("…")` with quotes. `Slide.attrs` holds `style` as well as `data-*` (as §6 says; §5's comment says only `data-*`).
- Phase 1 — `@types/mdast` and `@types/hast` are only transitive dependencies, which pnpm does not hoist, so `import type … from 'mdast'` does not resolve. A new `engine/compiler/ast.ts` derives the mdast types from the parser's signature and describes hast structurally; no dependency added. `index.ts` exports `compileStats` (a counter of uncached chunk compiles, used by the cache test), `clearCompileCache()`, `compileChunk()`, and `chunkHash()`; the cache is capped at 5000 entries. `engine/smoke.test.ts` was removed.
- Phase 1 — §4's headings table says two or more `###` make columns; §6 rule 9 says two to six. Followed §6: seven or more `###` give `default`. Likewise a `###` heading plus images is not a gallery or figure (rule 3 needs depth 1–2).
- Phase 2 — `dex()` takes `{ dir }` (the decks folder, absolute or relative to the Vite root; default `decks`) so tests can run a real dev server and build on a temporary folder. URLs stay `decks/<slug>/…` whatever `dir` is, and in dev media is served by Vite's static serving, so a `dir` other than `<root>/decks` gets its JSON served but not its media.
- Phase 2 — event payloads the plan left open: `dex:index` is `{ slugs: string[] }` (sorted) and is sent only when the set of decks changes; removing a `deck.md` sends `dex:update { slug }` too (its `deck.json` then 404s). The payload types (`DexUpdateEvent`, `DexErrorEvent`, `DexIndexEvent`) are exported from `engine/vite-plugin.ts`, which browser code may not import; `shared/types.ts` is unchanged. `DexErrorEvent.line` (and the 500 body's `line`) is `null` for an error that is not a `DexCompileError`.
- Phase 2 — the deck cache is keyed by `deck.md`'s mtime and size and checked on every request as well as on watcher events, so a request never gets a stale deck when it arrives before the watcher event, and each version of the file is compiled (and its warnings printed) once.
- Phase 2 — responses the plan did not specify: `deck.json` for an unknown deck or invalid slug → 404 `{ error }`; a deck that fails to compile is still listed in `index.json` with `title` = slug and `slides: 0`. The marks endpoint answers 405 to anything but `PUT`, 404 when `decks/<slug>/deck.md` does not exist (it never creates folders), 400 when the body is not JSON or not `{ version: 1, slides: {…} }`, and 413 over 5 MB (after draining the body, because answering mid-upload makes the client see a connection reset instead). It writes through a dotfile temp file and `rename`, so a crash never leaves half a `marks.json`.
- Phase 2 — the build skips dotfiles in deck folders (`.DS_Store`, the marks temp file) as well as `deck.md`.
- Phase 2 (follow-up by the planner) — the three event payload types moved from `engine/vite-plugin.ts` to `shared/types.ts` and §5, because browser code may not import from `engine/`; the plugin re-exports them. §7 gained a "Server contract" section recording the endpoints, status codes, and events Phase 2 built.
- Phase 2 — the starter template lives in `engine/scripts/template.mjs` (with `template.d.mts` so a test can import it under `tsc`); a test compiles it and asserts zero warnings. `pnpm new` writes under the current directory (the project root under pnpm, as `start.mjs` already assumes) and also creates an empty `media/`. The template's top comment points to `README.md`, which Phase 10 writes; it is the title slide's speaker note, since a comment above the frontmatter would stop it being frontmatter. The split slide has no image until the author adds one, so it compiles as `default`.
- Phase 3 (follow-up by the planner) — review found no defects. Notes for later phases were added from what Phase 3 turned up: the `implement()` helper (§7), Shiki's inline background and the dev marker for the overflow label (Phase 4), chrome legibility over background images (Phase 4, with the decision made), keeping the screenshot spec out of the smoke run (Phase 4), the `0` key shared by go-to and zoom reset (Phase 5), and the laser's coordinate space (Phase 6).
- Phase 3 — route state lives in `App.svelte`; `lib/router.ts` is pure functions (`parseHash`, `formatRoute`, `replaceHash`, `onHashChange`), because runes only work in `.svelte.ts` modules. Hashes that do not start with `#/` are ignored, and in-slide `#…` links (footnote references) are prevented from navigating, since they would replace the route. The presenter and print routes render inside `.app` in place of the deck skeleton.
- Phase 3 — state beyond the §7 table: `deck` has `slug` (the slug the route asked for), `listLoaded`, and `errorLine`; `deck.error` holds both load failures and `dex:error` messages (ErrorOverlay shows it while a deck is showing; with no deck, a centered `CANNOT OPEN DECK` message shows it). `ui` has `warnings` (Phase 3: the warnings list is open), `editing` (Phase 6: id of the note being edited, used by the `Esc` order), and `goto` (Phase 5: digits typed). `settings.svelte.ts` also exports `deckTheme`, `loadDeckTheme`, `setDeckTheme`, `baseTheme()`, and `slideTheme(slide)`; `nav.svelte.ts` exports `show(i, step)`, `nextShown`, and `prevShown`. `marks.svelte.ts` and `sync.ts` are stubs for Phases 6 and 8.
- Phase 3 — the command registry: `Command` also has `phase` and `repeat` (whether holding the key repeats it; navigation and zoom in/out only), and `run`/`when` receive the `KeyboardEvent`. Keys are normalized strings (`ArrowRight`, `Space`, `Shift+Space`, `t`, `Mod+z`, `Shift+Mod+z`, `+`); `Mod` is ⌘ or Ctrl, Shift is part of the name only for letters and named keys, and a key with an unregistered modifier (⌘R, ⌘L) is never captured. The first command whose keys match and whose `when` passes runs. `implement(id, run, when)` lets a later phase fill a stub from its own module. `goto` is registered with the ten digits and `Enter` and `when: () => false`, before the zoom commands: `0` is both a digit and zoom reset, so Phase 5's `when` should claim `0` only while digits are being typed. `keyLabel()` formats keys for the Phase 5 key list. Enter and Space on a focused button or link are left to the button, and chrome buttons cancel `pointerdown` so a mouse click does not leave focus on them (otherwise the next Space would press the button again).
- Phase 3 — `h` toggles `settings.chrome` between `hidden` and its previous value, so it is persisted like the setting.
- Phase 3 — with follow-edits on, the edited slide becomes current fully revealed (step = its `steps`), so the edit is visible. Without a changed slide (or with follow-edits off), the slide is kept by `id` at its step (clamped), else the index is clamped. Overlapping reloads are dropped by a generation counter.
- Phase 3 — `SlideView` has two props besides `slide`, `step`, and `revealAll`: `current` (gets `.current`, plays autoplay videos; others pause every video) and an optional `theme` override. It also respects `settings.builds` itself. Stage renders the previous and next non-skipped slides (the previous one fully revealed, as `prev()` lands on it).
- Phase 3 — `clientToStage(event)` returns slide (camera-space) coordinates, via an empty `<svg class="stage-ref" viewBox="0 0 W H">` inside `.camera`; `ui.pointer` is updated from it. `Laser` sits outside `.camera`, so Phase 6 must undo the camera itself, or convert with the stage's own CTM, if zoom is active.
- Phase 3 — `bg` images: the compiler writes `--slide-bg: url("decks/…")`, and a relative `url()` in a custom property resolves against the stylesheet that uses the `var()`, which in a build is `assets/` (verified under `vite preview`: the computed URL was `assets/decks/demo/media/plate-4.svg`). `SlideView` makes relative `url()`s in `attrs.style` absolute against `document.baseURI`. No compiler change.
- Phase 3 — `slide.css` goes a little beyond task 10 so the demo deck reads: column widths for title, statement, and quote, statement sizes, minimal media sizing, the `bg` image and scrim, footnotes at the bottom, and `.sr-only`. Phase 4 should feel free to replace all of it. `layouts.css`, `code.css`, and `print.css` exist as empty files already imported by `main.ts`, so Phases 4 and 9 need not edit `main.ts`. `chrome.css` holds the shared chrome primitives (`.label`, `.sublabel`, `.control-text`, `.help-text`, `.label-btn`, `.icon-btn`) and the motion-off overrides (the duration tokens become 0 under `data-motion="off"` via `:root:has(…)`, and under `prefers-reduced-motion`).
- Phase 3 — the error line from `dex:error` is drawn with a 1px `--red` frame on `--bg`, so it stays readable over slide content. The warnings label reads `1 WARNING` for one warning. Rows in the warnings list show the slide number, `L<line>`, and the message.
- Phase 3 — `index.html` has `<link rel="icon" href="data:,">`, so no `favicon.ico` request 404s in the console.
- Phase 3 — Playwright runs with one worker, in file order, and `reducedMotion: 'reduce'`. Tests that need to edit a deck write `decks/zz-e2e-*` (gitignored) via `e2e/temp-deck.ts`, and those folders are removed in `afterAll` and again in `globalTeardown`. In dev, `window.__dex` exposes `{ deck, nav, settings, ui }` for tests and the console.
- Phase 3 — known rough edges for Phase 4: on the `bg` image slide, the chrome Labels (`--ink-3`) are barely visible over the scrimmed light demo image. Shiki puts `background-color: var(--shiki-background)` inline on each `pre`, which beats a stylesheet `background`; `code.css` needs to set `--shiki-background` (for example to `var(--tint)`) instead. The `OVERFLOW` flag (§8) is not drawn yet, though `data-overflow` is set.
- Phase 4 (follow-up by the planner) — three things. (1) The owner saw full-bleed pictures run under the bars in a window, and stop short of the screen edges in fullscreen. The stage had been fitted to the whole window with the bars drawn over it, and nothing extended past the stage. Now the bars are docked in a window and the stage fits between them; full-bleed layers extend into the letterbox (`--bleed-x`, `--bleed-y`, the `.slide-bleed` element). §7 and §8 describe it; the over-image label rule now applies only to overlaid chrome. (2) A real race, found as a flaky test: a `dex:update` arriving while a deck was still opening superseded the open, so the slide number in the URL was dropped and the page landed on slide 1. `reload()` now waits for an open in flight; a test holds the response and edits mid-open. (3) Phase 4's eased heading tracking and the `data-len` attribute on quotes are accepted as recorded below.
- Phase 4 — §8 values changed (the §8 tables above now carry the new values). (1) Display tracking eased: `h1` -0.03em → -0.015em, `h2` -0.02em → -0.01em, statement -0.03em → -0.02em, quote -0.015em → -0.01em. DM Sans switches to its display optical size at these sizes, which is already tightly spaced; at the original values letter pairs touched ("ee" in "Three", "go" in "good"), seen side by side in an A/B render. Owner may want to flip this back. (2) The lede block's top margin is 1.57em (of the lede), not 1.4em: 1.4em gave a rule top 0.64× the heading size below its baseline, short of the 0.7× target; 1.57em measures 0.69×. (3) The scrim is 0.55, as Phase 4 task 6 decided (§8 still said 0.45).
- Phase 4 — the title layout's eyebrow and the section number hang above the heading (negative top margin equal to their height plus gap), so the heading-plus-lede block is what is centered on the stage, and a title slide's heading sits in the same place with or without an eyebrow. Measured at Quiet: block centre 450.0 on a 450 stage centre.
- Phase 4 — compiler: `quote` slides get `data-len` (`l` over 140 characters, attribution excluded, else `m`), because §8 sets long quotes at 32 / 1.3 and no attribute exposed the length. `layout.ts` `computeAttrs`, one new test, and the demo snapshot (the quote slide gains `data-len="m"`; hashes unchanged). §6 "Computed attributes" updated.
- Phase 4 — the `bg` scrim is a flat `linear-gradient` layer above `var(--slide-bg)` in `background-image`, not a `::before`, so `::before` stays free for the section number and `::after` for the dev `OVERFLOW` label. The Phase 3 smoke test that compared the whole `background-image` now checks that the last layer is the page-relative `url()`.
- Phase 4 — layouts that center their content (`title`, `section`, `statement`, `quote`) use a bottom padding equal to the top (112), so content is centered on the stage rather than on the safe area, which is 4px lower. `justify-content: safe center` everywhere, so overflowing content falls back to the top instead of being clipped above.
- Phase 4 — `section`: the slide's flex column centers `::before` (the number) and `.s-main` together, and `.s-main` shrink-wraps. Chrome counts the h1's glyph box (about 1.3em) beyond its 1.02 line box as scrollable overflow, which made the section slide report `data-overflow`; `.s-main` has 0.16 × the h1 size of block padding to hold it.
- Phase 4 — choices §8 left open: table cells in the first and last column have no outer horizontal padding, so table text lines up with the title; code blocks are `fit-content` wide with a 30em minimum and may exceed the 36em text measure (up to the column), and their 28×32 padding is written as 1.4em × 1.6em so it follows the text size; a highlighted line's band runs the full width of the block; in numbered lists an item's first paragraph is inline, so loose lists and footnotes keep their text on the number's line; footnote text is 13 (Caption size, with the same 11 floor as mono roles) with the zero-padded number in mono; `h5` borrows the `h4` role; the `image` layout's caption sits at the bottom-left corner of the safe area; in `split` with `cover`, a caption sits on a `--bg` strip at the bottom inner corner of the picture; `columns` gap (56) and rule padding (24) are fixed logical pixels and do not scale with text size; the space between head and body is 0.6 × the slide-title size for `default`, `columns`, `figure`, and `gallery` alike.
- Phase 4 — chrome over a `bg` image: `.app` gets `data-over-image` (set in `App.svelte`) and `chrome.css` steps the labels up one level as decided. On the demo's light plate under the 0.55 scrim, the counter and deck title read, but the idle `← → NOTE DRAW` (now `--ink-3`) are still close to invisible. Left as decided; a second step, or a `--bg` strip under the bars only on image slides, would fix it.
- Phase 4 — `App.svelte` sets `data-dev` on `.app` in dev, for the `OVERFLOW` label (13px fixed, a dev marker, not slide text).
- Phase 4 — Playwright has two projects: `chromium` (smoke, ignores `shots.spec.ts`) and `shots` (only `shots.spec.ts`); `pnpm test:e2e` runs `--project=chromium`, `pnpm shots` runs `--project=shots`. `pnpm shots` also writes `docs/shots/report.json` (layout, density, overflow per shot) and `docs/shots/measure.json` (the §8 reference measurements at Quiet, taken from the DOM), five sample slides at Quiet and Loud, and the title, bullets, columns and both split slides on 4:3 and 16:10 stages at Regular and Quiet (temporary `decks/zz-e2e-aspect-*` decks, removed afterwards). `docs/shots/` is gitignored.
- Phase 5 (owner feedback) — the segmented controls came in two heights, because Theme, Motion and Marks had no sublabels. Every control now has sublabels and every cell is 41px tall; `Segmented` no longer has a short variant. The key list wraps only between items. §8 and the Phase 5 table are updated.
- Phase 5 (follow-up by the planner) — review found no defects. Decisions and notes recorded for later phases: the three scopes of clearing marks (Phase 6); replacing the `editing` Esc layer (Phase 6); blackout's "any key" and overlay keys on the presenter route (Phase 8); `PRINT / PDF` opening a new tab (Phase 9); and the Esc chain in §7.
- Phase 5 — `Esc` chain: `src/lib/escape.ts` holds ranked layers (`ESCAPE_RANK`: goto 0, warnings 5, settings 10, overview 20, source 30, editing 40, tool 50, zoom 60, blackout 70) and `onEscape(id, rank, close)`; `escape()` asks them in order and stops at the first that closes something. `commands.ts` `escape()` now delegates to it. Defaults for every layer are registered from `ui` state (the Phase 3 behaviour); Phases 6–8 replace their layer by id (`onEscape('editing', ESCAPE_RANK.editing, …)`) when closing needs more than clearing state. Go-to digits are cancelled before anything else closes.
- Phase 5 — `keys.ts`: a focused button or link keeps `Enter` and `Space` unless a command with a `when` claims the key. Found by a test: in the overview focus sits on a thumbnail button, so `8`, `Enter` pressed the button instead of going to slide 8. Only `goto` claims `Enter` (while digits are typed), so nothing else changes; a later phase that gives `next` a `when` would let it take `Space` from focused buttons.
- Phase 5 — go-to: up to four digits (a fifth starts over); a number past the end lands on the last slide; skipped slides can be reached; `Enter` with digits typed in the overview closes it; the command is inactive on a deck with no slides. The bottom-bar label is `--ink` so it reads against the idle `--ink-4` arrows.
- Phase 5 — overlays stay exclusive (`ui.overlay` is one value): opening one replaces another, which is what the `Esc` order needs. They fade in with a CSS keyframe on `--t-fast` (so motion off and reduced motion zero it) and close without a fade. Stacking: source view 10 (under the bars), overview 30 (over them), sheet backdrop 35, error line 40.
- Phase 5 — sublabels shortened to fit a 9px mono cell (17 characters in a three-cell row): TEXT `Screen share` / `Most rooms` / `Big rooms` (the full Quiet text is the cell's tooltip); CHROME `Fullscreen hides` (tooltip "Hides in fullscreen"), plus `Never hides` and `h shows it` so all three cells have one; FOLLOW EDITS `Jump to edited slide` / `Stay put`. A row is 41px tall when any of its cells has a sublabel.
- Phase 5 — sheet details the plan left open: the header row scrolls with the content (as in the reference, which shows no header once scrolled); the width is `min(432px, 100vw − 32px)`; `Button` (§8) is a shared `.button` class in `chrome.css`; the KEYS words are written in `SettingsSheet.svelte` while the keys are read from the registry (five lines, including later-phase commands); opening the sheet refreshes the deck list for the DECK select, and changing it sets the hash (a history entry) and leaves the sheet open on the new deck; the SLIDES row also counts skipped slides; info rows are 34px.
- Phase 5 — later-phase buttons: `CLEAR THIS SLIDE` runs the `clear` command; `CLEAR ALL` calls a new no-op stub `clearAllMarks()` in `marks.svelte.ts` (Phase 6 adds the `CONFIRM` step and fills it). Both are disabled while `marks.data` has nothing to clear, which with the Phase 5 stub is always. `PRESENTER` runs the `presenter` command (Phase 8). `PRINT / PDF` closes the sheet and sets the hash to `#/<slug>/print` in the same window (Phase 9 renders it).
- Phase 5 — overview details: a header like the top bar (square, deck title, slide count, `CLOSE`); each thumbnail is an inert, `content-visibility: auto` box of the stage's shape holding a `SlideView` (`revealAll`, `current={false}`, so it is `aria-hidden` and never plays video) scaled by one measured factor, with a transparent button over it; the selection is that button's focus ring, separate from the current slide's `--ink` border; `Home` and `End` select the first and last; its keys are taken on the window in the capture phase while it is open, so focus can be anywhere. The scale uses the fractional box width (`clientWidth` rounds, and the slide then covered the frame's right border). Measured: two frames after `g`, 45ms on the demo with no long task; 54ms with one 51ms long task on a generated 150-slide deck, whose grid scrolls with no frame over 18ms.
- Phase 5 — source view: a stage-shaped page fitted to the stage area exactly like the stage, over it and under the bars; the `MARKDOWN` label (13 logical px, mono) has `decks/<slug>/deck.md:<line>` on the right. It does not follow the text size.
- Phase 5 — §8 gives the sheet as 433px in "Reference measurements" and 432px in "Chrome"; 432 is used.
- Phase 5 — tests: `e2e/overlays.spec.ts` (21 tests, part of `pnpm test:e2e`); the motion test runs with `reducedMotion: 'no-preference'`, since the suite's reduced motion already zeroes every duration. `pnpm shots` also writes `docs/shots/chrome/` (sheet top and bottom at the reference's 1366×817, overview, source view, go-to label, each in Paper and Ink) and `docs/shots/chrome/sheet.json` (the sheet's sizes from the DOM).
- Phase 6 (follow-up by the planner) — review found no defects. `decks/demo/marks.json` is now gitignored, because trying the tools on the demo deck writes it. For later phases: pan-by-drag must not start on a sticky note or while a tool owns the stage area (Phase 7); the presenter passes `interactive={false}` to the mark layers, and `onMarksChange` fires on every keystroke and drag move, so throttle what is broadcast (Phase 8); print places the layers in a positioned, stage-sized box and passes `force` from its marks toggle (Phase 9).
- Phase 6 — server: in dev, `GET decks/<slug>/marks.json` for a deck with no marks answered 200 with `index.html` (Vite's SPA fallback), not the 404 §7 promises. The plugin now serves that URL itself: the file with `Cache-Control: no-store`, or 404 JSON when it does not exist (one test in `vite-plugin.test.ts`). The client also treats an HTML answer as "no marks", for static hosts with an SPA fallback.
- Phase 6 — input: pointer input is taken on `.viewport` (the whole stage area, letterbox included) by listeners that `DrawLayer` (draw tool) and `NotesLayer` (NOTE armed) attach while their tool is on; `.slides` get `pointer-events: none` meanwhile and the crosshair is set on `.viewport`. The drawing `<svg>` itself stays `pointer-events: none` (marks get `visiblePainted` in eraser mode only), so §9's "pointer-events none unless the draw tool is active" is done one level up. Points go through `clientToStage` and may fall outside 0…W / 0…H; the svg has `overflow: visible`.
- Phase 6 — strokes: mouse and touch points are stored with pressure 0.5, pen points with their real pressure; a stroke whose pressures are all 0.5 is rendered with `simulatePressure: true`, so it looks the same after a reload as while drawn. Coordinates are rounded to 0.1 and pressure to 0.01 in the file. Arrow and box use the pen size (4, 6, 10); the marker is always `--marker` at size 28 and ignores the pen colour (which is still stored).
- Phase 6 — eraser: hit-tests with `document.elementsFromPoint` at the pointer and 8 points 6 CSS px around it, interpolated every 4px along a fast move, so a 4px line is easy to hit. It erases drawings only, not sticky notes (they have their own ×). Touched strokes hide at once and are removed on release as one undo step.
- Phase 6 — draw bar: after the colour squares there is a size Label (`S` `M` `L`) that cycles the pen size on click, since `[` and `]` otherwise give no feedback. The active tool's underline is 4px below the text's baseline (the labels are uppercase). `DONE` sits at the bar's 20px side padding, not the reference's 17px. `UNDO` and `CLEAR` are disabled buttons in `--ink-4` when unavailable.
- Phase 6 — keys: `[`/`]` (`penSmaller`, `penLarger`), `Delete`/`Backspace` (`noteDelete`) and `Enter` (`noteEdit`) are new registry entries in `commands.ts`; the last two only claim their keys while a note is selected and not being edited (`Enter` comes after `goto`). The KEYS list in the sheet gains `[ ] pen size` and its marks line is split in two. `d`, `n`, the NOTE button and laser are mutually exclusive tools; picking one ends any note edit. `d` and NOTE, and `n`, switch MARKS back on if it was hidden, so new marks are never invisible.
- Phase 6 — sticky notes: `ui.selected` (selected note id) was added to `ui`. A note is placed with its top-left corner at the pointer (clamped to the stage). Notes take the pointer only while no tool is on, so a stroke can cross a note. Editing ends on Esc or a press outside the note (not on blur, so switching windows mid-sentence does not end the edit or delete an empty note). The `editing` Esc layer also drops a selection. The selection outline is 1px `--ink`, not `--note-ink`: the same colour on Paper, and visible on Ink, where `--note-ink` was invisible against the page. Undo granularity: a new note and the text first typed into it are one step; a drag is one step; a colour change is one step; ending an edit is one step; a new note left empty leaves nothing on the stack; a note that had text and was emptied can be brought back with undo. `Mod+Z` inside the textarea is the textarea's own undo (ground rule 9).
- Phase 6 — undo is one stack for the deck (not per slide), capped at 200 steps, and undo does not change slide. Operations address strokes and notes by id, so they stay correct after `applyRemoteMarks` (Phase 8).
- Phase 6 — `CLEAR ALL` removes every entry in the file, including marks for slide ids the deck no longer has: it is an explicit request for a clean slate, and the button is enabled by any marks in the file. It is undoable, and otherwise nothing prunes orphaned ids. Empty `{ strokes: [], notes: [] }` entries are dropped when a slide's last mark goes.
- Phase 6 — saving: a pending save is flushed on `pagehide`, on `visibilitychange` to hidden, and before another deck's marks load. `fetch` `keepalive` bodies are capped at 64 KiB by the browser, so a larger file is sent without `keepalive` (it may not survive a closing page); to cover that, dev writes the body to `localStorage` under `dex:marks-unsaved:<slug>` before each PUT and removes it once the latest PUT succeeds; on load, a leftover copy wins over `marks.json` and is PUT again. A `marks.json` that exists but cannot be read (bad JSON, wrong shape, HTTP error other than 404) is never overwritten: saving is disabled for that deck with a console warning.
- Phase 6 — `marks.svelte.ts` loads the open deck's marks from an `$effect.root` watching `deck.current.slug`, on every route, so the presenter and print views (Phases 8, 9) get them without extra wiring.
- Phase 6 — laser: drawn as SVG circles (no `border-radius`), positioned from the pointer's offset in `.stage` divided by the stage scale. The trail is the last 12 positions, fading out over 220ms once the pointer rests; the dot hides when the pointer leaves the stage area.
- Phase 6 — known rough edge: the marker on Ink (`--marker` at 45% with `mix-blend-mode: screen`, as specified) reads as a dull olive rather than a highlighter.
- Phase 6 — tests: `e2e/marks.spec.ts` (17 tests, part of `pnpm test:e2e`) on a temporary deck `decks/zz-e2e-marks`; `decks/demo/marks.json` is never written. A static build was checked by hand under `vite preview`: marks go to `localStorage` (`dex:marks:demo`), no PUT is sent, a reload keeps them, and a stroke made just before leaving the page is kept.
- Phase 7 (follow-up by the planner) — review found no defects. For later phases: on the presenter route give the zoom commands a `when` that is false, as for the overlays, and do not sync the camera to the audience window in v1 (Phase 8); print renders without the camera transform (Phase 9); the rehearsal must try zoom with a real trackpad and mouse wheel, which headless tests cannot (Phase 10).
- Phase 7 — files: camera math is pure in `src/lib/camera.ts` (`clampCamera`, `zoomAt`, `panBy`, wheel helpers) with unit tests in `src/lib/camera.test.ts`; Vitest's `include` gains `src/lib/**/*.test.ts` for it. `src/lib/zoom.ts` fills the four zoom commands with `implement()`, replaces the `zoom` Esc layer (so Esc eases back like `0`), and exports `attachZoom(viewport)`, which `Stage.svelte` calls for wheel, pinch and drag. `lib/stage.ts` gains `clientToFrame(event)`: stage coordinates before the camera, read from the stage's rect, so a zoom anchor is right even while a key zoom is still easing (the camera's CTM is mid-transition then).
- Phase 7 — `ui` gains `cameraAnimate` (the last camera change eases: key zooms, Esc, the percentage button) and `panning` (a drag-to-pan is under way). `resetCamera(animate = false)` takes a flag; navigation still resets at once. `.camera` has `transition-property: none` unless `.animate`, so a slide change in the middle of an ease cancels it rather than letting the old zoom run out over the new slide (with the default `all 0s`, the running transition kept going).
- Phase 7 — wheel: one non-passive `wheel` listener on `window`. Ctrl/⌘ + wheel and pinch zoom at the cursor anywhere in the deck view, bars included, and always `preventDefault`, so the page never zooms; while an overlay (settings, overview, source) is open they are left to the browser. `deltaY` is capped at ±25 per event before `exp(−deltaY · 0.01)`: a mouse-wheel notch (about 100) would otherwise be a 2.7× jump; pinch deltas are far smaller and unaffected. `deltaMode` lines and pages are converted to pixels. A plain wheel pans only while zoomed and only over the stage area, by the delta divided by the stage scale.
- Phase 7 — keys: `z`, `+`/`=`, `-`, `0` anchor at the pointer when it is over the stage area, else at the stage centre, and are inactive while an overlay is open or the deck has no slides. `0` is reset only when no go-to digits are typed (Phase 5's `when` claims it otherwise). The bottom bar's percentage runs `zoomReset`. After any camera change, `ui.pointer` is recomputed from the last pointer position, so `n` after a wheel pan puts the note under the pointer.
- Phase 7 — drag-to-pan: armed while `k > 1`, no tool is on, and no overlay is open (`.viewport[data-pan="ready"]`: grab cursor, `user-select: none`, `touch-action: none`; `"active"` while dragging: grabbing). Listeners are native on `.viewport`; sticky notes, buttons, form fields and `video[controls]` are excluded by `closest()`, because Svelte delegates `onpointerdown` to the root, so a note's `stopPropagation()` runs after a native `.viewport` listener has already seen the press. A press becomes a pan only after 3px of movement, so a click on a link still follows it; a press that pans swallows the click its release would make. Native image drags are prevented while armed.
- Phase 7 — verified, no change needed: drawing and note placement go through `clientToStage`, whose CTM includes the camera, so marks land under the pointer at any zoom (tested at 200% on a corner: the stroke spans the drag on screen and its SVG bounding box is at the expected slide coordinates); the laser, positioned in `.stage` outside `.camera`, stays under the pointer when zoomed (tested). Full-bleed layers zoom with the slide and fill the letterbox; the clamp keeps the stage rectangle covered, as specified.
- Phase 7 — tests: `e2e/zoom.spec.ts` (11 tests, part of `pnpm test:e2e`) on a temporary deck `decks/zz-e2e-zoom`; one runs without reduced motion to check that key zooms ease over `--t-med`, wheel zooms do not, and a slide change cancels a running ease. Rough edges: Ctrl/⌘ + wheel with an overlay open still zooms the page (deliberately left to the browser); on the presenter route (Phase 8) the zoom commands would change `ui.camera` with no stage to show it, so Phase 8 should give them a `when` that is false there, as for the overlays.
- Phase 8 — `SyncMessage` changed (§5 and `shared/types.ts`): `nav`, `theme` and `blackout` carry a `stamp: SyncStamp` (`{ seq, origin, id }`). Without an order, two windows that navigate within the same few milliseconds each apply the other's message and end on different slides (a test that runs three windows navigating at once fails every time without it). Each window keeps a Lamport clock (`src/lib/stamp.ts`, unit tested); it applies a message only when its stamp is newer than the stamp of the value it holds: higher `seq` wins, then the older window (`performance.timeOrigin`), then `id`. A window's untouched values carry `seq` 0, so a window that joins adopts the others' state, and between two untouched windows the older one wins.
- Phase 8 — files: `src/state/sync.ts` is only the `BroadcastChannel` wrapper (`openSync(slug, onMessage)`, `broadcast`, `closeSync`). The wiring is in `src/lib/session.svelte.ts` (runes need a `.svelte.ts` module): it watches `nav`, `deckTheme.override` and `ui.blackout` with effects and broadcasts a value only when it differs from the last value the window knows, sent or received; applying a message records the value before changing state, so the effect finds nothing new and nothing echoes. Marks go out from `onMarksChange`, batched per slide to one message per animation frame (with a 100ms timer as well, since a hidden window gets no frames), and come in through `applyRemoteMarks`, which neither saves nor reports. `src/lib/presenter.ts` fills the `presenter` and `blackout` commands. `App.svelte` calls `startSync(slug)` after the route's slide is shown (so a joining window's own slide is settled before it asks), and `stopSync()` on the index and print routes; `window.__dex` gains `session`.
- Phase 8 — `hello`: sent once the window's marks have loaded, so marks in the replies land on top of what was loaded rather than being replaced by it. Replies carry the slide and step, theme and blackout as planned, and also a `marks` message for every slide that has marks, so strokes made just before the presenter opened (not yet in `marks.json`, which saves after 500ms) still show. Not synced: the camera (as decided), tools, overlays, the laser, settings, go-to digits, the timer. Theme: only a local change of the per-deck override is broadcast; a frontmatter `theme` change reaches each window through live reload, and an incoming theme is written as an override only when it differs from what the window shows.
- Phase 8 — known limit: two deck windows drawing on the same slide within one animation frame each replace that slide's marks with the other's snapshot, so one stroke can be lost. The presenter cannot draw, so this needs two audience windows; left as is.
- Phase 8 — blackout: `--blackout: #000` added to the `:root` block of `tokens.css` (§8 updated), because the cover's colour must come from a token. The `blackout` command only turns it on; while it is on, `keys.ts` takes the next key before the editable-target check and the command lookup, clears blackout and does nothing else. A modifier on its own, a held key's repeats, and ⌘/Ctrl shortcuts leave it on (so ⌘-Tab to another app does not lift it). A click on the cover clears it. The presenter window never goes black: its current-slide frame shows the black the audience sees and a `BLACKOUT · ANY KEY RETURNS` Label button that clears it; a click elsewhere in the presenter does not (clicks belong to the timer). A window opened during a blackout starts blacked out.
- Phase 8 — presenter route: besides the overlays, zoom and the marks tools (`draw`, `note`, `laser`, `marks`, `clear`, `undo`, `redo`, `penSmaller`, `penLarger`, `noteDelete`, `noteEdit`), `chrome` (`h`, which would change a stored setting with nothing to show) and `presenter` (`p`, which would re-open the presenter in itself) get a `when` that is false there; the wrapper keeps each command's own `when`. A later `implement()` of one of these ids would drop the guard. Go-to works in the presenter and shows `GO TO 12` beside the counter. The presenter's `<html>` takes the deck theme, not the current slide's, so the presenter does not flip on `invert` slides; each slide carries its own theme. Slides are rendered with `current={false}`, so autoplay videos do not play (with sound) in the presenter. The window title is `Presenter · <deck> · dex`.
- Phase 8 — presenter layout: the `NEXT`/`END` Label sits under the next slide (with the next slide's title beside it), so the two frames' tops align; on the last slide the frame is empty with `END OF DECK` centred in `--ink-4`. A `NOTES` Label heads the notes. The next slide shows its marks too. The current frame is as wide as its column unless the window is too short, then as tall as fits. Below the frames at 1280×800 there is unused space on the left.
- Phase 8 — timer: a click on an idle timer starts it; a click pauses and resumes; the click events of a double-click are ignored after the first (`detail > 1`), and the double-click resets to idle (`00:00:00` in `--ink-4`), which the next navigation starts again, so a double-click never leaves it paused. Paused is `--ink-3` with a `PAUSED` Label. A slide or step change starts an idle timer, including the one a presenter opened mid-talk makes when it adopts the talk's slide; the deck loading or reloading does not. Clicks on the timer do not take focus, so `Space` keeps moving the slides. The clock is `toLocaleTimeString` hours and minutes.
- Phase 8 — tests: `e2e/presenter.spec.ts` (12 tests, part of `pnpm test:e2e`) on a temporary deck `decks/zz-e2e-presenter`, two or three pages in one context, with `BroadcastChannel.postMessage` counted to show windows stop sending once settled. The timer test uses Playwright's fake clock. `pnpm shots` writes `docs/shots/presenter/` (presenter at 1280×800 in Paper and Ink: notes and builds, blackout, last slide, no notes; the audience window in blackout).
