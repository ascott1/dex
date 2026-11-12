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
| 1 | Compiler: markdown → deck JSON | L | 0 | Sonnet | [ ] |
| 2 | Vite plugin, dev server, scripts | M | 1 | Sonnet | [ ] |
| 3 | Runtime shell: stage, nav, builds, chrome, live reload | L | 2 | Sonnet | [ ] |
| 4 | Slide design: typography, all layouts, demo deck | L | 3 | Sonnet | [ ] |
| 5 | Settings sheet, overview, source view | M | 3 | Sonnet | [ ] |
| 6 | Marks: draw, sticky notes, laser, persistence | L | 3 | Sonnet | [ ] |
| 7 | Zoom and pan | S | 3 | Sonnet | [ ] |
| 8 | Presenter view, speaker notes, timer, blackout | M | 3 | Sonnet | [ ] |
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
- Shiki 4: `createCssVariablesTheme` and `createHighlighter` are exported from `shiki`. `@shikijs/rehype/core` default-exports a plugin called as `.use(plugin, highlighter, { theme, transformers, fallbackLanguage: 'text' })`. `transformerMetaHighlight()` turns ` ```ts {2} ` into `class="line highlighted"`. Token colors are emitted as `var(--shiki-token-keyword)` and similar.
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

### Slides

- A line containing only `---` starts a new slide. It always means a slide break, even directly under a line of text. It is ignored inside fenced code blocks.
- Slide content is CommonMark plus GFM (tables, strikethrough, task lists, footnotes) plus raw HTML.
- Footnotes and link reference definitions must be on the slide that uses them.

### Headings are roles

| Markdown | Role |
|---|---|
| `#` | Display heading. A slide with only `#` and up to two paragraphs is a title slide. `#` alone (not on slide 1) is a section divider. |
| `##` | Slide title |
| `###` | Column heading (two or more on a slide make columns), otherwise a subheading |
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
| Only images (two or more), optional heading | `gallery` |
| Two or more `###` headings | `columns` — one column per `###` |
| A line containing only `\|\|\|` | `columns` — split at each `\|\|\|` |
| Anything else | `default` — title on top, content below |

### Builds

- A list written with `+` bullets reveals one item per step. `-` and `*` lists appear all at once.
- `build: true` in the frontmatter or in a slide directive makes every top-level list on the slide build, whatever the bullet. `build: false` on a slide turns builds off for that slide.
- A paragraph containing only `. . .` is a pause: everything after it on the slide waits for the next step.
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

A comment that looks like a directive but has an unknown key is treated as a note, and the compiler warns.

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
  attrs: Record<string, string>;   // data-* attributes for the slide element
  notes: string;          // speaker notes as HTML, '' when none
  steps: number;          // number of build steps, 0 when none
  options: SlideOptions;
  source: string;         // this slide's raw Markdown
  line: number;           // 1-based line in deck.md where the slide starts
  hash: string;           // changes when the slide's rendered output would change
}

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

// BroadcastChannel messages between windows of the same deck (Phase 8)
export type SyncMessage =
  | { type: 'hello' }
  | { type: 'nav'; index: number; step: number }
  | { type: 'marks'; slideId: string; marks: SlideMarks }
  | { type: 'theme'; theme: ThemeName }
  | { type: 'blackout'; on: boolean };
```

The theme a user toggles is stored per deck in `localStorage` under `dex:theme:<slug>` and overrides the frontmatter. Everything in `Settings` is global, stored under `dex:settings`.

---

## 6. Compiler

`compileDeck(source: string, opts: { slug: string }): Promise<Deck>` in `engine/compiler/index.ts`. It reads no files. It throws `DexCompileError` (with a `line`) only for invalid frontmatter YAML. Every content problem becomes a `CompileWarning`.

### Pipeline

1. **Normalize** line endings to `\n`.
2. **Frontmatter** (`frontmatter.ts`). If the source starts with `---\n`, take everything up to the next line that is exactly `---` and parse it with `yaml`. Validate against `DeckMeta`; an unknown key or bad value is a warning and the default is used. Keep count of the consumed lines so `Slide.line` stays correct.
3. **Split** (`split.ts`). Walk the body line by line. Track fenced code: a fence opens on a line matching `/^ {0,3}(`{3,}|~{3,})/` and closes on a line of the same character with at least the same length. Outside fences, a line matching `/^---+\s*$/` ends the current chunk. Drop chunks that are empty or whitespace. Record each chunk's starting line. This is deliberately line-based, not AST-based: `text` directly followed by `---` would otherwise parse as a heading.
4. **Per chunk** (cache the result by `hash`; see below):
   1. Parse with `remark-parse` and `remark-gfm`.
   2. **Comments** (`comments.ts`). Remove root-level `html` nodes that are whole comments (`/^<!--([\s\S]*?)-->$/`). Split the body on commas and newlines into `key: value` pairs. If there is at least one pair and every key is a known directive, merge into `SlideOptions` (validating values; bad value → warning, ignored). Otherwise append the comment body to the notes. If every segment is `key: value` shaped but a key is unknown, also warn.
   3. **Markers.** Remove root-level paragraphs whose text is exactly `. . .` (pause) or `|||` (column break), remembering their positions.
   4. **Builds** (`builds.ts`). Walk root blocks in order with a counter starting at 0. After each pause marker, increment the counter; every later root block gets `data-step` equal to the counter at that point. A top-level list builds if the slide's `build` option is `true`, or the option is unset and (deck `build` is true or the list's bullet is `+`). For a building list, each direct `listItem` increments the counter and gets that value as `data-step`; the list itself keeps the step it inherited. `Slide.steps` is the final counter. Set steps with `node.data.hProperties['data-step']`.
   5. **Layout** (`layout.ts`). Use `options.layout` if set; otherwise infer (rules below).
   6. **Regions** (`regions.ts`). Regroup the root's children into wrapper nodes per the HTML contract. Wrappers are custom mdast parent nodes: `{ type: 'dexRegion', data: { hName: 'div', hProperties: { className: ['s-main'] } }, children }`.
   7. **To HTML.** `remark-rehype` with `allowDangerousHtml: true` → `rehype-raw` → media plugin (`media.ts`) → Shiki (`highlight.ts`) → `rehype-stringify`.
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
  <main class="viewport">                          fills the window
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
- The stage fits the **whole window**, bars included. The bars are transparent overlays. Slides keep generous inner margins, so the bars never cover content on any window at least 600px tall, and hiding the chrome causes no reflow.
- `html` has `background: var(--bg)`, so the area around the stage matches the slide.
- **Effective theme**: the deck theme (per-deck override, else frontmatter), flipped when the current slide has `invert`, forced to `ink` when it has a `bg` image. It is set on `<html>` so the bars and letterbox flip with the slide. Every `SlideView` also sets `data-theme` on its own root, so thumbnails and print pages are themed independently. Tokens are therefore defined on `[data-theme=…]`, never on `:root`.
- **Slides rendered**: previous, current, and next. Only the current one is visible; the others are `visibility: hidden` so their images are already loaded. The transition is a CSS opacity change on a `.current` class.
- **Builds**: after the HTML is in the DOM, an effect toggles the class `is-pending` on every `[data-step]` element whose step is greater than the current step. Pending elements keep their space (`opacity: 0`), so nothing reflows. When `settings.builds` is off, nothing is pending.
- **Auto-fit**: after the HTML is in the DOM, after `document.fonts.ready`, and after each image in the slide loads: if `.s-main` has `scrollHeight > clientHeight + 1`, set `data-density="1"` on the slide; if still overflowing, `"2"`; if still overflowing, set `data-overflow` and log a console warning naming the slide. Skip for `figure`, `gallery`, `image`, `full`.

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

One registry: `{ id, title, keys: string[], run(): void, when?(): boolean }`. `keys.ts` maps `keydown` to commands. The key list in the settings sheet is generated from the registry. Phase 3 registers every command below; commands owned by later phases start with an empty `run`.

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
| `⌘Z` / `⇧⌘Z` (`Ctrl` on other platforms) | Undo / redo marks | 6 |
| `z`, `+`, `-`, `0` | Zoom toggle, in, out, reset | 7 |
| `p` | Open presenter window | 8 |
| `b` or `.` | Blackout | 8 |
| `Esc` | Close the topmost thing: settings, overview, source, note editing, tool, zoom, blackout — in that order | 3 |

Presentation clickers send `PageDown`, `PageUp`, and often `b` or `.`; those are covered.

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
| Display | `h1` | 80 / 1.02 | 500 | -0.03em | ink |
| Slide title | `h2` | 60 / 1.08 | 400 | -0.02em | ink |
| Subhead | `h3` | 30 / 1.15 | 500 | -0.01em | ink |
| Small subhead | `h4` | 22 / 1.2 | 500 | 0 | ink |
| Eyebrow | `h6` | 13 / 1.2, mono, uppercase | 500 | 0.14em | ink-2 |
| Body | `p`, `li` | 26 / 1.45 | 400 | 0 | ink |
| Lede | paragraphs under the `h1` in `title` and `section` | 27 / 1.5 | 400 | 0 | ink |
| Small | nested lists, column text, table cells | 21 / 1.4 | 400 | 0 | ink-2 |
| Caption, attribution, labels | `figcaption`, `.attrib`, `th` | 13 / 1.3, mono, uppercase | 400 | 0.12em | ink-2 |
| Code | `pre`, `code` | 20 / 1.5, mono | 400 | 0 | ink |
| Quote | `blockquote` in `quote` | 44 / 1.2 (32 / 1.3 above 140 characters) | 400 | -0.015em | ink |
| Statement | `p` in `statement` | `xs` 240 / 0.9 · `s` 104 / 1.0 · `m` 72 / 1.08 · `l` 48 / 1.15 | 500 | -0.03em | ink |

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
| `title`, `section` | A column `min(100%, calc(1080px * var(--ts)))` wide, centered horizontally, with its content centered vertically on the stage. Text stays left-aligned. At Quiet this puts the left edge at about 26% of the width, as in the reference. The paragraphs under the `h1` use the Lede role and sit in one block with a `--ink` rule on the left, 0.11em wide, and 1.05em of padding between rule and text. The block starts 1.4em below the heading (target: the top of the rule is about 0.7× the heading's font size below the heading's baseline). `section` shows `attr(data-section)` above the heading as an eyebrow. |
| `statement` | Same centered column, `calc(1240px * var(--ts))` wide. A second paragraph becomes a caption (Caption role at 1.25× its size) 1.2em below. |
| `quote` | Same centered column, `calc(1160px * var(--ts))` wide. The blockquote has the same left rule (0.07em wide) and 0.8em of padding. Attribution 40 below, in caption style. No quotation-mark glyphs. |
| `columns` | Head on top. `.s-cols` is a grid of `data-count` equal columns (5 or 6 columns wrap to 3 per row), gap 56. Each column has a 1px `--ink` rule on top and 24 of padding above its content. Column text uses the Small role. |
| `split` | Two halves. The text half keeps the outer safe margin and a 72 inner margin, content centered vertically. The media half is full-bleed to the stage edges with `object-fit: cover`. With `data-imgfit="contain"` the media half gets 72 of padding and the image is contained. |
| `figure` | Head on top, the image fills the remaining safe area, contained, left-aligned. Caption below. |
| `image` | The image covers the whole stage. A caption, if any, sits bottom-left on a `--bg` strip with 8×12 padding. |
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
- **Background image** (`data-bg="image"`): the image covers the stage under a `rgb(0 0 0 / 0.45)` scrim.
- **Overflow flag** (`data-overflow`, dev only): a small `OVERFLOW` label in `--red`, mono, at the bottom-right of the slide.

### Chrome

| Element | Spec |
|---|---|
| Top bar | `--bar-top` (50px), transparent, 16px side padding. Left: 10×10 `--ink` square, 8px gap, deck title as a Label. Right: three 28×28 icon buttons with a 1px `--line` border, 6px apart, holding 13px icons: overview, fullscreen, settings. Hover turns the border `--ink`. A 1px `--line` hairline runs under the bar at full width. |
| Progress | A 1px `--ink` line on top of that hairline, from the left edge, width `(index + 1) / count`. |
| Bottom bar | `--bar-bottom` (46px), transparent, 20px side padding, 1px `--line` hairline above. Left: `←` `→` buttons in `--ink-4` (hover `--ink`), then the counter `01 / 36` as a Label with tabular numerals. Right: text buttons `NOTE` and `DRAW` as Labels in `--ink-4` (hover `--ink`). When zoomed, a `200%` Label appears before them and resets zoom on click. |
| Draw bar | Replaces the right side of the bottom bar in draw mode, as in the reference. A status Label `DRAW` in `--ink-4`, then tool names as Labels in `--ink-2`. The active tool has a 2px `--red` underline 4px below the text. Actions that are unavailable are `--ink-4`. `DONE` is `--red`. This is the only color in the chrome. |
| Icons | Inline SVG, 16×16 viewBox, 1px stroke, `stroke-linecap: square`, no fill, `currentColor`. Overview: a square divided 3×3. Fullscreen: four corner brackets. Settings: two horizontal lines each with a small square knob. |
| Auto-hide | `chrome: 'auto'`: bars are visible in a window; in fullscreen they fade out after 2.5s without pointer movement and return on movement. `'always'` and `'hidden'` do what they say. Fading is opacity only. |
| Sheet (settings) | Centered, 432px wide, 40px from the top and bottom of the window (max height `100vh - 80px`), scrolls inside. 1px solid `--ink` border, `--bg` background, 18px padding. Backdrop is `--scrim`. Header row: `SETTINGS` Label left, `CLOSE` text button right. |
| Section label | A Label with 28px above and 10px below. |
| Segmented control | Equal-width cells in a row, 1px `--line` borders (shared between cells), 8px side padding. Each cell has Control text and an optional Sublabel under it; cells are 41px tall with a sublabel and 30px without. Selected: `--fill` background, `--on-fill` text, sublabel at 60% opacity. |
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
3. `SlideView.svelte`: props `slide`, `step`, `revealAll`. Renders the element from the HTML contract, toggles `is-pending`, runs auto-fit, plays and pauses `video[data-autoplay]`.
4. `nav` state with the rules in §7, hash sync, clamping when the deck changes.
5. `commands.ts` and `keys.ts` with the full table from §7. Implement the Phase 3 commands; the rest are registered with empty `run` functions.
6. `settings` and `ui` state with every field from §5 and §7, persisted where specified.
7. `TopBar`, `BottomBar`, `Icon`, progress line, chrome auto-hide, fullscreen (`f`, and the top-bar button), theme toggle, effective theme on `<html>`.
8. Live reload: `import.meta.hot.on('dex:update', …)` refetches the deck and keeps the current slide by `id` when it still exists, otherwise clamps the index. With `settings.followEdits` on, jump to the first slide whose `hash` changed. `dex:error` shows `ErrorOverlay` (a mono `--red` line at the bottom-left with the message and line, dismissible) and keeps the last good deck.
9. Create every remaining component from the §7 skeleton as a stub, and mount them in `App.svelte`.
10. Basic slide CSS in `slide.css`: safe-area padding, the type roles from §8 for headings and body, `is-pending`, the `.current` fade. Enough to read the demo deck.
11. `playwright.config.ts` with a `webServer` that runs the dev server on a fixed port, Chromium only, viewport 1600×900. The `webServer` command is `vite --port <port> --strictPort`, not `pnpm start`, so no browser tab opens on the owner's machine. On a machine or worktree where Chromium is not installed yet, run `pnpm exec playwright install chromium` once. `e2e/smoke.spec.ts` covering the acceptance list.

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

1. `slide.css`: all content elements from §8.
2. `layouts.css`: one block per `data-layout`, per the geometry table. Derive every position from `--W`, `--H`, and the margin variables so 16:10 and 4:3 also work.
3. `code.css`: code blocks, line highlighting, inline code.
4. Density and text-scale variables wired into every font size.
5. `e2e/shots.spec.ts` (run by `pnpm shots`): for the demo deck, screenshot the stage for every slide in Paper and Ink at 1600×900 with builds fully revealed, into `docs/shots/<theme>/<nn>-<id>.png`. Also three slides at `quiet` and `loud`.
6. Review loop: run `pnpm shots`, open every image, fix, repeat. Compare, at the Quiet text size, the title slide with `docs/reference/maeda-title.png` and a default slide with `docs/reference/maeda-draw.png`, using the reference measurements in §8.

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
   | THEME | Paper · Ink |
   | TEXT | Quiet (screen share; the reference's size) · Regular (most rooms) · Loud (big rooms) |
   | BUILDS | On (step through lists) · Off (show everything) |
   | MOTION | On · Off |
   | CHROME | Auto (hides in fullscreen) · Always · Hidden |
   | MARKS | Shown · Hidden, then buttons `CLEAR THIS SLIDE` and `CLEAR ALL` (wired in Phase 6) |
   | FOLLOW EDITS | On (jump to the slide you are editing) · Off — only rendered when `import.meta.env.DEV` |
   | KEYS | The cheat sheet generated from the command registry, as Help text: `← → move · space build · g slides · …` |
   | DECK | Info rows: deck (a `<select>` of all decks; changing it navigates), slides, source path. Buttons `PRESENTER` and `PRINT / PDF` (wired in Phases 8 and 9). |

3. `Overview.svelte` (`g` or the overview icon): a full-window overlay on `--bg`. A grid of thumbnails, `repeat(auto-fill, minmax(260px, 1fr))`, gap 24. Each thumbnail is a real `SlideView` with `revealAll`, scaled by CSS transform inside a box with the stage's aspect ratio and a 1px `--line` border, `inert`, with `content-visibility: auto`. Under it, a Label: the zero-padded number and the title. The current slide has an `--ink` border. Skipped slides are at 40% opacity with a `SKIP` Label. Arrow keys move the selection, `Enter` or click opens the slide, `g` or `Esc` closes. Opening scrolls the current slide into view.
4. Go to slide: typing digits shows them as a Label in the bottom bar (`GO TO 12`); `Enter` jumps; `Esc` or 1.5s of no input cancels.
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
- Editing: a `<textarea>` filling the note. `Esc` or clicking outside finishes. An empty note is removed when editing ends.
- Notes are inside `.camera`, so they scale and zoom with the slide.

Laser (`Laser.svelte`): `l` toggles. A 14px `--red` dot follows the pointer with a short fading trail (the last 12 positions). Nothing is stored. The system cursor is hidden while it is on.

Also: `a` and the MARKS setting hide or show both layers. Wire `CLEAR THIS SLIDE` and `CLEAR ALL` in the settings sheet (`CLEAR ALL` asks for a second click on a `CONFIRM` state). The overview shows a small solid square next to the number of any slide that has marks.

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
   - All navigation keys work here and drive the audience window.
4. `Blackout.svelte`: `b` or `.` covers the window with solid `#000`; any key or click clears it. Synced.

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
3. The `PRINT / PDF` button in settings opens the print route.
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
| Canvas | Fixed 1600×900 stage scaled to the window | Fluid layout that reflows with the window, as Maeda's appears to. Rejected because marks, zoom, thumbnails, and PDF all depend on fixed coordinates. |
| Default type size | `Regular`, about 1.4× the reference's type, for legibility in a room. `Quiet` reproduces the reference's sizes. | Make `Quiet` the default. One-line change in `DEFAULT_SETTINGS`. |
| Marks storage | `decks/<slug>/marks.json`, written by the dev server, so marks survive browsers and can be committed | Browser storage only. Add `marks.json` to `.gitignore` if they should stay local. |
| Color in the UI | One accent, orange-red, and only in draw mode (the active tool's underline and `DONE`), as in the reference. Otherwise red and blue exist only as pen colors; yellow, pink, and blue only as sticky notes. | Use the accent elsewhere in the chrome, or nowhere. |
| Draw tools | Pen, marker, arrow, box, eraser. Arrow and box were added because the reference's draw bar has them. | Drop arrow and box to make Phase 6 smaller. |

### Deviations log

Executors: add a line here whenever the implementation differs from this plan. Format: `Phase N — what changed — why`.

- Phase 0 — `tsconfig.json` sets `"types": ["vite/client"]`, `moduleResolution: "bundler"`, and `paths` for `$shared/*` (no `baseUrl`, which TypeScript 6 deprecates).
- Phase 0 (follow-up by the planner) — the plan omitted `@types/node`, so no `node:*` import under `engine/` could type-check. Added `@types/node` ^22 to §2 and split type checking: `tsconfig.json` now covers only `src/` and `shared/`; a new `tsconfig.node.json` extends it with Node types and covers `engine/`, `shared/`, `e2e/`, and `*.config.ts` (so `vite.config.ts` is now checked). `pnpm check` runs `svelte-check` and then `tsc -p tsconfig.node.json`. Ground rule 13 records the boundary.
- Phase 0 — the `new` script points at `engine/scripts/new.mjs`, which Phase 2 creates; `test:e2e` and `shots` point at Playwright files Phase 3/4 create. They fail until then.
