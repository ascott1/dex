// Phase 6: drawing, sticky notes, the laser, and saving marks (PLAN.md §9
// Phase 6). Everything that saves runs on a temporary deck under
// decks/zz-e2e-*, so decks/demo/marks.json is never written.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Marks } from '../shared/types.ts';
import { DECKS, removeTempDecks, writeDeck } from './temp-deck.ts';

const SLUG = 'zz-e2e-marks';
const MARKS_FILE = join(DECKS, SLUG, 'marks.json');

const SLIDES = {
  one: '# Marks deck\n\nA deck for drawing on.',
  two: '## Two\n\nSecond slide with some text to circle.',
  three: '## Three\n\nThird slide.',
  picture: '![A plate](media/plate-1.svg)',
};

function writeMarksDeck(order: (keyof typeof SLIDES)[] = ['one', 'two', 'three', 'picture']): void {
  writeDeck(SLUG, order.map((k) => SLIDES[k]).join('\n\n---\n\n'));
  const media = join(DECKS, SLUG, 'media');
  mkdirSync(media, { recursive: true });
  copyFileSync(join(DECKS, 'demo', 'media', 'plate-1.svg'), join(media, 'plate-1.svg'));
}

const current = (page: Page) => page.locator('.slides > .slide.current');
const layer = (page: Page) => page.locator('.camera > svg.draw-layer');
const strokes = (page: Page) => layer(page).locator('[data-stroke]');
const notes = (page: Page) => page.locator('.notes-layer .sticky');
const drawbar = (page: Page) => page.locator('.drawbar');

async function open(page: Page, n = 1) {
  await page.goto(`/#/${SLUG}/${n}`);
  await expect(current(page)).toHaveCount(1);
  await page.waitForFunction(() => (window as unknown as { __dex: { marks: { loaded: boolean } } }).__dex.marks.loaded);
}

function readMarks(): Marks | null {
  if (!existsSync(MARKS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(MARKS_FILE, 'utf8')) as Marks;
  } catch {
    return null;
  }
}

/** Number of strokes and notes saved in marks.json for a slide id. */
function saved(slideId: string): { strokes: number; notes: number; tools: string[] } {
  const m = readMarks()?.slides[slideId];
  return { strokes: m?.strokes.length ?? 0, notes: m?.notes.length ?? 0, tools: m?.strokes.map((s) => s.tool) ?? [] };
}

/** Client position of a stage point (stage logical px, no camera). */
async function client(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('.stage').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, scale: r.width / (el as HTMLElement).offsetWidth };
  });
  return { x: box.left + x * box.scale, y: box.top + y * box.scale };
}

/** Drag through stage points with the mouse. */
async function drag(page: Page, points: [number, number][], steps = 6) {
  const first = await client(page, ...points[0]!);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const c = await client(page, ...p);
    await page.mouse.move(c.x, c.y, { steps });
  }
  await page.mouse.up();
}

async function pickTool(page: Page, name: string) {
  await drawbar(page).getByRole('button', { name, exact: true }).click();
}

const scribble: [number, number][] = [[600, 400], [700, 430], [800, 400], [900, 450]];

test.describe.serial('marks', () => {
  test.beforeAll(() => {
    removeTempDecks();
    writeMarksDeck();
  });
  test.afterAll(() => removeTempDecks());
  test.beforeEach(() => {
    writeMarksDeck();
    writeFileSync(MARKS_FILE, JSON.stringify({ version: 1, slides: {} }));
  });

  test('a pen stroke appears, is saved to marks.json, and survives a reload', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await expect(drawbar(page)).toBeVisible();
    await drag(page, scribble);
    await expect(strokes(page)).toHaveCount(1);
    await expect(strokes(page).first()).toHaveClass(/pen/);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(1);
    const stroke = readMarks()!.slides['two']!.strokes[0]!;
    expect(stroke.tool).toBe('pen');
    expect(stroke.points.length).toBeGreaterThan(2);

    await page.reload();
    await expect(current(page)).toHaveCount(1);
    await expect(strokes(page)).toHaveCount(1);
  });

  test('⌘Z removes a stroke and ⇧⌘Z restores it; c clears and undo restores; each is saved', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await expect(strokes(page)).toHaveCount(1);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(1);

    // An undo right after a save must also save.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(strokes(page)).toHaveCount(0);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(0);
    await page.keyboard.press('Shift+ControlOrMeta+z');
    await expect(strokes(page)).toHaveCount(1);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(1);

    await drag(page, [[300, 600], [500, 650]]);
    await expect(strokes(page)).toHaveCount(2);
    await page.keyboard.press('c');
    await expect(strokes(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(strokes(page)).toHaveCount(2);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(2);
  });

  test('the eraser removes only the stroke it touches', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, [[300, 300], [900, 300]]);
    await drag(page, [[300, 600], [900, 600]]);
    await expect(strokes(page)).toHaveCount(2);
    const ids = await strokes(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-stroke')));

    await pickTool(page, 'Eraser');
    await drag(page, [[600, 260], [600, 340]]);
    await expect(strokes(page)).toHaveCount(1);
    await expect(strokes(page).first()).toHaveAttribute('data-stroke', ids[1]!);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(1);
  });

  test('an arrow and a box can be drawn, survive a reload, undo and redo, and can be erased', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await pickTool(page, 'Arrow');
    await drag(page, [[300, 300], [700, 500]]);
    await pickTool(page, 'Box');
    await drag(page, [[900, 300], [1200, 600]]);
    // A drag shorter than 8 is discarded.
    await drag(page, [[400, 700], [403, 702]], 1);
    await expect(layer(page).locator('g[data-stroke]')).toHaveCount(1);
    await expect(layer(page).locator('rect[data-stroke]')).toHaveCount(1);
    // The arrow is a shaft and two arms; the box is unfilled.
    await expect(layer(page).locator('g[data-stroke] line')).toHaveCount(3);
    expect(await layer(page).locator('rect[data-stroke]').evaluate((el) => getComputedStyle(el).fill)).toBe('none');
    await expect.poll(() => saved('two').tools.join(','), { timeout: 5000 }).toBe('arrow,box');
    const file = readMarks()!.slides['two']!.strokes;
    expect(file.map((s) => s.points.length)).toEqual([2, 2]);

    await page.reload();
    await expect(current(page)).toHaveCount(1);
    await expect(strokes(page)).toHaveCount(2);

    await page.keyboard.press('d');
    await page.keyboard.press('ControlOrMeta+z');   // nothing to undo after a reload
    await expect(strokes(page)).toHaveCount(2);

    await pickTool(page, 'Eraser');
    await drag(page, [[880, 450], [920, 450]]);     // across the box's left edge
    await expect(layer(page).locator('rect[data-stroke]')).toHaveCount(0);
    await expect(layer(page).locator('g[data-stroke]')).toHaveCount(1);
    await drag(page, [[500, 360], [500, 440]]);     // across the arrow's shaft
    await expect(strokes(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(layer(page).locator('g[data-stroke]')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(strokes(page)).toHaveCount(2);
    await page.keyboard.press('Shift+ControlOrMeta+z');
    await expect(layer(page).locator('rect[data-stroke]')).toHaveCount(0);
    await expect.poll(() => saved('two').tools.join(','), { timeout: 5000 }).toBe('arrow');
  });

  test('the draw bar: muted tool names, a red underline on the active tool, DONE in red', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    const styles = await drawbar(page).evaluate((bar) => {
      const root = getComputedStyle(document.documentElement);
      const probe = (v: string) => {
        const el = document.createElement('span');
        el.style.color = `var(${v})`;
        bar.append(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      };
      const btn = (name: string) => [...bar.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;
      const pen = btn('Pen');
      const after = getComputedStyle(pen, '::after');
      const penRect = pen.getBoundingClientRect();
      return {
        ink2: probe('--ink-2'), ink4: probe('--ink-4'), red: probe('--red'),
        status: getComputedStyle(bar.querySelector('.status')!).color,
        status_text: bar.querySelector('.status')!.textContent,
        marker: getComputedStyle(btn('Marker')).color,
        underline: after.backgroundColor, underlineH: after.height,
        // From the baseline (the bottom of uppercase text) to the top of the underline.
        gap: (() => {
          const probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:1px;height:0';
          pen.append(probe);
          const baseline = probe.getBoundingClientRect().bottom;
          probe.remove();
          return penRect.bottom - parseFloat(after.bottom) - parseFloat(after.height) - baseline;
        })(),
        markerAfter: getComputedStyle(btn('Marker'), '::after').content,
        done: getComputedStyle(btn('Done')).color,
        undo: getComputedStyle(btn('Undo')).color,
        clear: getComputedStyle(btn('Clear')).color,
        font: getComputedStyle(pen).fontFamily, size: getComputedStyle(pen).fontSize,
        transform: getComputedStyle(pen).textTransform,
        unused: root.length,
      };
    });
    expect(styles.status).toBe(styles.ink4);
    expect(styles.marker).toBe(styles.ink2);
    expect(styles.underline).toBe(styles.red);
    expect(styles.underlineH).toBe('2px');
    expect(styles.gap).toBeCloseTo(4, 0);
    expect(styles.markerAfter).toBe('none');
    expect(styles.done).toBe(styles.red);
    expect(styles.undo).toBe(styles.ink4);
    expect(styles.clear).toBe(styles.ink4);
    expect(styles.font).toContain('DM Mono');
    expect(styles.size).toBe('10px');
    expect(styles.transform).toBe('uppercase');
    await expect(drawbar(page).getByRole('button')).toHaveText(
      ['Pen', 'Marker', 'Arrow', 'Box', 'Eraser', '', '', '', 'M', 'Undo', 'Clear', 'Done'],
    );

    // Undo and Clear wake up once there is something to undo or clear.
    await drag(page, scribble);
    await expect(drawbar(page).getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(await drawbar(page).getByRole('button', { name: 'Undo' }).evaluate((b) => getComputedStyle(b).color)).toBe(styles.ink2);

    // DONE leaves draw mode; d toggles it.
    await drawbar(page).getByRole('button', { name: 'Done' }).click();
    await expect(drawbar(page)).toHaveCount(0);
    await page.keyboard.press('d');
    await expect(drawbar(page)).toBeVisible();
    await page.keyboard.press('d');
    await expect(drawbar(page)).toHaveCount(0);
  });

  test('[ and ] cycle the pen size; colours are stored as token names', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    const size = () => page.evaluate(() => (window as unknown as { __dex: { settings: { pen: { size: number } } } }).__dex.settings.pen.size);
    expect(await size()).toBe(6);
    await page.keyboard.press(']');
    expect(await size()).toBe(10);
    await page.keyboard.press(']');
    expect(await size()).toBe(4);
    await page.keyboard.press('[');
    expect(await size()).toBe(10);
    await drawbar(page).getByRole('button', { name: 'red pen' }).click();
    await drag(page, scribble);
    await expect.poll(() => readMarks()?.slides['two']?.strokes[0]?.color, { timeout: 5000 }).toBe('red');
    expect(readMarks()!.slides['two']!.strokes[0]!.size).toBe(10);
  });

  test('a stroke stays on the same slide content after the window is resized', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await expect(strokes(page)).toHaveCount(1);

    const relative = () => page.evaluate(() => {
      const s = document.querySelector('.draw-layer [data-stroke]')!.getBoundingClientRect();
      const h = document.querySelector('.slides > .slide.current h2')!.getBoundingClientRect();
      return { dx: (s.left - h.left) / h.height, dy: (s.top - h.top) / h.height, w: s.width / h.height };
    });
    const before = await relative();
    await page.setViewportSize({ width: 1000, height: 760 });
    await expect.poll(async () => (await relative()).w, { timeout: 5000 }).toBeCloseTo(before.w, 2);
    const after = await relative();
    expect(after.dx).toBeCloseTo(before.dx, 2);
    expect(after.dy).toBeCloseTo(before.dy, 2);
  });

  test('marks can be drawn in the letterbox over a full-bleed picture', async ({ page }) => {
    // A tall window: the 16:9 stage leaves a letterbox above and below it.
    await page.setViewportSize({ width: 900, height: 900 });
    await open(page, 4);
    await page.keyboard.press('d');
    const bleed = await page.locator('.stage').evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--bleed-y')));
    expect(bleed).toBeGreaterThan(100);
    await drag(page, [[400, -bleed / 2], [800, -bleed / 3], [1200, -bleed / 2]]);
    await expect(strokes(page)).toHaveCount(1);
    const id = (await current(page).getAttribute('data-id'))!;
    await expect.poll(() => saved(id).strokes, { timeout: 5000 }).toBe(1);
    const ys = readMarks()!.slides[id]!.strokes[0]!.points.map((p) => p[1]);
    expect(Math.max(...ys)).toBeLessThan(0);
    // It is drawn where it was made: in the letterbox, above the stage.
    const box = await strokes(page).first().boundingBox();
    const stage = await page.locator('.stage').boundingBox();
    expect(box!.y + box!.height).toBeLessThan(stage!.y);
  });

  test('n creates a focused note; typing in it triggers no command; drag, colour, and text survive a reload', async ({ page }) => {
    await open(page, 2);
    const at = await client(page, 400, 300);
    await page.mouse.move(at.x + 5, at.y + 5);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('n');
    await expect(notes(page)).toHaveCount(1);
    const textarea = notes(page).locator('textarea');
    await expect(textarea).toBeFocused();

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.keyboard.type('g t s m d 1 2');
    await page.keyboard.press('Enter');
    await page.keyboard.type('n l a c');
    await page.keyboard.press('ArrowLeft');
    await expect(textarea).toHaveValue('g t s m d 1 2\nn l a c');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    await expect(page.locator('.overview, .sheet')).toHaveCount(0);
    await expect(page.locator('.bottombar .counter')).toHaveText('02 / 04');
    await expect(drawbar(page)).toHaveCount(0);
    await expect(page.locator('.bottombar .goto')).toHaveCount(0);
    await expect(notes(page)).toHaveCount(1);
    await expect(strokes(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(textarea).toHaveCount(0);
    await expect(notes(page)).toContainText('g t s m d 1 2');

    // Drag it by 200, 100 stage pixels.
    const start = await notes(page).boundingBox();
    const from = { x: start!.x + 40, y: start!.y + 40 };
    const scale = await page.locator('.stage').evaluate((el) => el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 200 * scale, from.y + 100 * scale, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => readMarks()?.slides['two']?.notes[0]?.x ?? 0, { timeout: 5000 }).toBeGreaterThan(590);
    const moved = readMarks()!.slides['two']!.notes[0]!;
    expect(Math.abs(moved.x - 600)).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - 400)).toBeLessThanOrEqual(1);

    // Selected: the colour row shows; pick pink.
    await expect(notes(page).first()).toHaveClass(/selected/);
    await notes(page).getByRole('button', { name: 'pink note' }).click();
    await expect.poll(() => readMarks()?.slides['two']?.notes[0]?.color, { timeout: 5000 }).toBe('pink');

    await page.reload();
    await expect(current(page)).toHaveCount(1);
    await expect(notes(page)).toHaveCount(1);
    await expect(notes(page)).toContainText('n l a c');
    await expect(notes(page).first()).toHaveAttribute('data-color', 'pink');
    const box = await notes(page).boundingBox();
    const expected = await client(page, moved.x, moved.y);
    expect(box!.x).toBeCloseTo(expected.x, 0);
    expect(box!.y).toBeCloseTo(expected.y, 0);

    // Emptying it deletes it.
    await notes(page).first().dblclick();
    await expect(notes(page).locator('textarea')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.mouse.click(10, 300);   // outside the note finishes the edit
    await expect(notes(page)).toHaveCount(0);
    await expect.poll(() => saved('two').notes, { timeout: 5000 }).toBe(0);
    // Undo brings back the note it was before it was emptied.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(notes(page)).toContainText('n l a c');
  });

  test('a note: Esc on a new empty note removes it; Delete removes a selected one; NOTE arms placement', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('n');
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(notes(page)).toHaveCount(0);
    // An empty note leaves nothing to undo.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(notes(page)).toHaveCount(0);

    // The NOTE button arms note mode: the next click places a note there.
    await page.locator('.bottombar').getByRole('button', { name: 'Note' }).click();
    const at = await client(page, 900, 200);
    await page.mouse.click(at.x, at.y);
    await expect(notes(page)).toHaveCount(1);
    await expect(notes(page).locator('textarea')).toBeFocused();
    const box = await notes(page).boundingBox();
    expect(box!.x).toBeCloseTo(at.x, 0);
    expect(box!.y).toBeCloseTo(at.y, 0);
    await page.keyboard.type('Keep me');
    await page.keyboard.press('Escape');      // finishes the edit, keeps the selection
    await expect(notes(page).first()).toHaveClass(/selected/);
    await page.keyboard.press('Enter');       // edits again
    await expect(notes(page).locator('textarea')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(notes(page)).toContainText('Keep me');
  });

  test('each slide shows only its own marks', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.bottombar .counter')).toHaveText('03 / 04');
    await expect(strokes(page)).toHaveCount(0);
    await drag(page, [[200, 200], [400, 260]]);
    await drag(page, [[200, 500], [400, 560]]);
    await expect(strokes(page)).toHaveCount(2);
    await page.keyboard.press('ArrowLeft');
    await expect(strokes(page)).toHaveCount(1);
    await expect(layer(page)).toHaveAttribute('data-slide', 'two');
  });

  test('moving a slide in deck.md keeps its marks attached', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(1);

    writeMarksDeck(['one', 'three', 'two', 'picture']);
    // Wait for the live reload to bring in the new order.
    await page.waitForFunction(() => {
      const d = (window as unknown as { __dex: { deck: { current: { slides: { id: string }[] } } } }).__dex.deck.current;
      return d.slides[1]?.id === 'three' && d.slides[2]?.id === 'two';
    }, undefined, { timeout: 10_000 });
    // Slide "two" is now third, and its stroke goes with it.
    await page.goto(`/#/${SLUG}/3`);
    await expect(current(page)).toHaveAttribute('data-id', 'two', { timeout: 10_000 });
    await expect(strokes(page)).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(current(page)).toHaveAttribute('data-id', 'three');
    await expect(strokes(page)).toHaveCount(0);
  });

  test('marks for slide ids the deck no longer has are kept in the file', async ({ page }) => {
    writeFileSync(MARKS_FILE, JSON.stringify({
      version: 1,
      slides: { gone: { strokes: [{ id: 'old', tool: 'pen', color: 'ink', size: 6, points: [[1, 1, 0.5], [9, 9, 0.5]] }], notes: [] } },
    }));
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(1);
    expect(saved('gone').strokes).toBe(1);
  });

  test('a pending save is sent when the page goes away', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await expect(strokes(page)).toHaveCount(1);
    // Leave before the 500ms debounce fires.
    await page.goto('about:blank');
    await expect.poll(() => saved('two').strokes, { timeout: 5000 }).toBe(1);
  });

  test('a hides and shows all marks; the overview marks slides that have them', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await page.keyboard.press('d');
    await page.keyboard.press('n');
    await page.keyboard.type('Note');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(strokes(page)).toHaveCount(1);
    await expect(notes(page)).toHaveCount(1);

    await page.keyboard.press('a');
    await expect(strokes(page)).toHaveCount(0);
    await expect(notes(page)).toHaveCount(0);
    await page.keyboard.press('a');
    await expect(strokes(page)).toHaveCount(1);
    await expect(notes(page)).toHaveCount(1);

    await page.keyboard.press('g');
    const thumbs = page.locator('.overview .thumb');
    await expect(thumbs).toHaveCount(4);
    await expect(thumbs.nth(1).locator('.caption .has-marks')).toHaveCount(1);
    await expect(page.locator('.overview .has-marks')).toHaveCount(1);
  });

  test('the sheet clears this slide (drawings and notes) and, after CONFIRM, all marks; both undo', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('d');
    await drag(page, scribble);
    await page.keyboard.press('ArrowRight');
    await drag(page, scribble);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('d');
    await page.keyboard.press('n');
    await page.keyboard.type('Note');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // `c` clears the drawings only.
    await page.keyboard.press('c');
    await expect(strokes(page)).toHaveCount(0);
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(strokes(page)).toHaveCount(1);

    await page.keyboard.press('s');
    const sheet = page.locator('.sheet');
    const clearSlide = sheet.getByRole('button', { name: 'Clear this slide' });
    await expect(clearSlide).toBeEnabled();
    await clearSlide.click();
    await expect(strokes(page)).toHaveCount(0);
    await expect(notes(page)).toHaveCount(0);
    await expect(clearSlide).toBeDisabled();

    const all = sheet.getByRole('button', { name: /Clear all/ });
    await expect(all).toBeEnabled();
    await all.click();
    await expect(sheet.getByRole('button', { name: /Confirm/ })).toHaveText('Confirm');
    await sheet.getByRole('button', { name: /Confirm/ }).click();
    await expect.poll(() => Object.keys(readMarks()?.slides ?? { x: 1 }).length, { timeout: 5000 }).toBe(0);
    await expect(sheet.getByRole('button', { name: 'Clear all' })).toBeDisabled();

    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');   // undo CLEAR ALL
    await page.keyboard.press('ControlOrMeta+z');   // undo CLEAR THIS SLIDE
    await expect(strokes(page)).toHaveCount(1);
    await expect(notes(page)).toHaveCount(1);
    await expect.poll(() => saved('three').strokes, { timeout: 5000 }).toBe(1);
  });

  test('l shows a laser dot that follows the pointer, with the cursor hidden; nothing is stored', async ({ page }) => {
    await open(page, 2);
    await page.keyboard.press('l');
    const at = await client(page, 800, 450);
    await page.mouse.move(at.x - 40, at.y);
    await page.mouse.move(at.x, at.y, { steps: 5 });
    const dot = page.locator('.laser .dot');
    await expect(dot).toHaveCount(1);
    const box = await dot.boundingBox();
    expect(box!.x + box!.width / 2).toBeCloseTo(at.x, 0);
    expect(box!.y + box!.height / 2).toBeCloseTo(at.y, 0);
    expect(await page.locator('.viewport').evaluate((el) => getComputedStyle(el).cursor)).toBe('none');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press('l');
    await expect(dot).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys((window as unknown as { __dex: { marks: { data: Marks } } }).__dex.marks.data.slides).length)).toBe(0);
  });
});
