// Phase 9: the static export (PLAN.md §9 Phase 9 task 4). The site is built
// with `vite build` into a temporary folder (never dist/), then served twice:
// by `vite preview` at the root, and by a plain file server under /dex/, the
// way a host serves a folder from a subdirectory. The Phase 3 navigation tests
// run against both.

import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Marks } from '../shared/types.ts';
import { counter, current, demoDeckTests, open } from './navigation.ts';
import { DECKS, removeTempDecks } from './temp-deck.ts';
import { unzip } from './unzip.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PREVIEW_PORT = 4320;
const SUBDIR_PORT = 4321;
const SUBDIR = 'dex';
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}/`;
const SUBDIR_URL = `http://localhost:${SUBDIR_PORT}/${SUBDIR}/`;

// A stroke the bundled marks.json carries, so the build's own file is what loads.
const BUNDLED: Marks = {
  version: 1,
  slides: { 'lists-that-build': { strokes: [{ id: 'bundled', tool: 'box', color: 'red', size: 6, points: [[300, 300, 0.5], [700, 600, 0.5]] }], notes: [] } },
};

let site = '';
let preview: ChildProcess | null = null;
let files: Server | null = null;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

/** A plain static file server: no SPA fallback, 404 for anything missing. */
function serveFiles(dir: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = normalize(join(dir, pathname));
    if (!file.startsWith(dir + sep) && file !== dir) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, 'localhost', () => resolve(server)));
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not come up`);
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  // Only the demo deck: a leftover temporary deck would change what / shows.
  removeTempDecks();
  site = mkdtempSync(join(tmpdir(), 'dex-static-'));
  const out = join(site, SUBDIR);
  execFileSync(process.execPath, [VITE, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: ROOT,
    env: { ...process.env, DEX_DECKS: DECKS },
  });
  writeFileSync(join(out, 'decks', 'demo', 'marks.json'), JSON.stringify(BUNDLED));

  preview = spawn(process.execPath, [VITE, 'preview', '--outDir', out, '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  files = await serveFiles(site, SUBDIR_PORT);
  await waitFor(`${PREVIEW_URL}decks/index.json`);
});

test.afterAll(async () => {
  preview?.kill();
  preview = null;
  await new Promise<void>((resolve) => (files ? files.close(() => resolve()) : resolve()));
  files = null;
  if (site) rmSync(site, { recursive: true, force: true });
});

test.describe('static build under vite preview', () => {
  test.use({ baseURL: PREVIEW_URL });
  demoDeckTests({ dev: false });
});

test.describe('static build served from a subdirectory', () => {
  test.use({ baseURL: SUBDIR_URL });
  demoDeckTests({ dev: false });
});

test.describe('static build', () => {
  test.use({ baseURL: SUBDIR_URL });

  const strokes = (page: Page) => page.locator('.camera > svg.draw-layer [data-stroke]');

  test('every request stays under the subdirectory and succeeds; images load', async ({ page }) => {
    const requests: { url: string; status: number }[] = [];
    page.on('response', (r) => requests.push({ url: r.url(), status: r.status() }));
    await page.goto('./');
    await expect(counter(page)).toHaveText('01 / 23');
    for (const n of [8, 9, 10, 11, 12, 19]) await open(page, `#/demo/${n}`);
    await open(page, '#/demo/11');
    const img = current(page).locator('.s-media img');
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready);

    const local = requests.filter((r) => r.url.startsWith(`http://localhost:${SUBDIR_PORT}/`));
    expect(local.length).toBeGreaterThan(5);
    for (const r of local) {
      expect(r.url.startsWith(SUBDIR_URL), r.url).toBe(true);
      expect(r.status, r.url).toBe(200);
    }
    for (const kind of ['decks/index.json', 'decks/demo/deck.json', 'decks/demo/media/plate-4.svg', '.woff2', '.css', '.js']) {
      expect(local.some((r) => r.url.includes(kind)), kind).toBe(true);
    }
  });

  test('FOLLOW EDITS is absent from the settings sheet', async ({ page }) => {
    await open(page, '#/demo/1');
    await page.keyboard.press('s');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Keys', { exact: true })).toBeVisible();
    await expect(page.getByText('Follow edits')).toHaveCount(0);
  });

  test('marks load from the bundled marks.json and save to localStorage, never to the server', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
    });
    await open(page, '#/demo/4');
    await expect(strokes(page)).toHaveCount(1);

    await page.keyboard.press('d');
    const box = (await page.locator('.stage').boundingBox())!;
    const k = box.width / 1600;
    await page.mouse.move(box.x + 600 * k, box.y + 500 * k);
    await page.mouse.down();
    await page.mouse.move(box.x + 900 * k, box.y + 550 * k, { steps: 8 });
    await page.mouse.up();
    await expect(strokes(page)).toHaveCount(2);
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dex:marks:demo') ?? 'null')?.slides?.['lists-that-build']?.strokes?.length ?? 0))
      .toBe(2);

    await page.reload();
    await expect(counter(page)).toHaveText('04 / 23');
    await expect(strokes(page)).toHaveCount(2);
    expect(writes).toEqual([]);
  });

  test('the print route works from the static build', async ({ page }) => {
    await page.goto(`./#/demo/print`);
    await expect(page.locator('.print-sheet')).toHaveCount(22);
    await expect(page.locator('.print-sheet [data-stroke]')).toHaveCount(1);
  });

  test('the PowerPoint export works from the static build: its lazy chunk loads under the subdirectory', async ({ page }) => {
    const scripts: { url: string; status: number }[] = [];
    await page.goto(`./#/demo/print`);
    await expect(page.locator('.print-sheet')).toHaveCount(22);
    await page.evaluate(() => document.fonts.ready);
    // From here on, any script that loads is the exporter's chunk.
    page.on('response', (r) => {
      if (/\.js(\?|$)/.test(r.url())) scripts.push({ url: r.url(), status: r.status() });
    });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-pptx-button]').click()]);
    expect(download.suggestedFilename()).toBe('dex.pptx');
    const parts = unzip(readFileSync(await download.path()));
    expect([...parts.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(22);
    // The bundled marks.json has one box, and the print view shows marks by default.
    expect(new TextDecoder().decode(parts.get('ppt/slides/slide4.xml'))).toContain('name="Rectangle ');

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script.url.startsWith(`${SUBDIR_URL}assets/`), script.url).toBe(true);
      expect(script.status, script.url).toBe(200);
    }
  });

  test('the presenter window opens from the static build and the two windows drive each other', async ({ page, context }) => {
    await open(page, '#/demo/2');
    const [presenter] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('p')]);
    await presenter.waitForLoadState();
    expect(presenter.url()).toBe(`${SUBDIR_URL}#/demo/presenter`);
    await expect(presenter.locator('[data-counter]')).toHaveText('Slide 02 / 23');
    await presenter.keyboard.press('ArrowDown');
    await expect(counter(page)).toHaveText('03 / 23');
    await page.keyboard.press('ArrowDown');
    await expect(presenter.locator('[data-counter]')).toHaveText('Slide 04 / 23');
    await presenter.close();
  });

  test('a deck that is not in the build says so', async ({ page }) => {
    await page.goto(`./#/no-such-deck`);
    await expect(page.getByText('no deck "no-such-deck"')).toBeVisible();
  });
});
