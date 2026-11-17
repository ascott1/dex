// Phase 9: the print view and the PDF it makes (PLAN.md §9 Phase 9). The PDF
// checks read the file Chromium writes: its page objects and their size, and
// the first fill of each page's content stream, which is the page background.
// Marks come from a temporary deck under e2e/.decks/zz-e2e-*, never decks/demo.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import type { Marks } from '../shared/types.ts';
import { DECKS, removeTempDecks, writeDeck } from './temp-deck.ts';

const DEMO_SHOWN = 22;   // 23 slides, one of them skipped
const DEMO_BULLETS = 4;  // the `+` list, 3 steps

const sheets = (page: Page) => page.locator('.print-sheet');

async function openPrint(page: Page, slug: string, count: number) {
  await page.goto(`/#/${slug}/print`);
  await expect(sheets(page)).toHaveCount(count);
  // Everything the PDF draws must be in: fonts and every picture.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  });
}

interface PdfFacts {
  pages: number;
  mediaBoxes: number[][];
  /** The fill colour (`r g b rg`) each page's content stream paints first. */
  firstFills: string[];
}

function readPdf(pdf: Buffer): PdfFacts {
  const text = pdf.toString('latin1');
  const pages = text.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
  const mediaBoxes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) => m[1]!.trim().split(/\s+/).map(Number));
  const firstFills: string[] = [];
  const stream = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = stream.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    let body: string;
    try {
      body = inflateSync(pdf.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    // A page's content stream starts with its transform; fonts and images do not.
    if (!/^[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ cm\b/.test(body)) continue;
    const fill = /([\d.]+ [\d.]+ [\d.]+) rg/.exec(body);
    firstFills.push(fill ? fill[1]! : '');
  }
  return { pages, mediaBoxes, firstFills };
}

/** `rgb(235, 246, 244)` → `.9216 .9647 .9569`, as Chromium writes a fill colour. */
function pdfColour(css: string): string {
  const [r, g, b] = css.match(/\d+(\.\d+)?/g)!.map(Number);
  return [r!, g!, b!].map((v) => Number((v / 255).toFixed(4)).toString().replace(/^0\./, '.')).join(' ');
}

test.describe('print view on the demo deck', () => {
  test('the PDF has one page per shown slide, at the stage size, on Paper', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const facts = readPdf(pdf);
    expect(facts.pages).toBe(DEMO_SHOWN);

    // 1600×900 CSS px is 1200×675 pt. Chromium rounds the height a little.
    const [x0, y0, w, h] = facts.mediaBoxes[0]!;
    expect([x0, y0]).toEqual([0, 0]);
    expect(w).toBeCloseTo(1200, 0);
    expect(Math.abs(h! - 675)).toBeLessThan(0.5);

    // Every page starts by filling itself with Paper, not white.
    const paper = await page.locator('.print-sheet').first().locator('.print-page')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(paper).not.toBe('rgb(255, 255, 255)');
    expect(facts.firstFills).toHaveLength(DEMO_SHOWN);
    expect(new Set(facts.firstFills)).toEqual(new Set([pdfColour(paper)]));
  });

  test('in print every build step is revealed and the bar is hidden', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-bar')).toBeHidden();
    await expect(page.locator('.print-view .is-pending')).toHaveCount(0);
    const steps = page.locator('.print-view [data-step]');
    expect(await steps.count()).toBeGreaterThan(3);
    for (const opacity of await steps.evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity))) {
      expect(opacity).toBe('1');
    }
    // The bullet slide has all three items.
    const bullets = sheets(page).nth(DEMO_BULLETS - 1).locator('li[data-step]');
    await expect(bullets).toHaveCount(3);

    // Each page is exactly the stage, not scaled.
    const box = (await sheets(page).first().boundingBox())!;
    expect(box.width).toBeCloseTo(1600, 0);
    expect(box.height).toBeCloseTo(900, 0);
  });

  test('each slide carries its own theme and a page number', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN);
    const themes = await page.locator('.print-page > .slide').evaluateAll((els) => els.map((el) => el.getAttribute('data-theme')));
    expect(themes.filter((t) => t === 'ink')).toHaveLength(2);   // the invert slide and the bg-image slide
    await expect(sheets(page).first().locator('.print-number')).toHaveText('01 / 22');
    await expect(sheets(page).last().locator('.print-number')).toHaveText('22 / 22');
  });

  test('the skipped-slides toggle adds the skipped slide', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN);
    const toggle = page.getByRole('button', { name: 'Skipped slides' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(sheets(page)).toHaveCount(DEMO_SHOWN + 1);
    await expect(page.locator('[data-print-count]')).toHaveText('23 pages');
  });

  test('PRINT / PDF / PPTX in the settings opens the print view in a new tab and the deck stays put', async ({ page, context }) => {
    await page.goto('/#/demo/5');
    await expect(page.locator('.bottombar .counter')).toHaveText('05 / 23');
    await page.keyboard.press('s');
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Print / PDF / PPTX' }).click();
    const tab = await opened;
    await tab.waitForURL(/#\/demo\/print$/);
    await expect(tab.locator('.print-sheet')).toHaveCount(DEMO_SHOWN);
    await expect(page).toHaveURL(/#\/demo\/5$/);
    await expect(page.locator('.bottombar .counter')).toHaveText('05 / 23');
  });

  test('the PRINT button opens the print dialog', async ({ page }) => {
    await openPrint(page, 'demo', DEMO_SHOWN);
    await page.evaluate(() => {
      Object.assign(window, { __printed: 0 });
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await page.locator('[data-print-button]').click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  });
});

test.describe.serial('print view with marks, on a 4:3 deck', () => {
  const slug = 'zz-e2e-print';
  const MARKS: Marks = {
    version: 1,
    slides: {
      two: {
        strokes: [{ id: 's1', tool: 'pen', color: 'red', size: 6, points: [[200, 300, 0.5], [400, 320, 0.5], [600, 300, 0.5]] }],
        notes: [{ id: 'n1', x: 700, y: 200, w: 220, h: 160, text: 'Printed note', color: 'yellow' }],
      },
    },
  };

  test.beforeAll(() => {
    removeTempDecks();
    writeDeck(slug, [
      '---\ntitle: Print deck\naspect: "4:3"\n---\n\n# Print deck',
      '## Two\n\n+ First\n+ Second',
      '<!-- skip: true -->\n\n## Hidden',
      '## Four\n\nLast',
    ].join('\n\n---\n\n'));
    writeFileSync(join(DECKS, slug, 'marks.json'), JSON.stringify(MARKS));
  });
  test.afterAll(() => removeTempDecks());

  test('the PDF page is the deck’s stage size', async ({ page }) => {
    await openPrint(page, slug, 3);
    const facts = readPdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expect(facts.pages).toBe(3);
    const [, , w, h] = facts.mediaBoxes[0]!;
    expect(w).toBeCloseTo(900, 0);     // 1200 CSS px
    expect(Math.abs(h! - 675)).toBeLessThan(0.5);
  });

  test('marks follow the print view’s own toggle, not the MARKS setting', async ({ page }) => {
    await openPrint(page, slug, 3);
    const two = page.locator('.print-sheet[data-slide="two"]');
    await expect(two.locator('[data-stroke]')).toHaveCount(1);
    await expect(two.locator('.sticky')).toHaveCount(1);
    await expect(two.locator('.sticky')).toContainText('Printed note');

    const toggle = page.getByRole('button', { name: 'Marks' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(two.locator('[data-stroke]')).toHaveCount(0);
    await expect(two.locator('.sticky')).toHaveCount(0);

    // Hide marks in the deck: print starts with them off, and turning its own
    // toggle on shows them anyway.
    await page.goto(`/#/${slug}/2`);
    await expect(page.locator('.camera > svg.draw-layer [data-stroke]')).toHaveCount(1);
    await page.keyboard.press('a');
    await expect(page.locator('.camera > svg.draw-layer [data-stroke]')).toHaveCount(0);
    await openPrint(page, slug, 3);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(two.locator('[data-stroke]')).toHaveCount(0);
    await toggle.click();
    await expect(two.locator('[data-stroke]')).toHaveCount(1);
    await expect(two.locator('.sticky')).toHaveCount(1);
  });

  test('print keys: no overlays or tools open on the print route', async ({ page }) => {
    await openPrint(page, slug, 3);
    for (const key of ['s', 'g', 'm', '?', 'd', 'n', 'b']) await page.keyboard.press(key);
    const ui = await page.evaluate(() => {
      const u = (window as unknown as { __dex: { ui: { overlay: unknown; tool: unknown; blackout: boolean } } }).__dex.ui;
      return { overlay: u.overlay, tool: u.tool, blackout: u.blackout };
    });
    expect(ui).toEqual({ overlay: null, tool: null, blackout: false });
  });
});
