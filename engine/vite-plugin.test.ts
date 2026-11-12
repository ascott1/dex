// Integration tests: a real Vite dev server (and a real build) on a temporary
// project folder, with the dex plugin pointed at its decks directory.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build, createLogger, createServer, type Logger, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deck, DeckSummary } from '../shared/types.ts';
import { dex, MARKS_LIMIT } from './vite-plugin.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

function makeProject(): { root: string; decks: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dex-plugin-')));
  const decks = path.join(root, 'decks');
  mkdirSync(path.join(decks, 'alpha', 'media'), { recursive: true });
  writeFileSync(path.join(decks, 'alpha', 'deck.md'), '---\ntitle: Alpha\n---\n\n# Alpha\n\n---\n\n## Two\n\n![A plate](media/plate.svg)\n\n![Gone](media/missing.png)\n\n<!-- layuot: statement -->\n');
  writeFileSync(path.join(decks, 'alpha', 'media', 'plate.svg'), SVG);
  mkdirSync(path.join(decks, 'beta'), { recursive: true });
  writeFileSync(path.join(decks, 'beta', 'deck.md'), '# Beta\n');
  // Not decks: a bad slug and a folder without deck.md.
  mkdirSync(path.join(decks, 'Bad_Slug'), { recursive: true });
  writeFileSync(path.join(decks, 'Bad_Slug', 'deck.md'), '# Nope\n');
  mkdirSync(path.join(decks, 'empty'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>');
  writeFileSync(path.join(root, 'main.js'), 'console.log("x");\n');
  return { root, decks };
}

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const base = createLogger('silent');
  const logger: Logger = {
    ...base,
    warn: (msg) => { lines.push(msg); },
    warnOnce: (msg) => { lines.push(msg); },
    error: (msg) => { lines.push(msg); },
  };
  return { logger, lines };
}

/** A raw HTTP request, so paths like `/__dex/marks/../x` are sent exactly as written. */
function raw(port: number, method: string, urlPath: string, body?: string | Buffer, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('dex plugin in dev', () => {
  let project: { root: string; decks: string };
  let server: ViteDevServer;
  let port: number;
  let log: { logger: Logger; lines: string[] };
  const sent: { event: unknown; data: unknown }[] = [];

  const url = (p: string) => `http://127.0.0.1:${port}${p}`;

  function waitForEvent(event: string, pred: (data: any) => boolean = () => true, timeout = 8000): Promise<any> {
    const start = sent.length;
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const hit = sent.slice(start).find((s) => s.event === event && pred(s.data));
        if (hit) return resolve(hit.data);
        if (Date.now() - t0 > timeout) return reject(new Error(`no ${event} within ${timeout}ms; got ${JSON.stringify(sent.slice(start))}`));
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  beforeAll(async () => {
    project = makeProject();
    log = capturingLogger();
    server = await createServer({
      root: project.root,
      configFile: false,
      customLogger: log.logger,
      server: { port: 0, open: false },
      plugins: [dex({ dir: project.decks })],
    });
    // Record every HMR payload: custom events and Vite's own (update, full-reload).
    const hot = server.hot;
    expect(hot).toBe(server.environments.client.hot);
    const original = hot.send.bind(hot) as (...a: unknown[]) => void;
    hot.send = ((...args: unknown[]) => {
      if (typeof args[0] === 'string') sent.push({ event: args[0], data: args[1] });
      else sent.push({ event: (args[0] as { type: string }).type, data: args[0] });
      original(...args);
    }) as typeof hot.send;
    await server.listen();
    const addr = server.httpServer!.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
    // Let the watcher finish its initial scan before tests write files.
    await new Promise((r) => setTimeout(r, 300));
  });

  afterAll(async () => {
    await server?.close();
    rmSync(project.root, { recursive: true, force: true });
  });

  it('serves the deck index, sorted by modified descending, with no-store', async () => {
    const t = Date.now() / 1000;
    const { utimesSync } = await import('node:fs');
    utimesSync(path.join(project.decks, 'alpha', 'deck.md'), t - 100, t - 100);
    utimesSync(path.join(project.decks, 'beta', 'deck.md'), t - 50, t - 50);
    const res = await fetch(url('/decks/index.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const list = (await res.json()) as DeckSummary[];
    expect(list.map((d) => d.slug)).toEqual(['beta', 'alpha']);
    expect(list[1]).toMatchObject({ slug: 'alpha', title: 'Alpha', slides: 2 });
    expect(new Date(list[0]!.modified).getTime()).toBeGreaterThan(new Date(list[1]!.modified).getTime());
  });

  it('serves a compiled deck with no-store, and prints warnings and missing files', async () => {
    log.lines.length = 0;
    const { utimesSync } = await import('node:fs');
    const now = Date.now() / 1000;
    utimesSync(path.join(project.decks, 'alpha', 'deck.md'), now, now); // force a recompile
    const res = await fetch(url('/decks/alpha/deck.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const deck = (await res.json()) as Deck;
    expect(deck.slug).toBe('alpha');
    expect(deck.slides).toHaveLength(2);
    expect(deck.assets).toEqual(['media/plate.svg', 'media/missing.png']);
    expect(log.lines).toContain('alpha  missing file media/missing.png');
    expect(log.lines.some((l) => /^alpha:\d+ {2}.*layuot/.test(l))).toBe(true);
    expect(log.lines.filter((l) => l.includes('missing file'))).toHaveLength(1);
  });

  it('caches: a second request does not recompile', async () => {
    await fetch(url('/decks/alpha/deck.json'));
    log.lines.length = 0;
    await fetch(url('/decks/alpha/deck.json'));
    expect(log.lines).toEqual([]);
  });

  it('serves deck media through Vite', async () => {
    const res = await fetch(url('/decks/alpha/media/plate.svg'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<svg');
  });

  it('returns 404 for decks that do not exist or are not valid slugs', async () => {
    expect((await fetch(url('/decks/nope/deck.json'))).status).toBe(404);
    expect((await fetch(url('/decks/empty/deck.json'))).status).toBe(404);
    expect((await raw(port, 'GET', '/decks/Bad_Slug/deck.json')).status).toBe(404);
  });

  it('returns 500 with a line on broken frontmatter, sends dex:error, and recovers after the fix', async () => {
    const file = path.join(project.decks, 'beta', 'deck.md');
    const good = readFileSync(file, 'utf8');
    const errored = waitForEvent('dex:error', (d) => d.slug === 'beta');
    writeFileSync(file, '---\ntitle: Beta\ntheme: [unclosed\n---\n\n# Beta\n');
    const payload = await errored;
    expect(payload).toMatchObject({ slug: 'beta', error: expect.any(String), line: expect.any(Number) });

    const bad = await fetch(url('/decks/beta/deck.json'));
    expect(bad.status).toBe(500);
    expect(bad.headers.get('cache-control')).toBe('no-store');
    const body = (await bad.json()) as { error: string; line: number };
    expect(body.line).toBeGreaterThanOrEqual(2);
    expect(body.line).toBeLessThanOrEqual(4);
    expect(body.error).toBeTruthy();

    const updated = waitForEvent('dex:update', (d) => d.slug === 'beta');
    writeFileSync(file, good);
    await updated;
    const ok = await fetch(url('/decks/beta/deck.json'));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Deck).slides[0]!.title).toBe('Beta');
  });

  it('sends dex:update { slug } after an edit, and serves the new content', async () => {
    const file = path.join(project.decks, 'beta', 'deck.md');
    const updated = waitForEvent('dex:update', (d) => d.slug === 'beta');
    writeFileSync(file, '# Beta\n\n---\n\n## Added slide\n');
    expect(await updated).toEqual({ slug: 'beta' });
    const deck = (await (await fetch(url('/decks/beta/deck.json'))).json()) as Deck;
    expect(deck.slides.map((s) => s.title)).toEqual(['Beta', 'Added slide']);
  });

  it('sends dex:index when a deck is added or removed, and never reloads the page', async () => {
    const dirPath = path.join(project.decks, 'gamma');
    mkdirSync(dirPath);
    const added = waitForEvent('dex:index', (d) => d.slugs.includes('gamma'));
    writeFileSync(path.join(dirPath, 'deck.md'), '# Gamma\n');
    expect(await added).toEqual({ slugs: ['alpha', 'beta', 'gamma'] });
    const list = (await (await fetch(url('/decks/index.json'))).json()) as DeckSummary[];
    expect(list.map((d) => d.slug)).toContain('gamma');

    const removed = waitForEvent('dex:index', (d) => !d.slugs.includes('gamma'));
    unlinkSync(path.join(dirPath, 'deck.md'));
    expect(await removed).toEqual({ slugs: ['alpha', 'beta'] });
    expect((await fetch(url('/decks/gamma/deck.json'))).status).toBe(404);
    expect(sent.filter((s) => s.event === 'full-reload' || s.event === 'update')).toEqual([]);
  });

  it('writes marks.json with two-space indentation and returns 204, without a reload', async () => {
    const before = sent.length;
    const marks = { version: 1, slides: { two: { strokes: [], notes: [{ id: 'n1', x: 1, y: 2, w: 220, h: 220, text: 'hi', color: 'yellow' }] } } };
    const res = await raw(port, 'PUT', '/__dex/marks/alpha', JSON.stringify(marks), { 'content-type': 'application/json' });
    expect(res.status).toBe(204);
    expect(res.headers['cache-control']).toBe('no-store');
    const file = path.join(project.decks, 'alpha', 'marks.json');
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify(marks, null, 2)}\n`);
    // Give the watcher time to see the write; it must not reload the page or send dex events.
    await new Promise((r) => setTimeout(r, 600));
    expect(sent.slice(before)).toEqual([]);
    // The marks file is then served as a plain static file.
    const back = await fetch(url('/decks/alpha/marks.json'));
    expect(await back.json()).toEqual(marks);
  });

  it('rejects unsafe slugs with 400 and writes nothing', async () => {
    const body = JSON.stringify({ version: 1, slides: {} });
    const outside = path.join(project.root, 'marks.json');
    for (const p of [
      '/__dex/marks/..',
      '/__dex/marks/../x',
      '/__dex/marks/..%2F..%2Fx',
      '/__dex/marks/alpha/..',
      '/__dex/marks/alpha%2F..%2F..',
      '/__dex/marks/a/b',
      '/__dex/marks/.hidden',
      '/__dex/marks/Alpha',
      '/__dex/marks/',
    ]) {
      const res = await raw(port, 'PUT', p, body);
      expect(res.status, p).toBe(400);
    }
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(path.join(project.decks, 'marks.json'))).toBe(false);
    expect(existsSync(path.join(project.decks, 'beta', 'marks.json'))).toBe(false);
  });

  it('rejects a deck that does not exist, bad JSON, non-marks JSON, and other methods', async () => {
    expect((await raw(port, 'PUT', '/__dex/marks/nope', '{"version":1,"slides":{}}')).status).toBe(404);
    expect(existsSync(path.join(project.decks, 'nope'))).toBe(false);
    expect((await raw(port, 'PUT', '/__dex/marks/beta', '{not json')).status).toBe(400);
    expect((await raw(port, 'PUT', '/__dex/marks/beta', '[1,2]')).status).toBe(400);
    expect((await raw(port, 'GET', '/__dex/marks/beta')).status).toBe(405);
    expect(existsSync(path.join(project.decks, 'beta', 'marks.json'))).toBe(false);
  });

  it('rejects an oversized body with 413 and leaves the file alone', async () => {
    const file = path.join(project.decks, 'alpha', 'marks.json');
    const before = readFileSync(file, 'utf8');
    const big = `{"version":1,"slides":{},"pad":"${'x'.repeat(MARKS_LIMIT)}"}`;
    const declared = await raw(port, 'PUT', '/__dex/marks/alpha', big);
    expect(declared.status).toBe(413);
    // Chunked, so the limit is enforced while streaming rather than from Content-Length.
    const streamed = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method: 'PUT', path: '/__dex/marks/alpha', headers: { 'transfer-encoding': 'chunked' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      const piece = Buffer.alloc(1024 * 1024, 'x');
      for (let i = 0; i < 6; i++) req.write(piece);
      req.end();
    });
    expect(streamed).toBe(413);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('accepts a body just under the limit', async () => {
    const pad = 'x'.repeat(MARKS_LIMIT - 100);
    const res = await raw(port, 'PUT', '/__dex/marks/beta', `{"version":1,"slides":{},"pad":"${pad}"}`);
    expect(res.status).toBe(204);
    rmSync(path.join(project.decks, 'beta', 'marks.json'));
  });
});

describe('dex plugin in build', () => {
  it('emits index.json, each deck.json, and every other deck file except deck.md', async () => {
    const project = makeProject();
    writeFileSync(path.join(project.decks, 'alpha', 'marks.json'), '{"version":1,"slides":{}}\n');
    mkdirSync(path.join(project.decks, 'alpha', 'media', 'sub'));
    writeFileSync(path.join(project.decks, 'alpha', 'media', 'sub', 'note.txt'), 'nested');
    writeFileSync(path.join(project.decks, 'alpha', '.DS_Store'), 'junk');
    const outDir = path.join(project.root, 'dist');
    try {
      await build({
        root: project.root,
        configFile: false,
        logLevel: 'silent',
        build: { outDir },
        plugins: [dex({ dir: project.decks })],
      });
      const index = JSON.parse(readFileSync(path.join(outDir, 'decks', 'index.json'), 'utf8')) as DeckSummary[];
      expect(index.map((d) => d.slug).sort()).toEqual(['alpha', 'beta']);
      const deck = JSON.parse(readFileSync(path.join(outDir, 'decks', 'alpha', 'deck.json'), 'utf8')) as Deck;
      expect(deck.slides).toHaveLength(2);
      expect(existsSync(path.join(outDir, 'decks', 'beta', 'deck.json'))).toBe(true);
      expect(readFileSync(path.join(outDir, 'decks', 'alpha', 'media', 'plate.svg'), 'utf8')).toBe(SVG);
      expect(readFileSync(path.join(outDir, 'decks', 'alpha', 'media', 'sub', 'note.txt'), 'utf8')).toBe('nested');
      expect(existsSync(path.join(outDir, 'decks', 'alpha', 'marks.json'))).toBe(true);
      expect(existsSync(path.join(outDir, 'decks', 'alpha', 'deck.md'))).toBe(false);
      expect(existsSync(path.join(outDir, 'decks', 'alpha', '.DS_Store'))).toBe(false);
      expect(existsSync(path.join(outDir, 'decks', 'Bad_Slug'))).toBe(false);
    } finally {
      rmSync(project.root, { recursive: true, force: true });
    }
  });

  it('fails the build with the deck name and line on a compile error, emitting nothing', async () => {
    const project = makeProject();
    writeFileSync(path.join(project.decks, 'beta', 'deck.md'), '---\ntitle: Beta\ntheme: [unclosed\n---\n\n# Beta\n');
    const outDir = path.join(project.root, 'dist');
    try {
      await expect(
        build({ root: project.root, configFile: false, logLevel: 'silent', build: { outDir }, plugins: [dex({ dir: project.decks })] }),
      ).rejects.toThrow(/beta\/deck\.md:\d+/);
      expect(existsSync(path.join(outDir, 'decks', 'beta', 'deck.json'))).toBe(false);
    } finally {
      rmSync(project.root, { recursive: true, force: true });
    }
  });
});
