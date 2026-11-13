# dex

Markdown in, deck out. You write a talk as one Markdown file in your own editor, and present it from the browser. Saving the file updates the open deck in place, without a reload, and shows the slide you just changed (Settings → Follow edits turns that off).

Two themes (Paper and Ink), a presenter window with notes and a timer, drawing and sticky notes, zoom, and a PDF from the browser's print dialog. Everything runs locally; nothing is fetched from the network while you present.

## Install and start

You need Node 22.12 or later and pnpm 10.

```sh
pnpm install
pnpm start          # opens the browser at the list of decks (or the deck, if there is one)
pnpm start demo     # opens one deck directly
```

`decks/demo` is a tour of every feature. Open it, press `m` on any slide to see the Markdown behind it, and `m` again to close.

## Your first deck

```sh
pnpm new talk       # creates decks/talk/deck.md and decks/talk/media/
pnpm start talk
```

`pnpm new` writes a five-slide starter deck. Replace it with your own, for example:

```markdown
# My talk

What this talk is about, in one line.

---

## Three things

+ The first point
+ The second point
+ The third point
```

Save, and the browser shows the change. A line of three dashes starts a new slide; the rest is ordinary Markdown.

## Writing slides

A deck is `decks/<name>/deck.md`. Names use lowercase letters, digits, and hyphens. Put images anywhere inside the deck's folder; `media/` is the usual place.

Here is a whole deck. It needs no layout syntax: each slide's layout comes from what is on it.

````markdown
---
title: Product Simplicity
author: Adam Scott
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

That is a title slide (with a speaker note), a list that builds one item at a time, a slide split between a picture and text, a quote, and a big number.

### Slides

- A line with only `---` starts a new slide, even directly under a line of text. Inside a fenced code block it is just text.
- Slides are CommonMark plus GitHub's extras (tables, strikethrough, task lists, footnotes), plus raw HTML.
- A footnote, and a link reference, must be on the same slide that uses it.

### Settings for the whole deck

An optional block at the very top, between two `---` lines:

| Key | Values | Default |
|---|---|---|
| `title` | text | the first slide's heading |
| `author`, `date` | text | none |
| `theme` | `paper`, `ink` | `paper` |
| `aspect` | `16:9`, `16:10`, `4:3` | `16:9` |
| `build` | `true` makes every list build step by step | `false` |
| `transition` | `fade`, `none` | `fade` |
| `lang` | a language tag, such as `en` or `fr` | `en` |

### Headings and layouts

| Write | You get |
|---|---|
| `#` with up to two short paragraphs | A title slide. A `#` on its own after the first slide is a numbered section divider. |
| `##` | The slide's title, with the content under it |
| Two to six `###` headings | One column per heading |
| A line with only `\|\|\|` | A column break |
| `######` above a heading | A small label above it (an eyebrow) |
| One or two short paragraphs, no heading | A statement in very large type. A first paragraph of up to eight characters, such as `73%`, is a giant number with the second paragraph as its label. |
| Only a blockquote | A quote. A last line starting with `—` or `--` is the attribution. |
| Only one image | The image fills the screen |
| A heading and one image | A figure: title on top, image below |
| One image and some text | A split slide. The image goes on the left if it comes first, otherwise on the right. |
| Two or more images, and at most a heading | A gallery |

When a slide holds too much text, dex sets it smaller, in two steps, until it fits. A slide that still does not fit is marked `OVERFLOW` while you edit.

### Builds

- A list written with `+` shows one item per step. Lists written with `-` or `*` show all at once.
- A line with only `. . .` is a pause: everything after it waits for the next step.
- Nested items appear with their parent.

### Speaker notes and slide options

Any HTML comment on a slide is a speaker note, shown only in the presenter window. Notes can use Markdown.

```markdown
<!-- Pause here. Ask who has shipped something this week. -->
```

A comment made only of `key: value` pairs from the table below sets options for its slide instead. Pairs are separated by commas or new lines.

```markdown
<!-- layout: statement, invert: true -->
```

| Option | Values | Does |
|---|---|---|
| `layout` | `default` `title` `section` `statement` `quote` `image` `figure` `split` `gallery` `columns` `full` | Overrides the layout. `full` removes all padding, for an iframe or your own HTML. |
| `invert` | `true` | Shows this slide in the other theme |
| `build` | `true`, `false` | Turns builds on or off for this slide's lists |
| `image` | `left`, `right` | Which side the image takes on a split slide |
| `fit` | `cover`, `contain` | Crop the image to fill its space, or show all of it |
| `align` | `top`, `center` | Where the content sits on a plain slide |
| `bg` | an image path or a CSS colour | A background. An image gets a dark scrim and the slide switches to Ink. |
| `class` | class names | Extra classes on the slide, for your own CSS |
| `id` | text | A fixed name for the slide; drawings and notes are attached by it |
| `skip` | `true` | Leaves the slide out of the talk; it stays in the overview, dimmed |
| `transition` | `fade`, `none` | The transition into this slide |

Keep `---` out of comments: it still starts a new slide. A misspelt option (`layuot`) is reported in the terminal and as `1 WARNING` in the bottom bar; click it to jump to the slide.

### Images, video, and code

- `![What it shows](media/photo.jpg "A caption")`: the quoted text after the path becomes a visible caption. Paths are relative to the deck's folder; web addresses work too.
- A path ending in `.mp4`, `.webm`, or `.mov` is a video with controls. The words `autoplay`, `loop`, and `muted` in the description turn those on; an autoplay video starts when its slide is shown and pauses when you leave it.
- A missing image shows as a framed box with its path, and the terminal names the missing file.
- Code blocks are highlighted. ` ```ts {2,4-5} ` highlights lines 2, 4, and 5 and dims the rest.

## Presenting

| Keys | Does |
|---|---|
| `→` `Space` `PageDown` | Next step or slide |
| `←` `Shift+Space` `PageUp` | Previous step or slide |
| `↓` / `↑` | Next / previous slide, skipping builds |
| `Home` / `End` | First / last slide |
| a number, then `Enter` | Go to that slide |
| `f` | Fullscreen |
| `t` | Switch between Paper and Ink |
| `h` | Hide or show the bars |
| `g` | Overview of every slide |
| `s` or `,` | Settings |
| `?` | Every keyboard shortcut |
| `m` | The Markdown of this slide |
| `p` | Open the presenter window |
| `b` or `.` | Black out the screen; any key brings it back |
| `d` | Draw (pen, marker, arrow, box, eraser) |
| `n` | New sticky note at the pointer |
| `l` | Laser pointer |
| `a` | Show or hide all drawings and notes |
| `c` | Clear this slide's drawings |
| `[` / `]` | Smaller / larger pen |
| `⌘Z` / `⇧⌘Z` (`Ctrl` on Windows and Linux) | Undo / redo drawings and notes |
| `z`, `+`, `-`, `0` | Zoom to 200% and back, zoom in, zoom out, reset |
| `Esc` | Close whatever is open |

You can also zoom with a trackpad pinch or `⌘`/`Ctrl` and the mouse wheel, and drag to move around while zoomed.

**Presenter window.** Press `p` (or Settings → Presenter). A second window opens with the current slide, the next one, your notes, a timer, and the time of day. Move it to your laptop screen and put the deck window, in fullscreen, on the projector. Either window drives the other. The timer starts on your first slide change; click it to pause, double-click to reset. If your browser blocks the window, allow pop-ups for the page.

**Clickers.** Most presentation clickers send `PageDown`, `PageUp`, and `b` or `.`, which dex understands. Click once inside the deck window first so it has the keyboard.

**Drawing and sticky notes.** Marks stay with their slide. While you run `pnpm start` they are saved to `decks/<name>/marks.json`, so you can commit them with the deck or delete the file to start clean. Settings has buttons to clear one slide or the whole deck.

**Settings.** Press `s` for text size (Quiet for screen sharing, Regular for most rooms, Loud for big ones), builds, motion, and when the bars hide. Press `?` for every keyboard shortcut.

## PDF

Press `s`, then **Print / PDF**. A new tab shows every slide as a page, with all builds revealed. Choose whether to include drawings and notes and any skipped slides, then press **Print** and save as PDF. In Chrome the pages keep the slide colours and the deck's shape.

## Sharing the deck as a website

```sh
pnpm build          # writes every deck to dist/
pnpm preview        # tries dist/ locally
```

`dist/` is a plain static site: copy it to any web host, at the root or in a subfolder. Navigation, the presenter window, drawing, and zoom all work there. Marks made on the website are kept in that browser only, and live reload is only for `pnpm start`.

## Commands

| Command | Does |
|---|---|
| `pnpm start [name]` | Start the editing server and open the browser |
| `pnpm new <name>` | Create `decks/<name>/deck.md` from the starter deck |
| `pnpm build` / `pnpm preview` | Build the static site into `dist/` / serve it locally |
| `pnpm check` | Type-check the code |
| `pnpm test` / `pnpm test:e2e` | Unit tests / browser tests |
| `pnpm shots` | Screenshot every demo slide into `docs/shots/` |
