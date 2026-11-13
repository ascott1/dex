// `pnpm shots`: screenshots of every demo slide for the Phase 4 review loop
// (PLAN.md §9 Phase 4, task 5). Writes docs/shots/ (gitignored):
//
//   paper/<nn>-<id>.png, ink/<nn>-<id>.png   every slide, Regular, builds revealed
//   quiet/…, loud/…                           a few slides at the other text sizes
//   aspect-4x3/…, aspect-16x10/…              title, default, split, columns on other stages
//   report.json                               layout, density, overflow per shot
//   measure.json                              the §8 reference measurements at Quiet
//
// Not part of `pnpm test:e2e` (see playwright.config.ts).

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Deck } from '../shared/types.ts';
import { DECKS, removeTempDecks, writeDeck } from './temp-deck.ts';

const OUT = fileURLToPath(new URL('../docs/shots/', import.meta.url));
const pad = (n: number) => String(n).padStart(2, '0');

type TextScale = 'quiet' | 'regular' | 'loud';
interface Shot { dir: string; file: string; layout: string; density: string | null; overflow: boolean }
const report: Shot[] = [];

/** Open a deck with the given theme and text size, builds off (fully revealed). */
async function openDeck(page: Page, slug: string, theme: 'paper' | 'ink', textScale: TextScale) {
  await page.addInitScript(
    ([slug, theme, textScale]) => {
      localStorage.setItem('dex:settings', JSON.stringify({ textScale, builds: false, motion: false, chrome: 'always' }));
      localStorage.setItem(`dex:theme:${slug}`, theme);
    },
    [slug, theme, textScale] as const,
  );
  await page.goto(`/#/${slug}/1`);
  await expect(page.locator('.slides > .slide.current')).toHaveCount(1);
  const deck = await page.evaluate(async (slug) => {
    const res = await fetch(`decks/${slug}/deck.json`, { cache: 'no-store' });
    return (await res.json()) as Deck;
  }, slug);
  return deck;
}

/** Show slide n (1-based) and wait until fonts, images, and auto-fit have settled. */
async function show(page: Page, slug: string, n: number, id: string) {
  await page.evaluate(([slug, n]) => (location.hash = `#/${slug}/${n}`), [slug, n] as const);
  const slide = page.locator(`.slides > .slide.current[data-id="${id}"]`);
  await expect(slide).toHaveCount(1);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.slide.current img')];
    await Promise.all(imgs.map((img) => (img.complete ? null : img.decode().catch(() => null))));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(80);
  return slide;
}

async function shoot(page: Page, slug: string, deck: Deck, dir: string, which?: number[]) {
  mkdirSync(join(OUT, dir), { recursive: true });
  for (const s of deck.slides) {
    if (which && !which.includes(s.index + 1)) continue;
    const slide = await show(page, slug, s.index + 1, s.id);
    const file = `${pad(s.index + 1)}-${s.id}.png`;
    await page.locator('.viewport').screenshot({ path: join(OUT, dir, file) });
    report.push({
      dir,
      file,
      layout: s.layout,
      density: await slide.getAttribute('data-density'),
      overflow: (await slide.getAttribute('data-overflow')) !== null,
    });
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  removeTempDecks();
});

for (const theme of ['paper', 'ink'] as const) {
  test(`every demo slide, ${theme}`, async ({ page }) => {
    const deck = await openDeck(page, 'demo', theme, 'regular');
    await shoot(page, 'demo', deck, theme);
  });
}

// Title, bullets, columns, code, and quote at the other two text sizes.
const SAMPLE = [1, 4, 6, 15, 13];
for (const textScale of ['quiet', 'loud'] as const) {
  test(`sample slides, ${textScale}`, async ({ page }) => {
    const deck = await openDeck(page, 'demo', 'paper', textScale);
    await shoot(page, 'demo', deck, textScale, SAMPLE);
  });
}

// Other stage aspects: the demo's title, default, split (both), and columns slides.
for (const [aspect, dir] of [['4:3', 'aspect-4x3'], ['16:10', 'aspect-16x10']] as const) {
  test(`aspect ${aspect}`, async ({ page }) => {
    const slug = `zz-e2e-${dir}`;
    // The demo's slides without its frontmatter: title, bullets, columns, both splits.
    const source = readFileSync(join(DECKS, 'demo', 'deck.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
    const slides = source.split(/\n---\n/);
    const pick = [0, 3, 5, 7, 8].map((i) => slides[i]).join('\n---\n');
    writeDeck(slug, `---\ntitle: aspect ${aspect}\naspect: "${aspect}"\n---\n${pick}`);
    cpSync(join(DECKS, 'demo', 'media'), join(DECKS, slug, 'media'), { recursive: true });
    for (const textScale of ['regular', 'quiet'] as const) {
      const deck = await openDeck(page, slug, 'paper', textScale);
      await shoot(page, slug, deck, `${dir}-${textScale}`);
      await page.goto('about:blank');
    }
  });
}

// The §8 reference measurements, at Quiet, from the DOM.
test('reference measurements at Quiet', async ({ page }) => {
  const deck = await openDeck(page, 'demo', 'paper', 'quiet');
  const out: Record<string, unknown> = {};
  for (const [name, n] of [['title', 1], ['default', 4]] as const) {
    await show(page, 'demo', n, deck.slides[n - 1]!.id);
    out[name] = await page.evaluate(() => {
      const slide = document.querySelector<HTMLElement>('.slides > .slide.current')!;
      const stage = slide.getBoundingClientRect();
      const heading = slide.querySelector<HTMLElement>('h1, h2')!;
      const hs = getComputedStyle(heading);
      // Baseline: a zero-size inline-block at the end of the heading sits on it.
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      heading.append(probe);
      const baseline = probe.getBoundingClientRect().bottom - stage.top;
      probe.remove();
      // Cap height of the heading's font, from canvas metrics.
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${hs.fontWeight} ${hs.fontSize} ${hs.fontFamily}`;
      const cap = ctx.measureText('H').actualBoundingBoxAscent;
      const range = document.createRange();
      range.selectNodeContents(heading);
      const textLeft = range.getBoundingClientRect().left - stage.left;
      const result: Record<string, number> = {
        stageWidth: stage.width,
        headingFontSize: parseFloat(hs.fontSize),
        headingWeight: Number(hs.fontWeight),
        headingLeft: heading.getBoundingClientRect().left - stage.left,
        headingTextLeft: textLeft,
        headingLeftPct: ((heading.getBoundingClientRect().left - stage.left) / stage.width) * 100,
        headingBaseline: baseline,
        capHeight: cap,
        capTop: baseline - cap,
      };
      const body = slide.querySelector<HTMLElement>('.s-body');
      if (slide.dataset.layout === 'title' && body) {
        const bs = getComputedStyle(body);
        const p = body.querySelector('p')!;
        const ps = getComputedStyle(p);
        const br = body.getBoundingClientRect();
        const pr = p.getBoundingClientRect();
        const head = slide.querySelector<HTMLElement>('.s-head')!.getBoundingClientRect();
        const h1 = heading.getBoundingClientRect();
        Object.assign(result, {
          ledeFontSize: parseFloat(ps.fontSize),
          ledeLineHeight: parseFloat(ps.lineHeight),
          ruleWidth: parseFloat(bs.borderLeftWidth),
          ruleToText: pr.left - br.left - parseFloat(bs.borderLeftWidth),
          ruleTopBelowBaseline: br.top - stage.top - baseline,
          ruleTopBelowBaselineOverFontSize: (br.top - stage.top - baseline) / parseFloat(hs.fontSize),
          ledeWidth: pr.width,
          // Vertical centre of the heading-plus-lede block, and of the block with the eyebrow.
          blockCentre: (h1.top + br.bottom) / 2 - stage.top,
          blockWithEyebrowCentre: (head.top + br.bottom) / 2 - stage.top,
          stageCentre: stage.height / 2,
        });
      }
      if (slide.dataset.layout === 'default' && body) {
        result.bodyTopBelowTitle = body.getBoundingClientRect().top - heading.getBoundingClientRect().bottom;
      }
      return result;
    });
  }
  writeFileSync(join(OUT, 'measure.json'), JSON.stringify(out, null, 2) + '\n');
});

// Phase 5 chrome: the settings sheet (at the reference's 1366×817 viewport, to
// compare with docs/reference/maeda-settings.png), the overview, the source
// view, and the go-to label, in both themes. Also docs/shots/chrome/sheet.json,
// the sheet's sizes from the DOM against §8.
for (const theme of ['paper', 'ink'] as const) {
  test(`chrome overlays, ${theme}`, async ({ page }) => {
    const dir = join(OUT, 'chrome');
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width: 1366, height: 817 });
    await page.addInitScript((theme) => {
      localStorage.setItem('dex:settings', JSON.stringify({ motion: false }));
      localStorage.setItem('dex:theme:demo', theme);
    }, theme);
    await page.goto('/#/demo/1');
    await expect(page.locator('.slides > .slide.current')).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);

    await page.keyboard.press('s');
    const sheet = page.locator('.sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('select option')).not.toHaveCount(0);
    await page.screenshot({ path: join(dir, `sheet-${theme}-top.png`) });
    if (theme === 'paper') {
      const sizes = await sheet.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const h3 = el.querySelector('h3')!;
        const hs = getComputedStyle(h3);
        const cell = (q: string) => el.querySelector(q)!.getBoundingClientRect().height;
        const prev = h3.previousElementSibling!.getBoundingClientRect();
        const next = h3.nextElementSibling!.getBoundingClientRect();
        const hr = h3.getBoundingClientRect();
        return {
          viewport: [innerWidth, innerHeight],
          width: r.width, left: r.left, top: r.top, bottomGap: innerHeight - r.bottom,
          padding: cs.padding, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
          background: cs.backgroundColor,
          cell: cell('.segmented .cell'),
          sectionLabel: { fontSize: hs.fontSize, fontFamily: hs.fontFamily, letterSpacing: hs.letterSpacing, color: hs.color, above: hr.top - prev.bottom, below: next.top - hr.bottom },
          controlText: getComputedStyle(el.querySelector('.cell .control-text')!).fontSize,
          sublabel: getComputedStyle(el.querySelector('.cell .sublabel')!).fontSize,
        };
      });
      writeFileSync(join(dir, 'sheet.json'), JSON.stringify(sizes, null, 2) + '\n');
    }
    await sheet.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.screenshot({ path: join(dir, `sheet-${theme}-bottom.png`) });
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => (location.hash = '#/demo/20'));
    await expect(page.locator('.bottombar .counter')).toHaveText('20 / 23');
    await page.keyboard.press('g');
    await expect(page.locator('.overview .thumb')).toHaveCount(23);
    await page.evaluate(async () => {
      await Promise.all([...document.querySelectorAll<HTMLImageElement>('.overview img')].map((i) => i.decode().catch(() => null)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await page.screenshot({ path: join(dir, `overview-${theme}.png`) });
    await page.keyboard.press('Escape');

    await page.evaluate(() => (location.hash = '#/demo/15'));
    await expect(page.locator('.bottombar .counter')).toHaveText('15 / 23');
    await page.keyboard.press('m');
    await expect(page.locator('.source')).toBeVisible();
    await page.screenshot({ path: join(dir, `source-${theme}.png`) });
    await page.keyboard.press('Escape');

    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await expect(page.locator('.bottombar .goto')).toHaveText('Go to 12');
    await page.locator('.bottombar').screenshot({ path: join(dir, `goto-${theme}.png`) });
    await page.screenshot({ path: join(dir, `goto-${theme}-page.png`) });
    await page.keyboard.press('Escape');
  });
}

// Phase 10 details, in both themes, into docs/shots/details/: the overlaid
// chrome over a `bg` picture in fullscreen at 1920×1080, the marker and pen on
// a slide, the laser's trail, the overview with the current slide selected, and
// a missing image. Marks go to a temporary deck, never the demo's marks.json.
for (const theme of ['paper', 'ink'] as const) {
  test(`details, ${theme}`, async ({ page }) => {
    const dir = join(OUT, 'details');
    mkdirSync(dir, { recursive: true });
    const slug = 'zz-e2e-details';
    rmSync(join(DECKS, slug), { recursive: true, force: true });   // no marks left from the other theme
    writeDeck(slug, [
      '## Marks on a slide\n\nA highlighter should read as a highlighter in both themes, over text and over the page.',
      '## A missing picture\n\nThe image beside this text is not in the deck folder.\n\n![A desk](media/desk.jpg)',
    ].join('\n\n---\n\n'));
    await page.addInitScript(([theme, slug]) => {
      localStorage.setItem('dex:settings', JSON.stringify({ motion: false }));
      localStorage.setItem('dex:theme:demo', theme);
      localStorage.setItem(`dex:theme:${slug}`, theme);
    }, [theme, slug] as const);
    const settle = () => page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll<HTMLImageElement>('img')].map((i) => i.decode().catch(() => null)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });

    // Overlaid chrome over the demo's bg picture, in fullscreen at 1920×1080.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/#/demo/19');
    await expect(page.locator('.slides > .slide.current[data-bg="image"]')).toHaveCount(1);
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await page.mouse.move(960, 540);
    await expect(page.locator('.app')).toHaveAttribute('data-chrome', 'shown');
    await expect(page.locator('.app')).not.toHaveAttribute('data-dock', /.*/);
    await settle();
    await page.screenshot({ path: join(dir, `${theme}-fullscreen-bg-chrome.png`) });
    await page.locator('.bottombar').screenshot({ path: join(dir, `${theme}-fullscreen-bg-bottombar.png`) });
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

    // Marker and pen strokes across the text.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/#/${slug}/1`);
    await page.waitForFunction(() => (window as unknown as { __dex: { marks: { loaded: boolean } } }).__dex.marks.loaded);
    const p = await page.locator('.slides > .slide.current p').boundingBox();
    await page.keyboard.press('d');
    await page.locator('.drawbar').getByRole('button', { name: 'Marker', exact: true }).click();
    await page.mouse.move(p!.x - 10, p!.y + 22);
    await page.mouse.down();
    await page.mouse.move(p!.x + 620, p!.y + 22, { steps: 20 });
    await page.mouse.up();
    await page.locator('.drawbar').getByRole('button', { name: 'Pen', exact: true }).click();
    await page.mouse.move(p!.x + 700, p!.y + 140);
    await page.mouse.down();
    await page.mouse.move(p!.x + 900, p!.y + 200, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.press('d');
    await settle();
    await page.locator('.viewport').screenshot({ path: join(dir, `${theme}-marks.png`) });

    // The laser mid-sweep: the trail is one streak behind the dot.
    await page.keyboard.press('l');
    await page.mouse.move(300, 600);
    for (let i = 1; i <= 12; i++) await page.mouse.move(300 + i * 40, 600 - i * 12);
    await page.locator('.viewport').screenshot({ path: join(dir, `${theme}-laser.png`) });
    await page.keyboard.press('l');

    // A missing image.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.slides > .slide.current .broken-media')).toHaveCount(1);
    await settle();
    await page.locator('.viewport').screenshot({ path: join(dir, `${theme}-missing-image.png`) });

    // The overview with the selection on the current slide: one frame, not two.
    await page.goto('/#/demo/4');
    await expect(page.locator('.slides > .slide.current')).toHaveCount(1);
    await page.keyboard.press('g');
    await expect(page.locator('.overview .thumb.current .hit')).toBeFocused();
    await settle();
    const thumb = (await page.locator('.overview .thumb.current').boundingBox())!;
    await page.screenshot({
      path: join(dir, `${theme}-overview-current.png`),
      clip: { x: thumb.x - 12, y: thumb.y - 12, width: thumb.width + 24, height: thumb.height + 24 },
    });
    await page.keyboard.press('ArrowRight');
    await page.screenshot({ path: join(dir, `${theme}-overview.png`) });
  });
}

// Phase 8: the presenter window at 1280×800 (the size `p` opens), in both
// themes: a slide with notes and builds, a slide without notes, and the last
// slide; and the audience window in blackout. Into docs/shots/presenter/.
for (const theme of ['paper', 'ink'] as const) {
  test(`presenter window, ${theme}`, async ({ context, page }) => {
    const dir = join(OUT, 'presenter');
    mkdirSync(dir, { recursive: true });
    const plain = 'zz-e2e-presenter-shots';
    writeDeck(plain, '## A slide without notes\n\n+ First point\n+ Second point\n\n---\n\n## The last one\n\nNothing after this.');
    await context.addInitScript(([theme, plain]) => {
      localStorage.setItem('dex:settings', JSON.stringify({ motion: false }));
      localStorage.setItem('dex:theme:demo', theme);
      localStorage.setItem(`dex:theme:${plain}`, theme);
    }, [theme, plain] as const);
    const joined = (p: Page) =>
      p.waitForFunction(() => (window as unknown as { __dex?: { session: { joined: boolean } } }).__dex?.session.joined === true);
    const settle = async (p: Page) => {
      await p.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll<HTMLImageElement>('img')].map((i) => i.decode().catch(() => null)));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      await p.waitForTimeout(120);
    };

    // The audience window, on the bullets slide one step in.
    await page.goto('/#/demo/4');
    await expect(page.locator('.slides > .slide.current')).toHaveCount(1);
    await joined(page);
    await page.keyboard.press('ArrowRight');

    const presenter = await context.newPage();
    await presenter.setViewportSize({ width: 1280, height: 800 });
    await presenter.goto('/#/demo/presenter');
    await joined(presenter);
    await expect(presenter.locator('[data-counter]')).toHaveText('Slide 04 / 23');
    await page.keyboard.press('ArrowRight');   // starts the timer
    await presenter.waitForTimeout(1100);
    await settle(presenter);
    await presenter.screenshot({ path: join(dir, `${theme}-notes-builds.png`) });

    await page.keyboard.press('b');
    await expect(page.locator('[data-blackout]')).toBeVisible();
    await settle(presenter);
    await presenter.screenshot({ path: join(dir, `${theme}-blackout.png`) });
    if (theme === 'paper') await page.screenshot({ path: join(dir, 'audience-blackout.png') });
    await page.keyboard.press('b');

    await presenter.keyboard.press('End');
    await expect(presenter.locator('[data-next-label]')).toHaveText('End');
    await settle(presenter);
    await presenter.screenshot({ path: join(dir, `${theme}-last.png`) });

    await presenter.close();
    await page.goto(`/#/${plain}/1`);
    await joined(page);
    const second = await context.newPage();
    await second.setViewportSize({ width: 1280, height: 800 });
    await second.goto(`/#/${plain}/presenter`);
    await joined(second);
    await expect(second.locator('[data-notes]')).toHaveText('No notes');
    await settle(second);
    await second.screenshot({ path: join(dir, `${theme}-no-notes.png`) });
  });
}
