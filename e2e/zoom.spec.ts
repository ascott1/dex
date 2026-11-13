// Phase 7: zoom and pan (PLAN.md §9 Phase 7). Runs on a temporary deck under
// decks/zz-e2e-*, since some tests draw and place notes, which saves marks.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DECKS, removeTempDecks, writeDeck } from './temp-deck.ts';

const SLUG = 'zz-e2e-zoom';
const W = 1600;
const H = 900;

function writeZoomDeck(): void {
  writeDeck(SLUG, [
    '# Zoom deck\n\nA deck for zooming into.',
    '## Two\n\nSecond slide, with [a link](#somewhere) and text to look at closely.',
    '## Three\n\nThird slide.',
    '![A plate](media/plate-1.svg)',
  ].join('\n\n---\n\n'));
  const media = join(DECKS, SLUG, 'media');
  mkdirSync(media, { recursive: true });
  copyFileSync(join(DECKS, 'demo', 'media', 'plate-1.svg'), join(media, 'plate-1.svg'));
  writeFileSync(join(DECKS, SLUG, 'marks.json'), JSON.stringify({ version: 1, slides: {} }));
}

interface Cam { k: number; x: number; y: number }
type Dex = { __dex: { ui: { camera: Cam; tool: string | null }; marks: { loaded: boolean } } };

const current = (page: Page) => page.locator('.slides > .slide.current');
const strokes = (page: Page) => page.locator('.camera > svg.draw-layer [data-stroke]');
const notes = (page: Page) => page.locator('.notes-layer .sticky');
const zoomLabel = (page: Page) => page.locator('.bottombar .zoom');

async function open(page: Page, n = 1) {
  await page.goto(`/#/${SLUG}/${n}`);
  await expect(current(page)).toHaveCount(1);
  await page.waitForFunction(() => (window as unknown as Dex).__dex.marks.loaded);
}

const camera = (page: Page) => page.evaluate(() => ({ ...(window as unknown as Dex).__dex.ui.camera }));

/** Poll until the camera's k is `k` (a key zoom may ease). */
async function expectZoom(page: Page, k: number) {
  await expect.poll(async () => (await camera(page)).k, { timeout: 5000 }).toBeCloseTo(k, 4);
}

/** The camera, to within 0.01 stage px (pointer positions go through client pixels). */
async function expectCamera(page: Page, want: Cam) {
  const c = await camera(page);
  expect(c.k).toBeCloseTo(want.k, 4);
  expect(c.x).toBeCloseTo(want.x, 2);
  expect(c.y).toBeCloseTo(want.y, 2);
}

/** The stage's client rect and scale. */
async function stageBox(page: Page) {
  return page.locator('.stage').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, scale: r.width / (el as HTMLElement).offsetWidth };
  });
}

/** Client position of a stage-frame point (stage logical px before the camera). */
async function client(page: Page, x: number, y: number) {
  const b = await stageBox(page);
  return { x: b.left + x * b.scale, y: b.top + y * b.scale };
}

/** Slide coordinates (camera applied) under a client point, from the state. */
async function slideAt(page: Page, cx: number, cy: number) {
  const b = await stageBox(page);
  const c = await camera(page);
  const fx = (cx - b.left) / b.scale;
  const fy = (cy - b.top) / b.scale;
  return { x: (fx - c.x) / c.k, y: (fy - c.y) / c.k };
}

/** The camera's rendered rect must cover the stage's: no empty space inside the stage. */
async function covers(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector('.stage')!.getBoundingClientRect();
    const c = document.querySelector('.camera')!.getBoundingClientRect();
    const e = 0.5;
    return c.left <= s.left + e && c.top <= s.top + e && c.right >= s.right - e && c.bottom >= s.bottom - e;
  });
}

async function dragClient(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

test.describe.serial('zoom and pan', () => {
  test.beforeAll(() => {
    removeTempDecks();
    writeZoomDeck();
  });
  test.afterAll(() => removeTempDecks());
  test.beforeEach(() => writeZoomDeck());

  test('z zooms to 200% around the pointer and z again returns to 100%', async ({ page }) => {
    await open(page, 2);
    const at = await client(page, 400, 250);
    await page.mouse.move(at.x + 5, at.y + 5);
    await page.mouse.move(at.x, at.y);
    const before = await slideAt(page, at.x, at.y);

    await page.keyboard.press('z');
    await expectZoom(page, 2);
    const after = await slideAt(page, at.x, at.y);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    await expectCamera(page, { k: 2, x: -400, y: -250 });
    await expect(zoomLabel(page)).toHaveText('200%');
    // The rendered transform follows the state.
    await expect.poll(() => page.locator('.camera').evaluate((el) => getComputedStyle(el).transform))
      .toBe('matrix(2, 0, 0, 2, -400, -250)');
    await expect(page.locator('.viewport')).toHaveAttribute('data-pan', 'ready');
    expect(await page.locator('.viewport').evaluate((el) => getComputedStyle(el).cursor)).toBe('grab');

    await page.keyboard.press('z');
    await expectZoom(page, 1);
    expect(await camera(page)).toEqual({ k: 1, x: 0, y: 0 });
    await expect(zoomLabel(page)).toHaveCount(0);
    await expect(page.locator('.viewport')).not.toHaveAttribute('data-pan', /.*/);
  });

  test('+ and - step by 1.25× at the pointer; 0, Esc, and the percentage reset; 0 after digits is go-to', async ({ page }) => {
    await open(page, 2);
    const at = await client(page, 1200, 600);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('+');
    await expectZoom(page, 1.25);
    await expect(zoomLabel(page)).toHaveText('125%');
    await page.keyboard.press('+');
    await expectZoom(page, 1.5625);
    await page.keyboard.press('-');
    await expectZoom(page, 1.25);
    await page.keyboard.press('-');
    await expectZoom(page, 1);
    expect(await camera(page)).toEqual({ k: 1, x: 0, y: 0 });
    await page.keyboard.press('-');                  // never below 100%
    await expectZoom(page, 1);
    for (let i = 0; i < 12; i++) await page.keyboard.press('=');
    await expectZoom(page, 6);                       // never above 600%

    await page.keyboard.press('0');
    await expectZoom(page, 1);

    // `0` after other digits belongs to go-to and leaves the zoom alone.
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    await page.keyboard.press('2');
    await page.keyboard.press('0');
    await expect(page.locator('.bottombar .goto')).toHaveText(/20/);
    await expectZoom(page, 2);
    // Esc cancels the go-to first, then resets the zoom.
    await page.keyboard.press('Escape');
    await expect(page.locator('.bottombar .goto')).toHaveCount(0);
    await expectZoom(page, 2);
    await page.keyboard.press('Escape');
    await expectZoom(page, 1);

    await page.keyboard.press('z');
    await expectZoom(page, 2);
    await zoomLabel(page).click();
    await expectZoom(page, 1);
  });

  test('Ctrl/⌘ + wheel and pinch zoom around the cursor; the page itself never zooms', async ({ page }) => {
    await open(page, 2);
    // Whole pixels: a WheelEvent's clientX/clientY are integers.
    const raw = await client(page, 1000, 300);
    const at = { x: Math.round(raw.x), y: Math.round(raw.y) };
    await page.mouse.move(at.x, at.y);
    const before = await slideAt(page, at.x, at.y);
    const dpr = await page.evaluate(() => [window.devicePixelRatio, window.visualViewport?.scale ?? 1]);

    // A trackpad pinch arrives as small wheel deltas with ctrlKey.
    await page.keyboard.down('Control');
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -10);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await camera(page)).k).toBeCloseTo(Math.exp(0.5), 3);
    const after = await slideAt(page, at.x, at.y);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);

    // ⌘ + wheel too; a mouse-wheel notch is one capped step.
    const k = (await camera(page)).k;
    await page.keyboard.down('Meta');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Meta');
    await expect.poll(async () => (await camera(page)).k).toBeCloseTo(k * Math.exp(0.25), 3);
    const again = await slideAt(page, at.x, at.y);
    expect(again.x).toBeCloseTo(before.x, 2);
    expect(again.y).toBeCloseTo(before.y, 2);

    // The handler cancels the event, so the browser does not zoom the page.
    const prevented = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y)!;
      const send = (init: WheelEventInit) => {
        const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init });
        target.dispatchEvent(e);
        return e.defaultPrevented;
      };
      // Also over the top bar: the page must not zoom from there either.
      const bar = document.querySelector('.topbar')!;
      const overBar = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 20, ctrlKey: true, deltaY: 1 });
      bar.dispatchEvent(overBar);
      return { ctrl: send({ ctrlKey: true, deltaY: 1 }), meta: send({ metaKey: true, deltaY: -1 }), bar: overBar.defaultPrevented };
    }, at);
    expect(prevented).toEqual({ ctrl: true, meta: true, bar: true });
    expect(await page.evaluate(() => [window.devicePixelRatio, window.visualViewport?.scale ?? 1])).toEqual(dpr);
    expect(await covers(page)).toBe(true);

    // Pinching back out stops at 100%.
    await page.keyboard.down('Control');
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 25);
    await page.keyboard.up('Control');
    await expect.poll(() => camera(page)).toEqual({ k: 1, x: 0, y: 0 });
  });

  test('a plain wheel pans only while zoomed, within the clamp', async ({ page }) => {
    await open(page, 2);
    const at = await client(page, 800, 450);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, 200);
    expect(await camera(page)).toEqual({ k: 1, x: 0, y: 0 });

    await page.keyboard.press('z');
    await expectZoom(page, 2);
    const start = await camera(page);
    const { scale } = await stageBox(page);
    await page.mouse.wheel(80, 40);
    await expect.poll(async () => (await camera(page)).x).toBeCloseTo(start.x - 80 / scale, 3);
    await expect.poll(async () => (await camera(page)).y).toBeCloseTo(start.y - 40 / scale, 3);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(500, 500);
    await expect.poll(() => camera(page)).toEqual({ k: 2, x: -W, y: -H });
    expect(await covers(page)).toBe(true);
  });

  test('dragging pans while zoomed, and never shows empty space inside the stage', async ({ page }) => {
    await open(page, 4);   // a full-bleed picture: it fills the letterbox too
    const mid = await client(page, 800, 450);
    // At 100% a drag does nothing.
    await dragClient(page, mid, { x: mid.x + 200, y: mid.y + 100 });
    expect(await camera(page)).toEqual({ k: 1, x: 0, y: 0 });

    await page.mouse.move(mid.x, mid.y);
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    await expectCamera(page, { k: 2, x: -800, y: -450 });
    const { scale } = await stageBox(page);

    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 100, mid.y + 50, { steps: 5 });
    await expect(page.locator('.viewport')).toHaveAttribute('data-pan', 'active');
    expect(await page.locator('.viewport').evaluate((el) => getComputedStyle(el).cursor)).toBe('grabbing');
    await page.mouse.up();
    const moved = await camera(page);
    expect(moved.x).toBeCloseTo(-800 + 100 / scale, 3);
    expect(moved.y).toBeCloseTo(-450 + 50 / scale, 3);
    await expect(page.locator('.viewport')).toHaveAttribute('data-pan', 'ready');

    // Far past every edge: clamped, and the slide still covers the stage.
    await dragClient(page, mid, { x: mid.x + 3000, y: mid.y + 3000 });
    expect(await camera(page)).toEqual({ k: 2, x: 0, y: 0 });
    expect(await covers(page)).toBe(true);
    await dragClient(page, mid, { x: mid.x - 3000, y: mid.y - 3000 });
    expect(await camera(page)).toEqual({ k: 2, x: -W, y: -H });
    expect(await covers(page)).toBe(true);

    // At 600% too.
    for (let i = 0; i < 10; i++) await page.keyboard.press('+');
    await expectZoom(page, 6);
    // Inside the window: several drags, up and to the right.
    for (let i = 0; i < 8; i++) await dragClient(page, { x: mid.x - 500, y: mid.y + 300 }, { x: mid.x + 500, y: mid.y - 300 });
    expect(await camera(page)).toEqual({ k: 6, x: 0, y: -5 * H });
    expect(await covers(page)).toBe(true);
  });

  test('a pan does not click what it ends on; a click without moving still does', async ({ page }) => {
    await open(page, 2);
    const link = current(page).locator('a');
    const box = (await link.boundingBox())!;
    const on = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(on.x, on.y);
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    await page.evaluate(() => {
      (window as unknown as { clicks: number }).clicks = 0;
      document.querySelector('.slides > .slide.current a')!.addEventListener('click', () => {
        (window as unknown as { clicks: number }).clicks++;
      });
    });
    const zoomed = (await link.boundingBox())!;
    const target = { x: zoomed.x + zoomed.width / 2, y: zoomed.y + zoomed.height / 2 };
    await dragClient(page, target, { x: target.x + 60, y: target.y + 30 });
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
    const after = (await link.boundingBox())!;
    await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(1);
  });

  test('dragging a sticky note moves the note, not the camera; with a tool on, a drag is the tool’s', async ({ page }) => {
    await open(page, 2);
    const at = await client(page, 500, 300);
    await page.mouse.move(at.x + 4, at.y + 4);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('n');
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.type('Zoom me');
    await page.keyboard.press('Escape');

    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    const cam = await camera(page);
    const note = (await notes(page).first().boundingBox())!;
    const from = { x: note.x + 40, y: note.y + 40 };
    const xBefore = await notes(page).first().evaluate((el) => parseFloat((el as HTMLElement).style.left));
    await dragClient(page, from, { x: from.x + 120, y: from.y + 60 });
    expect(await camera(page)).toEqual(cam);
    const { scale } = await stageBox(page);
    // The note moved by the drag in slide pixels (client / scale / k).
    await expect.poll(() => notes(page).first().evaluate((el) => parseFloat((el as HTMLElement).style.left)))
      .toBeCloseTo(xBefore + 120 / scale / 2, -1);

    // Draw mode owns the stage area: a drag draws and does not pan.
    await page.keyboard.press('d');
    await expect(page.locator('.viewport')).not.toHaveAttribute('data-pan', /.*/);
    const mid = await client(page, 800, 600);
    await dragClient(page, mid, { x: mid.x + 150, y: mid.y + 40 });
    await expect(strokes(page)).toHaveCount(1);
    expect(await camera(page)).toEqual(cam);
  });

  test('a stroke drawn while zoomed lands under the pointer and stays on the same content after reset', async ({ page }) => {
    await open(page, 2);
    // Zoom 200% on the bottom-right corner.
    const corner = await client(page, W, H);
    await page.mouse.move(corner.x - 1, corner.y - 1);
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    // Then right into the corner with the wheel (the clamp makes it exact).
    await page.mouse.wheel(4000, 4000);
    await expect.poll(() => camera(page)).toEqual({ k: 2, x: -W, y: -H });

    await page.keyboard.press('d');
    const a = await client(page, 1000, 500);
    const b = await client(page, 1400, 700);
    // Where those client points are on the slide, at 200% on the corner.
    const sa = await slideAt(page, a.x, a.y);
    const sb = await slideAt(page, b.x, b.y);
    expect(sa.x).toBeCloseTo(1300, 3);
    expect(sb.y).toBeCloseTo(800, 3);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await expect(strokes(page)).toHaveCount(1);

    // Drawn under the pointer: the stroke's client box spans the drag.
    const zoomedBox = (await strokes(page).first().boundingBox())!;
    expect(zoomedBox.x).toBeLessThan(a.x + 2);
    expect(zoomedBox.x + zoomedBox.width).toBeGreaterThan(b.x - 2);
    expect(zoomedBox.y).toBeLessThan(a.y + 2);
    expect(zoomedBox.y + zoomedBox.height).toBeGreaterThan(b.y - 2);

    // In slide coordinates it runs from (1300, 700) to (1500, 800).
    const bbox = await strokes(page).first().evaluate((el) => {
      const r = (el as SVGGraphicsElement).getBBox();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(bbox.x).toBeGreaterThan(1290);
    expect(bbox.x).toBeLessThan(1300);
    expect(bbox.x + bbox.w).toBeGreaterThan(1500);
    expect(bbox.x + bbox.w).toBeLessThan(1510);

    // After reset, it sits on the same content: at those stage points at 100%.
    await page.keyboard.press('d');
    await page.keyboard.press('0');
    await expectZoom(page, 1);
    await expect.poll(async () => (await strokes(page).first().boundingBox())!.width, { timeout: 5000 })
      .toBeCloseTo(zoomedBox.width / 2, 0);
    const box = (await strokes(page).first().boundingBox())!;
    const s1 = await client(page, 1300, 700);
    const s2 = await client(page, 1500, 800);
    expect(box.x).toBeLessThan(s1.x + 1);
    expect(box.x).toBeGreaterThan(s1.x - 10);
    expect(box.x + box.width).toBeGreaterThan(s2.x - 1);
    expect(box.x + box.width).toBeLessThan(s2.x + 10);
  });

  test('n places a note under the pointer while zoomed; the laser stays under the pointer', async ({ page }) => {
    await open(page, 2);
    const at = await client(page, 600, 300);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    // Pan a little with the wheel without moving the pointer: `n` must use what is under it now.
    const zoomedAt = await camera(page);
    const { scale } = await stageBox(page);
    await page.mouse.wheel(100, 60);
    await expect.poll(async () => (await camera(page)).x).toBeCloseTo(zoomedAt.x - 100 / scale, 2);
    await expect.poll(async () => (await camera(page)).y).toBeCloseTo(zoomedAt.y - 60 / scale, 2);
    const p = { x: at.x + 30, y: at.y + 20 };
    const expected = await slideAt(page, p.x, p.y);
    await page.mouse.move(p.x, p.y);
    await page.keyboard.press('n');
    await expect(notes(page)).toHaveCount(1);
    const pos = await notes(page).first().evaluate((el) => ({ x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top) }));
    expect(Math.abs(pos.x - expected.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(pos.y - expected.y)).toBeLessThanOrEqual(1);
    const noteBox = (await notes(page).first().boundingBox())!;
    expect(noteBox.x).toBeCloseTo(p.x, -1);
    expect(noteBox.y).toBeCloseTo(p.y, -1);
    await page.keyboard.press('Escape');   // ends the edit and removes the empty note

    await page.keyboard.press('l');
    const q = await client(page, 900, 500);
    await page.mouse.move(q.x - 30, q.y);
    await page.mouse.move(q.x, q.y, { steps: 4 });
    const dot = page.locator('.laser .dot');
    await expect(dot).toHaveCount(1);
    const d = (await dot.boundingBox())!;
    expect(d.x + d.width / 2).toBeCloseTo(q.x, 0);
    expect(d.y + d.height / 2).toBeCloseTo(q.y, 0);
  });

  test('changing slide resets zoom', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/3$/);
    expect(await camera(page)).toEqual({ k: 1, x: 0, y: 0 });
    await page.keyboard.press('+');
    await expectZoom(page, 1.25);
    await page.keyboard.press('ArrowUp');
    await expect(page).toHaveURL(/\/2$/);
    expect(await camera(page)).toEqual({ k: 1, x: 0, y: 0 });
    await expect(zoomLabel(page)).toHaveCount(0);
  });

  test('a live reload that narrows the stage while zoomed clamps the camera again', async ({ page }) => {
    await open(page, 2);
    // Zoom to 200% at the bottom-right corner: the camera sits at the edge of the clamp.
    const at = await client(page, 1500, 800);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('z');
    await expectZoom(page, 2);
    await expectCamera(page, { k: 2, x: -1500, y: -800 });

    // The same deck at 4:3: the stage is 1200 wide, so x may go no lower than -1200.
    const source = readFileSync(join(DECKS, SLUG, 'deck.md'), 'utf8');
    writeFileSync(join(DECKS, SLUG, 'deck.md'), `---\naspect: "4:3"\n---\n\n${source}`);
    await expect(page.locator('.stage')).toHaveCSS('width', '1200px', { timeout: 10_000 });
    await expect.poll(() => camera(page)).toEqual({ k: 2, x: -1200, y: -800 });
    expect(await covers(page)).toBe(true);
  });
});

test.describe('zoom motion', () => {
  // The suite runs with reduced motion, which zeroes every duration.
  test.use({ reducedMotion: 'no-preference' });
  test.beforeAll(() => writeZoomDeck());
  test.afterAll(() => removeTempDecks());

  test('key zooms ease over --t-med; wheel zooms are immediate', async ({ page }) => {
    await open(page, 2);
    const cam = page.locator('.camera');
    const duration = () => cam.evaluate((el) => getComputedStyle(el).transitionDuration);
    const at = await client(page, 800, 450);
    await page.mouse.move(at.x, at.y);

    await page.keyboard.press('z');
    await expect(cam).toHaveClass(/animate/);
    expect(await duration()).toBe('0.2s');
    expect(await cam.evaluate((el) => getComputedStyle(el).transitionProperty)).toBe('transform');
    // Mid-transition the rendered scale is between 1 and 2; it ends at 2.
    await expect.poll(() => cam.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a), { timeout: 5000 }).toBe(2);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -10);
    await page.keyboard.up('Control');
    await expect(cam).not.toHaveClass(/animate/);
    expect(await duration()).toBe('0s');
    await expect.poll(() => cam.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(2 * Math.exp(0.1), 4);

    // A slide change resets at once, too.
    await page.keyboard.press('z');
    await page.keyboard.press('ArrowRight');
    await expect(cam).not.toHaveClass(/animate/);
    // The ease that `z` started is cancelled, not left to run out.
    expect(await cam.evaluate((el) => el.getAnimations().length)).toBe(0);
    expect(await cam.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });
});
