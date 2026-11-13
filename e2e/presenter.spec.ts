// Phase 8: the presenter window, speaker notes, the timer, blackout, and
// keeping windows in step (PLAN.md §9 Phase 8). Two pages in one browser
// context, because a BroadcastChannel only reaches same-origin pages of the
// same context. Everything runs on a temporary deck under decks/zz-e2e-*, so
// decks/demo/marks.json is never written.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { Marks } from '../shared/types.ts';
import { DECKS, removeTempDecks, writeDeck } from './temp-deck.ts';

const SLUG = 'zz-e2e-presenter';
const MARKS_FILE = join(DECKS, SLUG, 'marks.json');

const SLIDES = [
  '# Presenter deck\n\nOpening words.\n\n<!-- Welcome **everyone**, then say what the talk is for. -->',
  '## Builds\n\n+ one\n+ two\n+ three\n\n<!-- Reveal one at a time:\n\n- first point\n- second point -->',
  '## Plain\n\nThis slide has no notes.',
  '## Hidden\n\n<!-- skip: true -->\n\nNever shown when presenting.',
  '## Last\n\nThe end.\n\n<!-- Thank them and take questions. -->',
];

function writePresenterDeck(slides: string[] = SLIDES): void {
  writeDeck(SLUG, slides.join('\n\n---\n\n'));
}

type Dex = {
  nav: { index: number; step: number };
  ui: { blackout: boolean; overlay: string | null; tool: string | null; goto: string; camera: { k: number } };
  marks: { loaded: boolean; data: Marks };
  session: { slug: string | null; joined: boolean };
  settings: { chrome: string };
};

// Counts BroadcastChannel posts, to show that windows settle and stop talking.
async function countPosts(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __posts: number };
    w.__posts = 0;
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (this: BroadcastChannel, message: unknown) {
      w.__posts++;
      return post.call(this, message);
    };
  });
}

const dex = <T>(page: Page, fn: (d: Dex) => T) =>
  page.evaluate(`(${fn.toString()})(window.__dex)`) as Promise<T>;
const navOf = (page: Page) => dex(page, (d) => ({ index: d.nav.index, step: d.nav.step }));
const posts = (page: Page) => page.evaluate(() => (window as unknown as { __posts: number }).__posts);

async function joined(page: Page) {
  await page.waitForFunction(() => {
    const d = (window as unknown as { __dex?: Dex }).__dex;
    return d?.session.joined === true && d.marks.loaded;
  });
}

async function openDeck(page: Page, n = 1) {
  await page.goto(`/#/${SLUG}/${n}`);
  await expect(page.locator('.slides > .slide.current')).toHaveCount(1);
  await joined(page);
}

async function openPresenter(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/#/${SLUG}/presenter`);
  await expect(page.locator('.presenter')).toBeVisible();
  await joined(page);
  return page;
}

const currentFrame = (page: Page) => page.locator('.presenter .frame.current');
const nextFrame = (page: Page) => page.locator('.presenter .frame.next');
const notes = (page: Page) => page.locator('.presenter [data-notes]');
const counter = (page: Page) => page.locator('.presenter [data-counter]');
const stepCounter = (page: Page) => page.locator('.presenter [data-step-counter]');
const timer = (page: Page) => page.locator('.presenter .timer');
const deckSlide = (page: Page) => page.locator('.slides > .slide.current');
const cover = (page: Page) => page.locator('[data-blackout]');

function readMarks(): Marks | null {
  if (!existsSync(MARKS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(MARKS_FILE, 'utf8')) as Marks;
  } catch {
    return null;
  }
}

/** Client position of a stage point (stage logical px, no camera) in the deck window. */
async function client(page: Page, x: number, y: number) {
  const box = await page.locator('.stage').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, scale: r.width / (el as HTMLElement).offsetWidth };
  });
  return { x: box.left + x * box.scale, y: box.top + y * box.scale };
}

async function drag(page: Page, points: [number, number][]) {
  const first = await client(page, ...points[0]!);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const c = await client(page, ...p);
    await page.mouse.move(c.x, c.y, { steps: 6 });
  }
  await page.mouse.up();
}

test.describe.serial('presenter', () => {
  test.beforeAll(() => {
    removeTempDecks();
    writePresenterDeck();
  });
  test.afterAll(() => removeTempDecks());
  test.beforeEach(async ({ context }) => {
    writePresenterDeck();
    writeFileSync(MARKS_FILE, JSON.stringify({ version: 1, slides: {} }));
    await countPosts(context);
  });

  test('p and the PRESENTER button open the presenter window', async ({ page, context }) => {
    await openDeck(page);
    const [popup] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('p')]);
    await popup.waitForLoadState();
    expect(new URL(popup.url()).hash).toBe(`#/${SLUG}/presenter`);
    await expect(popup.locator('.presenter')).toBeVisible();
    await expect(popup).toHaveTitle(/^Presenter · /);
    await popup.close();

    await page.keyboard.press('s');
    const [again] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Presenter', exact: true }).click(),
    ]);
    await again.waitForLoadState();
    expect(new URL(again.url()).hash).toBe(`#/${SLUG}/presenter`);
  });

  test('navigating in the presenter moves the deck window, and the reverse', async ({ page, context }) => {
    await openDeck(page);
    const presenter = await openPresenter(context);

    await presenter.keyboard.press('ArrowRight');   // slide 2, step 0
    await presenter.keyboard.press('ArrowRight');   // step 1
    await expect.poll(() => navOf(page)).toEqual({ index: 1, step: 1 });
    await expect(deckSlide(page)).toHaveAttribute('data-id', 'builds');
    await expect(page.locator('.slides > .slide.current li.is-pending')).toHaveCount(2);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => navOf(presenter)).toEqual({ index: 1, step: 3 });
    await expect(stepCounter(presenter)).toHaveText('Step 3 / 3');

    await page.keyboard.press('ArrowRight');        // slide 3; the skipped slide 4 is never shown
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => navOf(presenter)).toEqual({ index: 4, step: 0 });
    await expect(counter(presenter)).toHaveText('Slide 05 / 05');

    await presenter.keyboard.press('Home');
    await expect.poll(() => navOf(page)).toEqual({ index: 0, step: 0 });
    await expect(page).toHaveURL(new RegExp(`#/${SLUG}/1$`));

    // Go to by number from the presenter, which shows the digits.
    await presenter.keyboard.press('3');
    await expect(presenter.locator('[data-goto]')).toHaveText('Go to 3');
    await presenter.keyboard.press('Enter');
    await expect.poll(() => navOf(page)).toEqual({ index: 2, step: 0 });
  });

  test('both windows navigating at once settle on the same slide and stop sending', async ({ page, context }) => {
    await openDeck(page);
    const presenter = await openPresenter(context);
    const deck2 = await context.newPage();
    await openDeck(deck2);

    for (let round = 0; round < 4; round++) {
      await Promise.all([
        page.keyboard.press('ArrowRight'),
        presenter.keyboard.press('ArrowRight'),
        deck2.keyboard.press(round % 2 ? 'ArrowLeft' : 'ArrowRight'),
        presenter.keyboard.press('ArrowDown'),
        page.keyboard.press('ArrowUp'),
      ]);
    }
    const settled = async () => {
      const [a, b, c] = await Promise.all([navOf(page), navOf(presenter), navOf(deck2)]);
      return JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c);
    };
    await expect.poll(settled).toBe(true);

    // No ping-pong: once settled, nobody sends anything more.
    const before = await Promise.all([posts(page), posts(presenter), posts(deck2)]);
    await page.waitForTimeout(600);
    const after = await Promise.all([posts(page), posts(presenter), posts(deck2)]);
    expect(after).toEqual(before);
    expect(await settled()).toBe(true);

    // One key press sends exactly one nav message.
    const sent = await posts(presenter);
    await presenter.keyboard.press('End');
    await expect.poll(() => navOf(page)).toEqual({ index: 4, step: 0 });
    await page.waitForTimeout(300);
    expect(await posts(presenter)).toBe(sent + 1);
    expect(await posts(page)).toBe(after[0]);
  });

  test('a presenter opened mid-talk lands on the current slide and step', async ({ page, context }) => {
    await openDeck(page, 2);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('t');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');

    const presenter = await openPresenter(context);
    await expect.poll(() => navOf(presenter)).toEqual({ index: 1, step: 2 });
    await expect(counter(presenter)).toHaveText('Slide 02 / 05');
    await expect(stepCounter(presenter)).toHaveText('Step 2 / 3');
    await expect(presenter.locator('html')).toHaveAttribute('data-theme', 'ink');
    // The deck window did not move to the presenter's starting slide.
    expect(await navOf(page)).toEqual({ index: 1, step: 2 });
  });

  test('the presenter shows the notes as HTML and the right next slide', async ({ page, context }) => {
    await openDeck(page);
    const presenter = await openPresenter(context);

    await expect(currentFrame(presenter).locator('.slide')).toHaveAttribute('data-id', 'presenter-deck');
    await expect(notes(presenter).locator('strong')).toHaveText('everyone');
    await expect(presenter.locator('[data-next-label]')).toHaveText('Next');
    await expect(nextFrame(presenter).locator('.slide')).toHaveAttribute('data-id', 'builds');

    await page.keyboard.press('ArrowRight');
    await expect(notes(presenter).locator('li')).toHaveText(['first point', 'second point']);
    // The current slide is shown at its build step.
    await expect(currentFrame(presenter).locator('li.is-pending')).toHaveCount(3);
    await page.keyboard.press('ArrowRight');
    await expect(currentFrame(presenter).locator('li.is-pending')).toHaveCount(2);
    await expect(stepCounter(presenter)).toHaveText('Step 1 / 3');
    await expect(nextFrame(presenter).locator('.slide')).toHaveAttribute('data-id', 'plain');

    await page.keyboard.press('ArrowDown');
    await expect(notes(presenter)).toHaveText('No notes');
    await expect(stepCounter(presenter)).toHaveCount(0);
    // The skipped slide is not "next".
    await expect(nextFrame(presenter).locator('.slide')).toHaveAttribute('data-id', 'last');

    await page.keyboard.press('ArrowDown');
    await expect(notes(presenter)).toHaveText('Thank them and take questions.');
    await expect(presenter.locator('[data-next-label]')).toHaveText('End');
    await expect(nextFrame(presenter).locator('.slide')).toHaveCount(0);
  });

  test('the timer starts at the first navigation, pauses on click, and resets on double-click', async ({ page, context }) => {
    await openDeck(page);
    const presenter = await context.newPage();
    await presenter.clock.install();
    await presenter.goto(`/#/${SLUG}/presenter`);
    await joined(presenter);

    await expect(timer(presenter)).toHaveText('00:00:00');
    await presenter.clock.runFor(5000);
    await expect(timer(presenter)).toHaveText('00:00:00');
    await expect(timer(presenter)).toHaveAttribute('data-timer', 'idle');

    // A navigation in the other window starts it.
    await page.keyboard.press('ArrowRight');
    await expect(timer(presenter)).toHaveAttribute('data-timer', 'running');
    await presenter.clock.runFor(2000);
    await expect(timer(presenter)).toHaveText('00:00:02');

    await timer(presenter).click();
    await expect(timer(presenter)).toHaveAttribute('data-timer', 'paused');
    await presenter.clock.runFor(5000);
    await expect(timer(presenter)).toHaveText('00:00:02');

    await timer(presenter).click();
    await expect(timer(presenter)).toHaveAttribute('data-timer', 'running');
    await presenter.clock.runFor(61_000);
    await expect(timer(presenter)).toHaveText('00:01:03');

    // A double-click resets and does not leave it paused; the next navigation starts it again.
    await timer(presenter).dblclick();
    await expect(timer(presenter)).toHaveText('00:00:00');
    await expect(timer(presenter)).toHaveAttribute('data-timer', 'idle');
    await presenter.clock.runFor(3000);
    await expect(timer(presenter)).toHaveText('00:00:00');
    // The click did not take focus, so Space still moves the deck.
    await presenter.keyboard.press('Space');
    await expect.poll(() => navOf(page)).toEqual({ index: 1, step: 1 });
    await expect(timer(presenter)).toHaveAttribute('data-timer', 'running');
    await presenter.clock.runFor(1000);
    await expect(timer(presenter)).toHaveText('00:00:01');

    // The wall clock is shown beside it.
    await expect(presenter.locator('[data-clock]')).toHaveText(/^\d{1,2}:\d{2}/);
  });

  test('blackout in either window blacks out the deck window; any key or click clears it', async ({ page, context }) => {
    await openDeck(page);
    const presenter = await openPresenter(context);

    // From the presenter.
    await presenter.keyboard.press('b');
    await expect(cover(page)).toBeVisible();
    await expect(cover(page)).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(presenter.locator('[data-blackout-label]')).toBeVisible();
    await expect(currentFrame(presenter).locator('.black')).toBeVisible();
    // The next key only clears it.
    await presenter.keyboard.press('ArrowRight');
    await expect(cover(page)).toHaveCount(0);
    await expect(presenter.locator('[data-blackout-label]')).toHaveCount(0);
    expect(await navOf(page)).toEqual({ index: 0, step: 0 });
    expect(await navOf(presenter)).toEqual({ index: 0, step: 0 });

    // From the deck window, with `.`; a digit clears it without starting a go-to.
    await page.keyboard.press('.');
    await expect(cover(page)).toBeVisible();
    await expect(presenter.locator('[data-blackout-label]')).toBeVisible();
    await page.keyboard.press('3');
    await expect(cover(page)).toHaveCount(0);
    expect(await dex(page, (d) => d.ui.goto)).toBe('');
    await expect(presenter.locator('[data-blackout-label]')).toHaveCount(0);

    // Esc clears blackout before closing the settings sheet under it.
    await page.keyboard.press('s');
    await expect(page.locator('.sheet')).toBeVisible();
    await page.keyboard.press('b');
    await expect(cover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cover(page)).toHaveCount(0);
    await expect(page.locator('.sheet')).toBeVisible();
    await page.keyboard.press('Escape');

    // A modifier on its own leaves it on; a click clears it.
    await page.keyboard.press('b');
    await expect(cover(page)).toBeVisible();
    await page.keyboard.press('Shift');
    await expect(cover(page)).toBeVisible();
    await page.mouse.click(800, 450);
    await expect(cover(page)).toHaveCount(0);
    await expect(presenter.locator('[data-blackout-label]')).toHaveCount(0);

    // A deck window opened while blacked out starts blacked out.
    await presenter.keyboard.press('b');
    const late = await context.newPage();
    await openDeck(late);
    await expect(cover(late)).toBeVisible();
  });

  test('a stroke or a note made in one window appears in the others; only that window saves', async ({ page, context }) => {
    const puts = new Map<Page, number>();
    const watch = (p: Page) => {
      puts.set(p, 0);
      p.on('request', (r) => {
        if (r.method() === 'PUT') puts.set(p, puts.get(p)! + 1);
      });
    };
    watch(page);
    await openDeck(page, 2);
    const presenter = await openPresenter(context);
    watch(presenter);
    const deck2 = await context.newPage();
    watch(deck2);
    await openDeck(deck2, 2);

    await page.keyboard.press('d');
    await drag(page, [[600, 400], [700, 430], [800, 400], [900, 450]]);
    await expect(currentFrame(presenter).locator('svg.draw-layer [data-stroke]')).toHaveCount(1);
    await expect(deck2.locator('.camera > svg.draw-layer [data-stroke]')).toHaveCount(1);
    await expect.poll(() => readMarks()?.slides['builds']?.strokes.length ?? 0, { timeout: 5000 }).toBe(1);

    // The presenter shows the next slide's marks too.
    await presenter.keyboard.press('ArrowUp');
    await expect.poll(() => navOf(page)).toEqual({ index: 0, step: 0 });
    await expect(nextFrame(presenter).locator('svg.draw-layer [data-stroke]')).toHaveCount(1);
    await presenter.keyboard.press('ArrowDown');
    await expect.poll(() => navOf(page)).toEqual({ index: 1, step: 0 });

    // A sticky note, typed in the deck window, appears as it is typed.
    await page.keyboard.press('Escape');   // put the pen down
    const at = await client(page, 300, 300);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.press('n');
    await page.keyboard.type('hello there');
    await expect(currentFrame(presenter).locator('.sticky')).toContainText('hello there');
    await expect(deck2.locator('.notes-layer .sticky')).toContainText('hello there');
    await page.keyboard.press('Escape');
    await expect.poll(() => readMarks()?.slides['builds']?.notes[0]?.text ?? '', { timeout: 5000 }).toBe('hello there');

    // Undo in the deck window reaches the others too.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(currentFrame(presenter).locator('.sticky')).toHaveCount(0);
    await expect(deck2.locator('.notes-layer .sticky')).toHaveCount(0);

    await page.waitForTimeout(800);
    expect(puts.get(page)).toBeGreaterThan(0);
    expect(puts.get(presenter)).toBe(0);
    expect(puts.get(deck2)).toBe(0);

    // The presenter's mark layers are read-only.
    await expect(currentFrame(presenter).locator('.sticky')).toHaveCount(0);
    expect(await currentFrame(presenter).locator('.canvas').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
  });

  test('marks drawn just before the presenter opens are in it, saved or not', async ({ page, context }) => {
    await openDeck(page, 2);
    await page.keyboard.press('d');
    await drag(page, [[600, 400], [800, 450]]);
    // Opened at once, before the debounced save has written marks.json.
    const presenter = await openPresenter(context);
    await expect(currentFrame(presenter).locator('svg.draw-layer [data-stroke]')).toHaveCount(1);
  });

  test('the theme follows from either window', async ({ page, context }) => {
    await openDeck(page);
    const presenter = await openPresenter(context);
    await presenter.keyboard.press('t');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
    await expect(presenter.locator('html')).toHaveAttribute('data-theme', 'ink');
    await page.keyboard.press('t');
    await expect(presenter.locator('html')).toHaveAttribute('data-theme', 'paper');
    await expect(currentFrame(presenter).locator('.slide')).toHaveAttribute('data-theme', 'paper');
  });

  test('keys with nothing to show on the presenter route do nothing there', async ({ context }) => {
    const presenter = await openPresenter(context);
    const before = await dex(presenter, (d) => d.settings.chrome);
    for (const key of ['s', ',', 'g', 'm', 'z', '+', '-', 'd', 'n', 'l', 'a', 'c', 'h', 'p']) {
      await presenter.keyboard.press(key);
    }
    const state = await dex(presenter, (d) => ({
      overlay: d.ui.overlay,
      tool: d.ui.tool,
      k: d.ui.camera.k,
      chrome: d.settings.chrome,
      marks: Object.keys(d.marks.data.slides).length,
    }));
    expect(state).toEqual({ overlay: null, tool: null, k: 1, chrome: before, marks: 0 });
    expect(context.pages()).toHaveLength(1);
  });

  test('live reload updates the presenter and clamps a slide that is gone in both windows', async ({ page, context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('dex:settings', JSON.stringify({ followEdits: false }));
    });
    await openDeck(page);
    const presenter = await openPresenter(context);
    await expect(nextFrame(presenter).locator('.slide')).toHaveAttribute('data-id', 'builds');

    const edited = [...SLIDES];
    edited[0] = '# Presenter deck\n\nOpening words.\n\n<!-- A *new* note. -->';
    edited.splice(1, 0, '## Inserted\n\nA new second slide.');
    writePresenterDeck(edited);
    await expect(notes(presenter).locator('em')).toHaveText('new');
    await expect(nextFrame(presenter).locator('.slide')).toHaveAttribute('data-id', 'inserted');
    await expect(counter(presenter)).toHaveText('Slide 01 / 06');

    await presenter.keyboard.press('End');
    await expect.poll(() => navOf(page)).toEqual({ index: 5, step: 0 });
    writePresenterDeck(SLIDES.slice(0, 2));
    await expect(counter(presenter)).toHaveText('Slide 02 / 02');
    await expect.poll(() => navOf(page)).toEqual({ index: 1, step: 0 });
    await expect(deckSlide(page)).toHaveAttribute('data-id', 'builds');
    await expect(currentFrame(presenter).locator('.slide')).toHaveAttribute('data-id', 'builds');
    await expect(presenter.locator('[data-next-label]')).toHaveText('End');
  });
});
