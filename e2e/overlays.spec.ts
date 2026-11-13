// Phase 5: the settings sheet, the overview grid, go-to-slide, and the source
// view (PLAN.md §9 Phase 5). Demo deck facts as in smoke.spec.ts.

import { expect, test, type Page } from '@playwright/test';
import { removeTempDecks, writeDeck } from './temp-deck.ts';

const COUNT = 23;
const BULLETS = 4;      // `+` list, 3 steps
const CODE = 15;        // focusable <pre>
const SKIPPED = 21;

const current = (page: Page) => page.locator('.slides > .slide.current');
const counter = (page: Page) => page.locator('.bottombar .counter');
const sheet = (page: Page) => page.locator('.sheet');
const overview = (page: Page) => page.locator('.overview');
const pad = (n: number) => String(n).padStart(2, '0');

async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(current(page)).toHaveCount(1);
}

async function expectSlide(page: Page, n: number) {
  await expect(counter(page)).toHaveText(`${pad(n)} / ${COUNT}`);
  await expect(page).toHaveURL(new RegExp(`#/demo/${n}$`));
}

/** The segmented cell for `label` in the section headed `section`. */
function cell(page: Page, section: string, label: string) {
  return page.getByRole('radiogroup', { name: section }).getByRole('radio', { name: label, exact: false }).filter({ hasText: label });
}

async function reloadDeck(page: Page) {
  await page.reload();
  await expect(current(page)).toHaveCount(1);
}

const storedSettings = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('dex:settings') ?? '{}') as Record<string, unknown>);

test.describe('settings sheet', () => {
  test('s, comma, and the settings icon open it; Esc, s, CLOSE, and the backdrop close it', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('s');
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);

    await page.keyboard.press(',');
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('s');
    await expect(sheet(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Close' }).click();
    await expect(sheet(page)).toHaveCount(0);

    await page.keyboard.press('s');
    await page.mouse.click(40, 450);   // the backdrop, left of the sheet
    await expect(sheet(page)).toHaveCount(0);
  });

  test('has the sections in order, and the §8 sizes', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 817 });
    await open(page, '#/demo/1');
    await page.keyboard.press('s');
    await expect(sheet(page).locator('h3')).toHaveText(
      ['Theme', 'Text', 'Builds', 'Motion', 'Chrome', 'Marks', 'Follow edits', 'Keys', 'Deck'],
    );
    const m = await sheet(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const label = getComputedStyle(el.querySelector('h3')!);
      const heights = (q: string) => [...el.querySelectorAll<HTMLElement>(q)].map((c) => c.getBoundingClientRect().height);
      const radii = [...el.querySelectorAll<HTMLElement>('*')].filter((c) => getComputedStyle(c).borderRadius !== '0px').length;
      const shadows = [...el.querySelectorAll<HTMLElement>('*')].filter((c) => getComputedStyle(c).boxShadow !== 'none').length;
      return {
        width: r.width, top: r.top, bottomGap: innerHeight - r.bottom, left: r.left,
        padding: cs.padding, border: `${cs.borderTopWidth} ${cs.borderTopStyle}`, borderColor: cs.borderTopColor,
        scrolls: el.scrollHeight > el.clientHeight && cs.overflowY === 'auto',
        labelSize: label.fontSize, labelFamily: label.fontFamily, labelTransform: label.textTransform,
        cells: heights('.segmented .cell'),
        cellsWithoutSublabel: el.querySelectorAll('.segmented .cell:not(:has(.sublabel))').length,
        radii, shadows,
      };
    });
    expect(m.width).toBe(432);
    expect(m.left).toBe((1366 - 432) / 2);
    expect(m.top).toBe(40);
    expect(m.bottomGap).toBe(40);
    expect(m.padding).toBe('18px');
    expect(m.border).toBe('1px solid');
    const ink = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim());
    expect(ink).toBe('#0f1413');
    expect(m.borderColor).toBe('rgb(15, 20, 19)');
    expect(m.scrolls).toBe(true);
    expect(m.labelSize).toBe('10px');
    expect(m.labelFamily).toContain('DM Mono');
    expect(m.labelTransform).toBe('uppercase');
    // Every control is the same height and every cell has a sublabel.
    expect(new Set(m.cells)).toEqual(new Set([41]));
    expect(m.cellsWithoutSublabel).toBe(0);
    expect(m.radii).toBe(0);
    expect(m.shadows).toBe(0);

    // The selected cell is filled with --fill; the others have --line borders.
    const paper = cell(page, 'Theme', 'Paper');
    await expect(paper).toHaveAttribute('aria-checked', 'true');
    await expect(paper).toHaveCSS('background-color', 'rgb(15, 20, 19)');
    await expect(cell(page, 'Theme', 'Ink')).toHaveCSS('border-top-color', 'rgb(216, 227, 225)');
  });

  test('every control changes the app at once and survives a reload', async ({ page }) => {
    await open(page, `#/demo/${BULLETS}`);
    const app = page.locator('.app');
    await page.keyboard.press('s');

    // Theme (per deck).
    await cell(page, 'Theme', 'Ink').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');

    // Text: every slide font size follows.
    const h2 = current(page).locator('h2');
    const li = current(page).locator('li').first();
    const size = async () => [parseFloat(await h2.evaluate((e) => getComputedStyle(e).fontSize)), parseFloat(await li.evaluate((e) => getComputedStyle(e).fontSize))];
    const regular = await size();
    await cell(page, 'Text', 'Quiet').click();
    await expect(app).toHaveAttribute('data-text', 'quiet');
    const quiet = await size();
    expect(quiet[0]! / regular[0]!).toBeCloseTo(0.7, 2);
    expect(quiet[1]! / regular[1]!).toBeCloseTo(0.7, 2);
    await cell(page, 'Text', 'Loud').click();
    await expect(app).toHaveAttribute('data-text', 'loud');
    const loud = await size();
    expect(loud[0]! / regular[0]!).toBeCloseTo(1.25, 2);

    // Builds off: every item at once.
    await expect(current(page).locator('.is-pending')).toHaveCount(3);
    await cell(page, 'Builds', 'Off').click();
    await expect(current(page).locator('.is-pending')).toHaveCount(0);

    await cell(page, 'Motion', 'Off').click();
    await expect(app).toHaveAttribute('data-motion', 'off');
    await cell(page, 'Chrome', 'Always').click();
    await cell(page, 'Marks', 'Hidden').click();
    await cell(page, 'Follow edits', 'Off').click();

    expect(await storedSettings(page)).toMatchObject({
      textScale: 'loud', builds: false, motion: false, chrome: 'always', marks: false, followEdits: false,
    });

    await reloadDeck(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
    await expect(app).toHaveAttribute('data-text', 'loud');
    await expect(app).toHaveAttribute('data-motion', 'off');
    await expect(current(page).locator('.is-pending')).toHaveCount(0);
    await page.keyboard.press('s');
    for (const [section, label] of [['Theme', 'Ink'], ['Text', 'Loud'], ['Builds', 'Off'], ['Motion', 'Off'], ['Chrome', 'Always'], ['Marks', 'Hidden'], ['Follow edits', 'Off']] as const) {
      await expect(cell(page, section, label), `${section} ${label}`).toHaveAttribute('aria-checked', 'true');
    }
  });

  test('the CHROME control re-fits the stage', async ({ page }) => {
    await open(page, '#/demo/1');
    const stage = page.locator('.stage');
    const app = page.locator('.app');
    // Docked in a window: the stage fits between the bars.
    await expect(stage).toHaveAttribute('data-scale', ((900 - 50 - 46) / 900).toFixed(4));
    await page.keyboard.press('s');
    await cell(page, 'Chrome', 'Hidden').click();
    await expect(app).toHaveAttribute('data-chrome', 'hidden');
    await expect(app).not.toHaveAttribute('data-dock');
    await expect(stage).toHaveAttribute('data-scale', '1.0000');
    await cell(page, 'Chrome', 'Always').click();
    await expect(app).toHaveAttribute('data-dock', '');
    await expect(stage).toHaveAttribute('data-scale', ((900 - 50 - 46) / 900).toFixed(4));
  });

  test('arrow keys move a segmented selection and do not navigate', async ({ page }) => {
    await open(page, '#/demo/2');
    await page.keyboard.press('s');
    await cell(page, 'Text', 'Regular').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.app')).toHaveAttribute('data-text', 'loud');
    await expect(cell(page, 'Text', 'Loud')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.app')).toHaveAttribute('data-text', 'quiet');
    await expect(counter(page)).toHaveText(`02 / ${COUNT}`);
  });

  test('keys typed in the deck <select> do not run commands', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('s');
    const select = sheet(page).locator('select');
    await select.focus();
    for (const key of ['t', 'g', 'm', 'f', 'h', '1', 'Enter']) await page.keyboard.press(key);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
    await expect(overview(page)).toHaveCount(0);
    await expect(page.locator('.app')).toHaveAttribute('data-chrome', 'shown');
    await expect(page.locator('.bottombar .goto')).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
    // Esc still closes, even from the select.
    await select.focus();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
  });

  test('focus is trapped while open and returns to the page on close', async ({ page }) => {
    await open(page, `#/demo/${CODE}`);
    const pre = current(page).locator('pre');
    await pre.focus();
    await page.keyboard.press('s');
    await expect(sheet(page)).toBeFocused();
    const inside = () => page.evaluate(() => document.querySelector('.sheet')!.contains(document.activeElement));
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect(await inside(), `Tab ${i + 1}`).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside(), `Shift+Tab ${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(pre).toBeFocused();
  });

  test('the later-phase buttons are there; PRINT / PDF opens the print route in a new tab', async ({ page, context }) => {
    await open(page, '#/demo/3');
    await page.keyboard.press('s');
    // Nothing to clear until Phase 6 stores marks.
    await expect(sheet(page).getByRole('button', { name: 'Clear this slide' })).toBeDisabled();
    await expect(sheet(page).getByRole('button', { name: 'Clear all' })).toBeDisabled();
    await expect(sheet(page).getByRole('button', { name: 'Presenter' })).toBeEnabled();
    const opened = context.waitForEvent('page');
    await sheet(page).getByRole('button', { name: 'Print / PDF' }).click();
    // Phase 9: a new tab, so the deck stays where it is.
    await (await opened).waitForURL(/#\/demo\/print$/);
    await expect(page).toHaveURL(/#\/demo\/3$/);
  });

  test('KEYS is generated from the command registry', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('s');
    const keys = sheet(page).locator('.keys');
    await expect(keys).toContainText('← → move');
    await expect(keys).toContainText('space build');
    await expect(keys).toContainText('g slides');
    await expect(keys).toContainText('s settings');
    await expect(keys).toContainText('m markdown');
  });
});

test.describe.serial('settings sheet with two decks', () => {
  const slug = 'zz-e2e-switch';
  test.beforeAll(() => removeTempDecks());
  test.afterAll(() => removeTempDecks());

  test('the DECK select lists the decks and changing it opens that deck', async ({ page }) => {
    writeDeck(slug, '# Switched deck\n\n---\n\n## Second\n\nText');
    await open(page, '#/demo/5');
    await page.keyboard.press('s');
    const select = sheet(page).locator('select');
    await expect(select.locator('option')).toHaveCount(2);
    await select.selectOption(slug);
    await expect(page).toHaveURL(new RegExp(`#/${slug}/1$`));
    await expect(page.locator('.topbar .label')).toHaveText('Switched deck');
    await expect(sheet(page).locator('.row', { hasText: 'Slides' })).toContainText('2');
    await expect(sheet(page).locator('.row', { hasText: 'Source' })).toContainText(`decks/${slug}/deck.md`);
  });
});

test.describe('overview', () => {
  test('shows every slide, the current one with an --ink border and the skipped one dimmed', async ({ page }) => {
    await open(page, '#/demo/6');
    await page.keyboard.press('g');
    const thumbs = overview(page).locator('.thumb');
    await expect(thumbs).toHaveCount(COUNT);
    await expect(thumbs.locator('.slide')).toHaveCount(COUNT);
    // Real slides, every step revealed, inert and skipped when off-screen.
    await expect(thumbs.nth(BULLETS - 1).locator('.is-pending')).toHaveCount(0);
    await expect(thumbs.nth(BULLETS - 1).locator('.canvas')).toHaveAttribute('inert', '');
    await expect(thumbs.first().locator('.canvas')).toHaveCSS('content-visibility', 'auto');

    const ink = 'rgb(15, 20, 19)';
    await expect(thumbs.nth(5).locator('.frame')).toHaveCSS('border-top-color', ink);
    await expect(thumbs.nth(4).locator('.frame')).not.toHaveCSS('border-top-color', ink);

    const skipped = thumbs.nth(SKIPPED - 1);
    await expect(skipped.locator('.tag')).toHaveText('Skip');
    await expect(skipped.locator('.frame')).toHaveCSS('opacity', '0.4');
    await expect(skipped.locator('.num')).toHaveText(pad(SKIPPED));

    // The thumbnail is exactly its own shape: the slide fills the frame.
    const box = await thumbs.first().evaluate((t) => {
      const c = t.querySelector('.canvas')!.getBoundingClientRect();
      const s = t.querySelector('.slide')!.getBoundingClientRect();
      return { cw: c.width, ch: c.height, sw: s.width, sh: s.height };
    });
    expect(Math.abs(box.sw - box.cw)).toBeLessThan(0.5);
    expect(Math.abs(box.sh - box.ch)).toBeLessThan(0.5);
    expect(box.cw / box.ch).toBeCloseTo(16 / 9, 2);
  });

  test('arrow keys move the selection and Enter opens the slide', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('g');
    const hits = overview(page).locator('.hit');
    await expect(hits.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(hits.nth(2)).toBeFocused();
    const columns = await overview(page).locator('.grid').evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    await page.keyboard.press('ArrowDown');
    await expect(hits.nth(2 + columns)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    // The deck has not moved while selecting.
    await expect(counter(page)).toHaveText(`01 / ${COUNT}`);
    await page.keyboard.press('Enter');
    await expect(overview(page)).toHaveCount(0);
    await expectSlide(page, 2 + columns);
  });

  test('the skipped slide can be opened from the overview, and End selects the last slide', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('g');
    await overview(page).locator('.hit').nth(SKIPPED - 1).click();
    await expectSlide(page, SKIPPED);
    await page.keyboard.press('g');
    await page.keyboard.press('End');
    await expect(overview(page).locator('.hit').last()).toBeFocused();
    await page.keyboard.press('Enter');
    await expectSlide(page, COUNT);
  });

  test('opening scrolls the current slide into view; g and Esc close; the icon opens it', async ({ page }) => {
    await open(page, `#/demo/${COUNT}`);
    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(overview(page).locator('.thumb').last()).toBeInViewport();
    await page.keyboard.press('g');
    await expect(overview(page)).toHaveCount(0);
    await page.keyboard.press('g');
    await expect(overview(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overview(page)).toHaveCount(0);
    await expectSlide(page, COUNT);
  });

  test('opens quickly', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.evaluate(() => document.fonts.ready);
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (document.querySelectorAll('.overview .thumb .slide').length !== 23) return -1;
      return performance.now() - t0;
    });
    expect(ms).toBeGreaterThan(0);
    // Generous: this guards against a regression to seconds, not a benchmark.
    expect(ms).toBeLessThan(1000);
  });
});

test.describe('go to slide', () => {
  test('1, 2, Enter goes to slide 12, with GO TO 12 in the bottom bar', async ({ page }) => {
    await open(page, '#/demo/1');
    const label = page.locator('.bottombar .goto');
    await page.keyboard.press('1');
    await expect(label).toHaveText('Go to 1');
    await page.keyboard.press('2');
    await expect(label).toHaveText('Go to 12');
    await expect(label).toHaveCSS('text-transform', 'uppercase');
    await page.keyboard.press('Enter');
    await expect(label).toHaveCount(0);
    await expectSlide(page, 12);
  });

  test('0 after a digit is a digit; 0 alone is not; Enter alone does nothing', async ({ page }) => {
    await open(page, '#/demo/3');
    const label = page.locator('.bottombar .goto');
    await page.keyboard.press('0');
    await expect(label).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expectSlide(page, 3);
    await page.keyboard.press('1');
    await page.keyboard.press('0');
    await expect(label).toHaveText('Go to 10');
    await page.keyboard.press('Enter');
    await expectSlide(page, 10);
  });

  test('Esc cancels, and so do 1.5s without a digit; a number past the end lands on the last slide', async ({ page }) => {
    await open(page, '#/demo/2');
    const label = page.locator('.bottombar .goto');
    await page.keyboard.press('5');
    await page.keyboard.press('Escape');
    await expect(label).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expectSlide(page, 2);

    await page.keyboard.press('7');
    await expect(label).toHaveText('Go to 7');
    await expect(label).toHaveCount(0, { timeout: 2500 });
    await page.keyboard.press('Enter');
    await expectSlide(page, 2);

    await page.keyboard.press('9');
    await page.keyboard.press('9');
    await page.keyboard.press('Enter');
    await expectSlide(page, COUNT);
  });

  test('Esc closes the topmost thing first: the digits, then the overview', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('g');
    await page.keyboard.press('4');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bottombar .goto')).toHaveCount(0);
    await expect(overview(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overview(page)).toHaveCount(0);
    // Digits and Enter typed in the overview go to that slide and close it.
    await page.keyboard.press('g');
    await page.keyboard.press('8');
    await page.keyboard.press('Enter');
    await expect(overview(page)).toHaveCount(0);
    await expectSlide(page, 8);
  });
});

test.describe('source view', () => {
  test('m shows the slide’s Markdown; navigation still works; m and Esc close it', async ({ page }) => {
    await open(page, `#/demo/${BULLETS}`);
    const deck = await page.evaluate(async () => (await (await fetch('decks/demo/deck.json')).json()) as { slides: { source: string; line: number }[] });
    await page.keyboard.press('m');
    const view = page.locator('.source');
    await expect(view).toBeVisible();
    await expect(view.locator('pre')).toHaveText(deck.slides[BULLETS - 1]!.source);
    await expect(view.locator('.tag')).toHaveText('Markdown');
    await expect(view.locator('pre')).toHaveCSS('font-size', '22px');
    await expect(view.locator('pre')).toHaveCSS('font-family', /DM Mono/);

    // It covers the stage area exactly, between the docked bars.
    expect(await view.boundingBox()).toEqual({ x: 0, y: 50, width: 1600, height: 900 - 50 - 46 });

    await page.keyboard.press('ArrowDown');
    await expectSlide(page, BULLETS + 1);
    await expect(view.locator('pre')).toHaveText(deck.slides[BULLETS]!.source);

    await page.keyboard.press('m');
    await expect(view).toHaveCount(0);
    await page.keyboard.press('m');
    await expect(view).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
  });
});

test.describe('motion', () => {
  // The suite runs with reduced motion, which zeroes the durations already.
  test.use({ reducedMotion: 'no-preference' });

  test('MOTION off removes all transitions, and survives a reload', async ({ page }) => {
    await open(page, '#/demo/1');
    const duration = () => current(page).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(await duration()).not.toMatch(/^0s(, 0s)*$/);
    await page.keyboard.press('s');
    await cell(page, 'Motion', 'Off').click();
    expect(await duration()).toMatch(/^0s(, 0s)*$/);
    const sheetAnimation = await page.locator('.backdrop').evaluate((el) => getComputedStyle(el).animationDuration);
    expect(sheetAnimation).toBe('0s');
    await reloadDeck(page);
    expect(await duration()).toMatch(/^0s(, 0s)*$/);
  });
});
