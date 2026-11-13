// Phase 11: the PowerPoint export (PLAN.md §9 Phase 11). Each test presses the
// print view's POWERPOINT button, reads the downloaded .pptx with the
// store-only reader in unzip.ts, and parses its XML parts in the page with
// DOMParser. Marks come from a temporary deck under decks/zz-e2e-*; the demo
// deck is exported with MARKS off, so nothing here depends on marks someone
// drew on it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Marks } from '../shared/types.ts';
import { DECKS, removeTempDecks, writeDeck } from './temp-deck.ts';
import { unzip } from './unzip.ts';

const EMU = 9525;          // one stage pixel
const DEMO_SHOWN = 22;     // 23 slides, one of them skipped
// 1-based pages of the demo deck's print view.
const DEMO = { title: 1, statement: 2, bullets: 4, numbered: 5, gallery: 12, code: 15, table: 16 };

interface Run { text: string; font: string }
interface Shape {
  tag: string;               // p:sp, p:cxnSp, p:pic or p:graphicFrame
  name: string;
  x: number; y: number; cx: number; cy: number;
  textBox: boolean;
  fill: string | null;       // the shape's own solid fill, RRGGBB
  outline: boolean;
  freeform: boolean;
  arrow: boolean;
  breaks: number;
  rows: number;
  paragraphs: Run[][];
}

interface Pptx {
  name: string;
  parts: Map<string, Uint8Array>;
  text(part: string): string;
  slides: string[];          // part names, in order
}

const sheets = (page: Page) => page.locator('.print-sheet');
const pptxButton = (page: Page) => page.locator('[data-pptx-button]');

async function openPrint(page: Page, slug: string, count: number, marks: boolean) {
  await page.goto(`/#/${slug}/print`);
  await expect(sheets(page)).toHaveCount(count);
  const toggle = page.getByRole('button', { name: 'Marks' });
  if ((await toggle.getAttribute('aria-pressed')) !== String(marks)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(marks));
}

async function exportPptx(page: Page): Promise<Pptx> {
  const [download] = await Promise.all([page.waitForEvent('download'), pptxButton(page).click()]);
  const parts = unzip(readFileSync(await download.path()));
  const slides = [...parts.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  const text = (part: string) => {
    const bytes = parts.get(part);
    if (!bytes) throw new Error(`no part ${part}`);
    return new TextDecoder().decode(bytes);
  };
  return { name: download.suggestedFilename(), parts, text, slides };
}

/** The names of the XML parts that do not parse. Parsed in the page: DOMParser is the browser's. */
async function unparsable(page: Page, file: Pptx): Promise<string[]> {
  const xml = [...file.parts.keys()].filter((name) => /\.(xml|rels)$/.test(name)).map((name) => [name, file.text(name)] as const);
  expect(xml.length).toBeGreaterThan(10);
  return page.evaluate(
    (list) => list.filter(([, source]) => new DOMParser().parseFromString(source, 'application/xml').querySelector('parsererror')).map(([name]) => name),
    xml,
  );
}

/** The shapes of one slide part, in order. */
async function shapesOf(page: Page, file: Pptx, n: number): Promise<Shape[]> {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('the slide does not parse');
    const tags = (el: Element | Document, name: string) => [...el.getElementsByTagName(name)];
    const tree = tags(doc, 'p:spTree')[0]!;
    return [...tree.children]
      .filter((el) => ['p:sp', 'p:cxnSp', 'p:pic', 'p:graphicFrame'].includes(el.tagName))
      .map((el) => {
        const spPr = [...el.children].find((child) => child.tagName === 'p:spPr');
        const direct = (name: string) => (spPr ? [...spPr.children].find((child) => child.tagName === name) : undefined);
        const off = tags(el, 'a:off')[0];
        const ext = tags(el, 'a:ext')[0];
        const ln = direct('a:ln');
        return {
          tag: el.tagName,
          name: tags(el, 'p:cNvPr')[0]?.getAttribute('name') ?? '',
          x: Number(off?.getAttribute('x')),
          y: Number(off?.getAttribute('y')),
          cx: Number(ext?.getAttribute('cx')),
          cy: Number(ext?.getAttribute('cy')),
          textBox: tags(el, 'p:cNvSpPr')[0]?.getAttribute('txBox') === '1',
          fill: direct('a:solidFill') ? (tags(direct('a:solidFill')!, 'a:srgbClr')[0]?.getAttribute('val') ?? null) : null,
          outline: !!ln && tags(ln, 'a:solidFill').length > 0,
          freeform: tags(el, 'a:custGeom').length > 0,
          arrow: tags(el, 'a:tailEnd').length > 0,
          breaks: tags(el, 'a:br').length,
          rows: tags(el, 'a:tr').length,
          paragraphs: tags(el, 'a:p').map((p) =>
            tags(p, 'a:r').map((r) => ({ text: tags(r, 'a:t')[0]?.textContent ?? '', font: tags(r, 'a:latin')[0]?.getAttribute('typeface') ?? '' })),
          ),
        };
      });
  }, file.text(file.slides[n - 1]!));
}

const textOf = (shape: Shape) => shape.paragraphs.map((runs) => runs.map((run) => run.text).join('')).join('\n');
const withText = (shapes: Shape[], text: string) => shapes.filter((shape) => textOf(shape).includes(text));

test.describe('PowerPoint export of the demo deck', () => {
  test('downloads dex.pptx: a sound archive, 22 slides at the stage size, notes on every slide', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN, false);
    const file = await exportPptx(page);
    expect(file.name).toBe('dex.pptx');
    expect([...file.parts.keys()][0]).toBe('[Content_Types].xml');
    expect(await unparsable(page, file)).toEqual([]);

    expect(file.slides).toHaveLength(DEMO_SHOWN);
    const presentation = file.text('ppt/presentation.xml');
    expect(presentation).toContain('<p:sldSz cx="15240000" cy="8572500"/>');
    expect(presentation.match(/<p:sldId /g)).toHaveLength(DEMO_SHOWN);
    // Every demo slide has a speaker note.
    for (let n = 1; n <= DEMO_SHOWN; n++) {
      expect(file.parts.has(`ppt/notesSlides/notesSlide${n}.xml`), `notes for slide ${n}`).toBe(true);
    }
    expect(file.text('ppt/notesSlides/notesSlide1.xml')).toContain('The title slide.');
    expect(file.text('docProps/core.xml')).toContain('<dc:title>dex</dc:title>');

    // The button is ready for another export.
    await expect(pptxButton(page)).toBeEnabled();
    await expect(pptxButton(page)).toHaveText('PowerPoint');
  });

  test('SKIPPED SLIDES on adds the skipped slide', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN, false);
    await page.getByRole('button', { name: 'Skipped slides' }).click();
    await expect(sheets(page)).toHaveCount(DEMO_SHOWN + 1);
    const file = await exportPptx(page);
    expect(file.slides).toHaveLength(DEMO_SHOWN + 1);
    const skipped = (await Promise.all(file.slides.map((_, i) => shapesOf(page, file, i + 1)))).filter((shapes) => withText(shapes, 'A skipped slide').length > 0);
    expect(skipped).toHaveLength(1);
  });

  test('text is text: titles, lists, the table and the code are editable shapes', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN, false);
    const file = await exportPptx(page);

    // The title slide: the eyebrow in DM Mono, the title in DM Sans, each one text box.
    const title = await shapesOf(page, file, DEMO.title);
    const runs = title.flatMap((shape) => shape.paragraphs.flat());
    expect(runs).toContainEqual({ text: 'dex', font: 'DM Sans' });
    expect(runs).toContainEqual({ text: 'MARKDOWN IN, DECK OUT', font: 'DM Mono' });
    const heading = title.filter((shape) => textOf(shape) === 'dex');
    expect(heading).toHaveLength(1);
    expect(heading[0]!.textBox).toBe(true);
    // The rule beside the lede is a line, not a thin rectangle.
    expect(title.filter((shape) => shape.tag === 'p:cxnSp')).toHaveLength(1);
    // The print view's page number is not exported.
    expect(withText(title, '01 / 22')).toEqual([]);

    // The statement: the browser's balanced line break is kept.
    const statement = await shapesOf(page, file, DEMO.statement);
    expect(statement.reduce((n, shape) => n + shape.breaks, 0)).toBeGreaterThan(0);

    // A simple list is one text box with a paragraph per item, the marker typed.
    const bullets = withText(await shapesOf(page, file, DEMO.bullets), 'Press → or Space');
    expect(bullets).toHaveLength(1);
    expect(bullets[0]!.paragraphs).toHaveLength(3);
    for (const paragraph of bullets[0]!.paragraphs) expect(paragraph[0]).toEqual({ text: '▪\t', font: 'Arial' });

    // Nested items are paragraphs of the same box: four numbered, two dashed.
    const numbered = withText(await shapesOf(page, file, DEMO.numbered), 'Comments are read');
    expect(numbered).toHaveLength(1);
    expect(numbered[0]!.paragraphs.map((p) => p[0]!.text)).toEqual(['01\t', '02\t', '–\t', '–\t', '03\t', '04\t']);
    expect(numbered[0]!.paragraphs[0]![0]!.font).toBe('DM Mono');

    // The gallery: three pictures.
    const gallery = await shapesOf(page, file, DEMO.gallery);
    expect(gallery.filter((shape) => shape.tag === 'p:pic')).toHaveLength(3);
    expect([...file.parts.keys()].filter((name) => name.startsWith('ppt/media/')).length).toBeGreaterThanOrEqual(3);

    // The table: a real table, header and six rows.
    const table = (await shapesOf(page, file, DEMO.table)).filter((shape) => shape.tag === 'p:graphicFrame');
    expect(table).toHaveLength(1);
    expect(table[0]!.rows).toBe(7);
    expect(textOf(table[0]!)).toContain('THE SLIDE CONTAINS');
    expect(file.text(file.slides[DEMO.table - 1]!)).toContain('<a:tbl>');

    // The code: one text box, a paragraph per line, all of it DM Mono.
    const code = withText(await shapesOf(page, file, DEMO.code), 'compileDeck(source');
    expect(code).toHaveLength(1);
    expect(code[0]!.paragraphs).toHaveLength(6);
    for (const paragraph of code[0]!.paragraphs) {
      expect(paragraph.length).toBeGreaterThan(0);
      for (const run of paragraph) expect(run.font).toBe('DM Mono');
    }
    expect(code[0]!.paragraphs[4]![0]!.text.startsWith('  console')).toBe(true);
  });

  test('positions do not depend on the window', async ({ page }) => {
    const offsets: number[][] = [];
    for (const width of [1000, 1800]) {
      await page.setViewportSize({ width, height: 900 });
      await openPrint(page, 'demo', DEMO_SHOWN, false);
      const shapes = await shapesOf(page, await exportPptx(page), DEMO.title);
      offsets.push(shapes.flatMap((shape) => [shape.x, shape.y, shape.cx, shape.cy]));
    }
    const [narrow, wide] = offsets as [number[], number[]];
    expect(narrow.length).toBeGreaterThan(8);
    expect(wide).toHaveLength(narrow.length);
    for (const [i, value] of narrow.entries()) expect(Math.abs(value - wide[i]!), `value ${i}`).toBeLessThanOrEqual(EMU);
    // And they are stage coordinates: the title starts on the 8% margin or right of it.
    expect(Math.min(...narrow.filter((_, i) => i % 4 === 0))).toBeGreaterThanOrEqual(128 * EMU - 1);
  });

  test('the button reads EXPORTING while it works, and EXPORT FAILED shows until the next click', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN, false);
    const count = page.locator('[data-print-count]');

    // The exporter is loaded on the first click. Hold it back to see the busy state.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/lib\/pptx\/index\.ts/, async (route) => {
      await held;
      await route.abort();
    });
    await pptxButton(page).click();
    await expect(pptxButton(page)).toBeDisabled();
    await expect(pptxButton(page)).toHaveText('Exporting');
    await expect(count).toHaveText('22 pages');

    // It fails to load: the count says so, and the button is usable again.
    release();
    await expect(count).toHaveText('Export failed');
    await expect(pptxButton(page)).toBeEnabled();
    await expect(pptxButton(page)).toHaveText('PowerPoint');

    await page.getByRole('button', { name: 'Marks' }).click();
    await expect(count).toHaveText('22 pages');
  });
});

test.describe.serial('PowerPoint export with marks, on a 4:3 deck', () => {
  const slug = 'zz-e2e-pptx';
  const MARKS: Marks = {
    version: 1,
    slides: {
      two: {
        strokes: [
          { id: 's1', tool: 'pen', color: 'red', size: 6, points: [[200, 300, 0.5], [300, 330, 0.5], [400, 320, 0.5], [500, 340, 0.5], [600, 300, 0.5]] },
          { id: 's2', tool: 'arrow', color: 'blue', size: 6, points: [[900, 700, 0.5], [700, 560, 0.5]] },
          { id: 's3', tool: 'box', color: 'ink', size: 4, points: [[100, 600, 0.5], [300, 700, 0.5]] },
        ],
        notes: [{ id: 'n1', x: 700, y: 200, w: 220, h: 160, text: 'Sticky text\nsecond line', color: 'yellow' }],
      },
    },
  };

  test.beforeAll(() => {
    removeTempDecks();
    writeDeck(slug, [
      '---\ntitle: \'Marks: "4/3"?\'\naspect: "4:3"\n---\n\n# Marks deck',
      '## Two\n\n+ First\n+ Second\n\n<!-- Say this.\n\n- then this -->',
      '<!-- skip: true -->\n\n## Hidden',
      '## Four\n\nLast',
    ].join('\n\n---\n\n'));
    writeFileSync(join(DECKS, slug, 'marks.json'), JSON.stringify(MARKS));
  });
  test.afterAll(() => removeTempDecks());

  /** A token of the page as `RRGGBB`, so no colour is hard-coded here. */
  const token = (page: Page, name: string) =>
    page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().replace('#', '').toUpperCase(), name);

  test('with MARKS on: a freeform, an arrow, a box and the sticky note, on top of the slide', async ({ page }) => {
    await openPrint(page, slug, 3, true);
    await expect(page.locator('.print-sheet[data-slide="two"] .sticky')).toHaveCount(1);
    const file = await exportPptx(page);

    // The title, without the characters a file name cannot hold.
    expect(file.name).toBe('Marks 43.pptx');
    expect(await unparsable(page, file)).toEqual([]);
    expect(file.slides).toHaveLength(3);
    expect(file.text('ppt/presentation.xml')).toContain('<p:sldSz cx="11430000" cy="8572500"/>');

    const shapes = await shapesOf(page, file, 2);
    const list = withText(shapes, 'First');
    expect(list).toHaveLength(1);

    const pen = shapes.filter((shape) => shape.freeform);
    expect(pen).toHaveLength(1);
    expect(pen[0]!.fill).toBe(await token(page, '--red'));
    // The stroke runs from x 200 to 600, give or take its width.
    expect(Math.abs(pen[0]!.x - 200 * EMU)).toBeLessThan(8 * EMU);
    expect(Math.abs(pen[0]!.cx - 400 * EMU)).toBeLessThan(16 * EMU);

    const arrow = shapes.filter((shape) => shape.arrow);
    expect(arrow).toHaveLength(1);
    expect(arrow[0]).toMatchObject({ tag: 'p:cxnSp', x: 700 * EMU, y: 560 * EMU, cx: 200 * EMU, cy: 140 * EMU });
    expect(file.text(file.slides[1]!)).toContain('<a:xfrm flipH="1" flipV="1"><a:off x="6667500" y="5334000"/>');

    const box = shapes.filter((shape) => shape.tag === 'p:sp' && shape.outline && !shape.textBox);
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({ x: 100 * EMU, y: 600 * EMU, cx: 200 * EMU, cy: 100 * EMU });

    const note = withText(shapes, 'Sticky text');
    expect(note).toHaveLength(1);
    expect(note[0]).toMatchObject({ textBox: true, x: 700 * EMU, y: 200 * EMU, cx: 220 * EMU, fill: await token(page, '--note-yellow') });
    expect(note[0]!.cy).toBeGreaterThanOrEqual(160 * EMU);
    expect(note[0]!.paragraphs.map((p) => p.map((run) => run.text).join(''))).toEqual(['Sticky text', 'second line']);
    expect(note[0]!.paragraphs[0]![0]!.font).toBe('DM Sans');

    // Marks are drawn last: strokes, then notes.
    const order = [list[0]!, pen[0]!, arrow[0]!, box[0]!, note[0]!].map((shape) => shapes.indexOf(shape));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(order[4]).toBe(shapes.length - 1);

    // Speaker notes: a paragraph per block, a list item with a bullet. Only this slide has any.
    const notes = file.text('ppt/notesSlides/notesSlide2.xml');
    expect([...notes.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1])).toEqual(['Say this.', '• then this']);
    expect([...file.parts.keys()].filter((name) => /notesSlide\d+\.xml$/.test(name))).toEqual(['ppt/notesSlides/notesSlide2.xml']);

    // The slides without marks have none.
    for (const n of [1, 3]) expect((await shapesOf(page, file, n)).filter((shape) => shape.freeform || shape.arrow)).toEqual([]);
  });

  test('with MARKS off: none of them', async ({ page }) => {
    await openPrint(page, slug, 3, false);
    await expect(page.locator('.print-sheet[data-slide="two"] .sticky')).toHaveCount(0);
    const file = await exportPptx(page);
    const shapes = await shapesOf(page, file, 2);
    expect(withText(shapes, 'First')).toHaveLength(1);
    expect(shapes.filter((shape) => shape.freeform || shape.arrow)).toEqual([]);
    expect(withText(shapes, 'Sticky text')).toEqual([]);
    expect(shapes.filter((shape) => shape.tag === 'p:sp' && shape.outline && !shape.textBox)).toEqual([]);
  });
});
