import { expect, test, type Page } from '@playwright/test';
import { removeTempDecks, writeDeck } from './temp-deck.ts';

// Demo deck facts (decks/demo/deck.md, slides numbered from 1).
const COUNT = 23;
const BULLETS = 4;      // `+` list, 3 steps
const CODE = 15;        // focusable <pre>
const INVERT = 18;
const BG = 19;
const SKIPPED = 21;

const current = (page: Page) => page.locator('.slides > .slide.current');
const counter = (page: Page) => page.locator('.bottombar .counter');
const pad = (n: number) => String(n).padStart(2, '0');

async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(current(page)).toHaveCount(1);
}

async function expectSlide(page: Page, n: number, slug = 'demo', count = COUNT) {
  await expect(counter(page)).toHaveText(`${pad(n)} / ${pad(count)}`);
  await expect(page).toHaveURL(new RegExp(`#/${slug}/${n}$`));
}

test.describe('demo deck', () => {
  test('opening / goes to the only deck, on slide 1', async ({ page }) => {
    await page.goto('/');
    await expect(counter(page)).toHaveText(`01 / ${COUNT}`);
    await expect(page).toHaveURL(/#\/demo\/1$/);
    await expect(page.locator('.topbar .label')).toHaveText('dex demo');
  });

  test('→ reveals one build step per press, then moves on; ← returns fully revealed; ↓ skips builds', async ({ page }) => {
    await open(page, `#/demo/${BULLETS}`);
    const pending = current(page).locator('.is-pending');
    await expect(pending).toHaveCount(3);
    for (const left of [2, 1, 0]) {
      await page.keyboard.press('ArrowRight');
      await expectSlide(page, BULLETS);
      await expect(pending).toHaveCount(left);
    }
    await page.keyboard.press('ArrowRight');
    await expectSlide(page, BULLETS + 1);

    await page.keyboard.press('ArrowLeft');
    await expectSlide(page, BULLETS);
    await expect(current(page).locator('[data-step]')).toHaveCount(3);
    await expect(pending).toHaveCount(0);

    await open(page, `#/demo/${BULLETS}`);
    await page.keyboard.press('ArrowDown');
    await expectSlide(page, BULLETS + 1);
    await page.keyboard.press('ArrowUp');
    await expectSlide(page, BULLETS);
    await expect(pending).toHaveCount(3);
  });

  test('Space, Shift+Space, PageDown, PageUp, Home, End', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('Space');
    await expectSlide(page, 2);
    await page.keyboard.press('PageDown');
    await expectSlide(page, 3);
    await page.keyboard.press('PageUp');
    await expectSlide(page, 2);
    await page.keyboard.press('Shift+Space');
    await expectSlide(page, 1);
    await page.keyboard.press('End');
    await expectSlide(page, COUNT);
    await page.keyboard.press('Home');
    await expectSlide(page, 1);
  });

  test('the bottom-bar arrows navigate and do not keep focus', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.getByRole('button', { name: 'Next' }).click();
    await expectSlide(page, 2);
    await page.keyboard.press('Space');
    await expectSlide(page, 3);
    await page.getByRole('button', { name: 'Previous' }).click();
    await expectSlide(page, 2);
  });

  test('the hash follows the slide without history entries, and reloading stays there', async ({ page }) => {
    await open(page, '#/demo/1');
    const before = await page.evaluate(() => history.length);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expectSlide(page, 4);
    expect(await page.evaluate(() => history.length)).toBe(before);
    await page.reload();
    await expectSlide(page, 4);
  });

  test('the skip slide is never shown by → or ←', async ({ page }) => {
    await open(page, `#/demo/${SKIPPED - 1}`);
    await page.keyboard.press('ArrowRight');
    await expectSlide(page, SKIPPED + 1);
    await page.keyboard.press('ArrowLeft');
    await expectSlide(page, SKIPPED - 1);
    await page.keyboard.press('ArrowDown');
    await expectSlide(page, SKIPPED + 1);
    await page.keyboard.press('ArrowUp');
    await expectSlide(page, SKIPPED - 1);
  });

  test('navigation keys work while a code block has focus', async ({ page }) => {
    await open(page, `#/demo/${CODE}`);
    await current(page).locator('pre').focus();
    await page.keyboard.press('ArrowRight');
    await expectSlide(page, CODE + 1);
  });

  test('t flips the theme; invert and bg slides flip it and the bars follow', async ({ page }) => {
    const html = page.locator('html');
    const label = page.locator('.topbar .label');
    await open(page, '#/demo/1');
    await expect(html).toHaveAttribute('data-theme', 'paper');
    const paperLabel = await label.evaluate((el) => getComputedStyle(el).color);

    await page.keyboard.press('t');
    await expect(html).toHaveAttribute('data-theme', 'ink');
    await expect(current(page)).toHaveAttribute('data-theme', 'ink');
    const inkLabel = await label.evaluate((el) => getComputedStyle(el).color);
    expect(inkLabel).not.toBe(paperLabel);
    await page.keyboard.press('t');
    await expect(html).toHaveAttribute('data-theme', 'paper');

    await open(page, `#/demo/${INVERT - 1}`);
    await expect(html).toHaveAttribute('data-theme', 'paper');
    await page.keyboard.press('ArrowDown');
    await expectSlide(page, INVERT);
    await expect(html).toHaveAttribute('data-theme', 'ink');
    await expect(current(page)).toHaveAttribute('data-theme', 'ink');
    await expect(label).toHaveCSS('color', inkLabel);

    await page.keyboard.press('ArrowRight');
    await expectSlide(page, BG);
    await expect(html).toHaveAttribute('data-theme', 'ink');

    // With the deck in Ink, the invert slide shows Paper.
    await page.keyboard.press('t');
    await page.keyboard.press('ArrowLeft');
    await expectSlide(page, INVERT);
    await expect(html).toHaveAttribute('data-theme', 'paper');
  });

  test('a bg image resolves against the page, not the stylesheet', async ({ page }) => {
    await open(page, `#/demo/${BG}`);
    const bg = await current(page).locator('.slide-bleed').evaluate((el) => getComputedStyle(el).backgroundImage);
    // The scrim is a flat layer drawn over the picture, so the url() is the last layer.
    expect(bg.endsWith(`, url("${new URL('decks/demo/media/plate-4.svg', page.url()).href}")`)).toBe(true);
  });

  test('the theme override is remembered per deck', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('t');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
    await page.reload();
    await expect(counter(page)).toHaveText(`01 / ${COUNT}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
  });

  test('h hides and shows the chrome', async ({ page }) => {
    await open(page, '#/demo/1');
    const app = page.locator('.app');
    await expect(app).toHaveAttribute('data-chrome', 'shown');
    await page.keyboard.press('h');
    await expect(app).toHaveAttribute('data-chrome', 'hidden');
    await expect(page.locator('.topbar')).toHaveCSS('opacity', '0');
    await page.keyboard.press('h');
    await expect(app).toHaveAttribute('data-chrome', 'shown');
  });

  test('f toggles fullscreen; in fullscreen the chrome hides after 2.5s idle and returns on movement', async ({ page }) => {
    await open(page, '#/demo/1');
    const app = page.locator('.app');
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await expect(app).toHaveAttribute('data-chrome', 'shown');
    await expect(app).toHaveAttribute('data-chrome', 'hidden', { timeout: 4000 });
    await page.mouse.move(400, 400);
    await expect(app).toHaveAttribute('data-chrome', 'shown');
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  });

  test('the fullscreen button in the top bar works', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  });

  test('progress line is (index + 1) / count of the width', async ({ page }) => {
    await open(page, '#/demo/6');
    const width = await page.locator('.topbar .progress').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeCloseTo((1600 * 6) / COUNT, 0);
  });

  // In a window the bars are docked: the stage area is what is left between them.
  const BAR_TOP = 50;
  const BAR_BOTTOM = 46;

  for (const [w, h] of [[1600, 900], [1280, 720], [1024, 900], [2560, 1080]] as const) {
    test(`the stage is centered between the bars and fully visible at ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, '#/demo/1');
      const areaH = h - BAR_TOP - BAR_BOTTOM;
      const scale = Math.min(w / 1600, areaH / 900);
      await expect(page.locator('.stage')).toHaveAttribute('data-scale', scale.toFixed(4));
      const box = (await page.locator('.stage').boundingBox())!;
      expect(box.width).toBeCloseTo(1600 * scale, 0);
      expect(box.height).toBeCloseTo(900 * scale, 0);
      expect(box.x).toBeCloseTo((w - box.width) / 2, 0);
      expect(box.y).toBeCloseTo(BAR_TOP + (areaH - box.height) / 2, 0);
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.y).toBeGreaterThanOrEqual(BAR_TOP - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(w + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(h - BAR_BOTTOM + 0.5);
    });
  }

  test('hiding the chrome gives the stage the whole window', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await open(page, '#/demo/1');
    const area = page.locator('.viewport');
    expect(await area.boundingBox()).toEqual({ x: 0, y: BAR_TOP, width: 1600, height: 900 - BAR_TOP - BAR_BOTTOM });
    await page.keyboard.press('h');
    await expect(page.locator('.stage')).toHaveAttribute('data-scale', '1.0000');
    expect(await area.boundingBox()).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
  });

  // Windows are rarely the stage's shape. Full-bleed pictures and backgrounds
  // run past the stage to the edges of the stage area, never under the bars.
  for (const [w, h] of [[1024, 900], [2000, 1176]] as const) {
    test(`full-bleed layers fill the stage area and stop at the bars at ${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      type Box = { x: number; y: number; width: number; height: number };
      const area: Box = { x: 0, y: BAR_TOP, width: w, height: h - BAR_TOP - BAR_BOTTOM };
      // The stage re-fits a frame after its area changes, so poll.
      const fills = (selector: string, want: Box) =>
        expect(async () => {
          const box = await current(page).locator(selector).boundingBox();
          expect(box).not.toBeNull();
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(Math.abs(box![key] - want[key]), key).toBeLessThan(1);
          }
        }).toPass({ timeout: 3000 });

      await open(page, '#/demo/11');   // image layout
      await fills('.s-media img', area);

      await open(page, `#/demo/${BG}`);   // bg image
      await fills('.slide-bleed', area);

      await open(page, '#/demo/8');   // split, image on the right, cover
      const stage = (await page.locator('.stage').boundingBox())!;
      const half = stage.x + stage.width / 2;
      await fills('.s-media img', { x: half, y: area.y, width: w - half, height: area.height });

      // With the chrome hidden the same layers reach the edges of the window.
      await page.keyboard.press('h');
      await open(page, '#/demo/11');
      await fills('.s-media img', { x: 0, y: 0, width: w, height: h });
    });
  }

  test('clientToStage maps the pointer to stage coordinates at any window size', async ({ page }) => {
    for (const [w, h] of [[1600, 900], [1024, 900]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await open(page, '#/demo/1');
      // The middle of the stage area, which sits between the docked bars.
      const midY = BAR_TOP + (h - BAR_TOP - BAR_BOTTOM) / 2;
      await page.mouse.move(w / 2, midY);
      await page.mouse.move(w / 2 + 1, midY);
      const p = await page.evaluate(() => (window as unknown as { __dex: { ui: { pointer: { x: number; y: number; inside: boolean } } } }).__dex.ui.pointer);
      const scale = Math.min(w / 1600, (h - BAR_TOP - BAR_BOTTOM) / 900);
      expect(p.x).toBeCloseTo(800 + 1 / scale, 0);
      expect(p.y).toBeCloseTo(450, 0);
      expect(p.inside).toBe(true);
    }
  });

  test('a deck that does not exist shows a message, not a blank page', async ({ page }) => {
    await page.goto('/#/no-such-deck');
    await expect(page.getByText('Cannot open deck')).toBeVisible();
  });
});

// Live reload uses a temporary deck under decks/zz-e2e-*, never decks/demo.
test.describe.serial('live reload', () => {
  const slug = 'zz-e2e-live';
  const deckWith = (third: string) =>
    ['# Live deck', '---', '## Two\n\nSecond slide', '---', `## Three\n\n${third}`, '---', '## Four\n\nLast'].join('\n\n');

  test.beforeAll(() => removeTempDecks());
  test.afterAll(() => removeTempDecks());

  async function markPage(page: Page) {
    await page.evaluate(() => Object.assign(window, { __marker: 'same page' }));
  }

  async function expectSamePage(page: Page) {
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe('same page');
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  }

  test('an edit appears without a page load, and follow-edits jumps to it', async ({ page }) => {
    writeDeck(slug, deckWith('Original text'));
    await open(page, `#/${slug}/1`);
    await expectSlide(page, 1, slug, 4);
    await markPage(page);

    writeDeck(slug, deckWith('Edited on disk'));
    await expect(current(page)).toContainText('Edited on disk', { timeout: 10_000 });
    await expectSlide(page, 3, slug, 4);
    await expectSamePage(page);
  });

  test('an update that arrives while the deck is still opening does not lose the slide in the URL', async ({ page }) => {
    writeDeck(slug, deckWith('Before'));
    // Hold every deck.json response long enough for the edit below to land mid-open.
    await page.route(`**/decks/${slug}/deck.json`, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    const loading = page.goto(`/#/${slug}/3`);
    await page.waitForRequest(`**/decks/${slug}/deck.json`);
    writeDeck(slug, deckWith('During the open'));
    await loading;
    await expect(current(page)).toContainText('During the open', { timeout: 10_000 });
    await expectSlide(page, 3, slug, 4);
  });

  test('with follow-edits off, the current slide is kept by id', async ({ page }) => {
    writeDeck(slug, deckWith('Kept'));
    await open(page, `#/${slug}/3`);
    await page.evaluate(() => {
      (window as unknown as { __dex: { settings: { followEdits: boolean } } }).__dex.settings.followEdits = false;
    });
    await markPage(page);
    // Insert a slide before the current one.
    writeDeck(slug, deckWith('Kept').replace('## Two', '## Inserted\n\n---\n\n## Two'));
    await expectSlide(page, 4, slug, 5);
    await expect(current(page)).toContainText('Kept');
    await expectSamePage(page);
  });

  test('a compile error shows the error line and keeps the last good deck', async ({ page }) => {
    writeDeck(slug, deckWith('Still here'));
    await open(page, `#/${slug}/3`);
    await markPage(page);
    writeDeck(slug, `---\ntitle: [unclosed\n---\n\n${deckWith('Broken')}`);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText('Line');
    await expect(current(page)).toContainText('Still here');

    writeDeck(slug, deckWith('Fixed'));
    await expect(current(page)).toContainText('Fixed', { timeout: 10_000 });
    await expect(alert).toHaveCount(0);
    await expectSamePage(page);
  });

  test('compile warnings show in the bottom bar and link to their slide', async ({ page }) => {
    writeDeck(slug, deckWith('Fine').replace('## Two', '<!-- layuot: statement -->\n\n## Two'));
    await open(page, `#/${slug}/1`);
    const button = page.getByRole('button', { name: /1 warning/i });
    await expect(button).toBeVisible();
    await button.click();
    await page.getByRole('dialog', { name: 'Compile warnings' }).getByRole('button').first().click();
    await expectSlide(page, 2, slug, 4);
  });

  test('an empty deck says so, and fills in when slides are written', async ({ page }) => {
    writeDeck(slug, '');
    await page.goto(`/#/${slug}`);
    await expect(page.getByText('No slides yet')).toBeVisible();
    await expect(page.getByText(`decks/${slug}/deck.md`)).toBeVisible();
    await markPage(page);
    writeDeck(slug, '# Hello again');
    await expect(current(page)).toContainText('Hello again', { timeout: 10_000 });
    await expect(page.getByText('No slides yet')).toHaveCount(0);
    await expectSamePage(page);
  });

  test('with two decks, / lists them', async ({ page }) => {
    writeDeck(slug, deckWith('Listed'));
    await page.goto('/');
    await expect(page.locator('.index .row')).toHaveCount(2);
    await page.locator('.index .row', { hasText: 'Live deck' }).click();
    await expectSlide(page, 1, slug, 4);
  });
});
