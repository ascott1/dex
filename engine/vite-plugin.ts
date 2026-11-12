// The dex Vite plugin: serves compiled decks in dev, watches deck.md files,
// accepts marks writes, and emits the same JSON plus deck media in `vite build`.
import { existsSync } from 'node:fs';
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Logger, Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { Deck, DeckSummary } from '../shared/types.ts';
import { compileDeck, DexCompileError } from './compiler/index.ts';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const MARKS_LIMIT = 5 * 1024 * 1024;

export interface DexOptions {
  /**
   * The folder that holds the decks, absolute or relative to the Vite root.
   * Default `decks`. Deck URLs are always `decks/<slug>/…`, and in dev media
   * files are served by Vite's own static serving, so a folder other than
   * `<root>/decks` gets its JSON served but not its media.
   */
  dir?: string;
}

/** Payload of the `dex:update` custom HMR event: a deck.md was added, changed, or removed. */
export interface DexUpdateEvent { slug: string }
/** Payload of `dex:error`: a deck failed to compile. `line` is 1-based in deck.md, or null. */
export interface DexErrorEvent { slug: string; error: string; line: number | null }
/** Payload of `dex:index`: the set of decks changed. `slugs` is sorted. */
export interface DexIndexEvent { slugs: string[] }

type CompileResult =
  | { ok: true; deck: Deck; modified: Date }
  | { ok: false; error: string; line: number | null; modified: Date };

interface CacheEntry { key: string; result: CompileResult }

/** Lists the slugs of every `<dir>/<slug>/deck.md`, sorted. */
export async function discoverDecks(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const slugs = entries
    .filter((e) => e.isDirectory() && SLUG_RE.test(e.name) && existsSync(path.join(dir, e.name, 'deck.md')))
    .map((e) => e.name);
  return slugs.sort();
}

function errorInfo(err: unknown): { error: string; line: number | null } {
  if (err instanceof DexCompileError) return { error: err.message, line: err.line };
  return { error: err instanceof Error ? err.message : String(err), line: null };
}

/** Compiles one deck from disk and prints its warnings and missing files. */
async function compileFromDisk(dir: string, slug: string, logger: Logger): Promise<CompileResult> {
  const file = path.join(dir, slug, 'deck.md');
  const [source, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
  const modified = info.mtime;
  try {
    const deck = await compileDeck(source, { slug });
    for (const w of deck.warnings) logger.warn(`${slug}:${w.line}  ${w.message}`, { timestamp: true });
    for (const asset of deck.assets) {
      if (!existsSync(path.join(dir, slug, asset))) logger.warn(`${slug}  missing file ${asset}`, { timestamp: true });
    }
    return { ok: true, deck, modified };
  } catch (err) {
    const { error, line } = errorInfo(err);
    logger.error(`${slug}:${line ?? '?'}  ${error}`, { timestamp: true });
    return { ok: false, error, line, modified };
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

class BodyTooLarge extends Error {}

/**
 * Reads a request body, rejecting with BodyTooLarge when it is over `limit` bytes.
 * Past the limit (declared or counted) nothing more is buffered, but the rest is
 * drained before settling: responding while the client is still sending makes
 * it see a connection reset instead of the 413.
 */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    const chunks: Buffer[] = [];
    let size = 0;
    let over = Number.isFinite(declared) && declared > limit;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => (over ? reject(new BodyTooLarge()) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function isMarks(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.slides === 'object' && v.slides !== null && !Array.isArray(v.slides);
}

/** Every file under `root`, as paths relative to it with `/` separators. Skips dotfiles. */
async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, child)));
    else if (e.isFile()) out.push(child);
  }
  return out;
}

export function dex(options: DexOptions = {}): Plugin {
  let config: ResolvedConfig;
  let dir = '';
  const cache = new Map<string, CacheEntry>();
  const queues = new Map<string, Promise<unknown>>();

  /** Runs `task` after any earlier task for the same slug, so compiles never interleave. */
  function serial<T>(slug: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(slug) ?? Promise.resolve()).then(task, task);
    queues.set(slug, run.catch(() => undefined));
    return run;
  }

  /**
   * Returns the cached compile result for a deck, recompiling only when deck.md's
   * mtime or size has changed, so each version of the file is compiled (and its
   * warnings printed) once, whether a request or the watcher sees it first.
   * Returns null when the deck does not exist.
   */
  function load(slug: string): Promise<CompileResult | null> {
    return serial(slug, async () => {
      const file = path.join(dir, slug, 'deck.md');
      let key: string;
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error('not a file');
        key = `${info.mtimeMs}:${info.size}`;
      } catch {
        cache.delete(slug);
        return null;
      }
      const hit = cache.get(slug);
      if (hit && hit.key === key) return hit.result;
      let result: CompileResult;
      try {
        result = await compileFromDisk(dir, slug, config.logger);
      } catch {
        cache.delete(slug);
        return null;
      }
      cache.set(slug, { key, result });
      return result;
    });
  }

  async function summaries(): Promise<DeckSummary[]> {
    const slugs = await discoverDecks(dir);
    const list: DeckSummary[] = [];
    for (const slug of slugs) {
      const r = await load(slug);
      if (!r) continue;
      list.push({
        slug,
        title: r.ok ? r.deck.meta.title : slug,
        slides: r.ok ? r.deck.slides.length : 0,
        modified: r.modified.toISOString(),
      });
    }
    return list.sort((a, b) => b.modified.localeCompare(a.modified) || a.slug.localeCompare(b.slug));
  }

  /** `<dir>/<slug>/deck.md` → slug, else null. */
  function deckSlugOf(file: string): string | null {
    const rel = path.relative(dir, file);
    const parts = rel.split(path.sep);
    if (parts.length !== 2 || parts[1] !== 'deck.md' || !SLUG_RE.test(parts[0]!)) return null;
    return parts[0]!;
  }

  function isUnderDir(file: string): boolean {
    const rel = path.relative(dir, file);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  return {
    name: 'dex',

    configResolved(resolved) {
      config = resolved;
      dir = path.resolve(resolved.root, options.dir ?? 'decks');
    },

    configureServer(server: ViteDevServer) {
      let known = new Set<string>();
      void discoverDecks(dir).then((s) => { known = new Set(s); });
      // Vite watches its root; this covers a decks folder outside it. Re-adding a watched path is a no-op.
      server.watcher.add(dir);

      async function refreshIndex(): Promise<void> {
        const now = await discoverDecks(dir);
        const changed = now.length !== known.size || now.some((s) => !known.has(s));
        known = new Set(now);
        if (changed) server.hot.send('dex:index', { slugs: now } satisfies DexIndexEvent);
      }

      async function onDeckFile(file: string, kind: 'add' | 'change' | 'unlink'): Promise<void> {
        const slug = deckSlugOf(file);
        if (!slug) return;
        const result = await load(slug);
        if (result && !result.ok) {
          server.hot.send('dex:error', { slug, error: result.error, line: result.line } satisfies DexErrorEvent);
        } else {
          server.hot.send('dex:update', { slug } satisfies DexUpdateEvent);
        }
        if (kind !== 'change') await refreshIndex();
      }

      const log = (err: unknown) => config.logger.error(`dex: ${errorInfo(err).error}`);
      server.watcher.on('add', (f) => void onDeckFile(f, 'add').catch(log));
      server.watcher.on('change', (f) => void onDeckFile(f, 'change').catch(log));
      server.watcher.on('unlink', (f) => void onDeckFile(f, 'unlink').catch(log));
      server.watcher.on('unlinkDir', (f) => { if (isUnderDir(f)) void refreshIndex().catch(log); });

      const base = config.base.startsWith('/') && config.base !== '/' ? config.base.replace(/\/$/, '') : '';

      server.middlewares.use((req, res, next) => {
        let pathname = (req.url ?? '/').split('?')[0]!;
        if (base && pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length);

        if (pathname.startsWith('/__dex/marks/')) {
          if (req.method !== 'PUT') {
            res.setHeader('Allow', 'PUT');
            sendJson(res, 405, { error: 'use PUT' });
            return;
          }
          void putMarks(req, res, pathname.slice('/__dex/marks/'.length)).catch((err) => {
            if (!res.headersSent) sendJson(res, 500, { error: errorInfo(err).error });
          });
          return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        if (pathname === '/decks/index.json') {
          void summaries().then((list) => sendJson(res, 200, list), next);
          return;
        }

        const m = /^\/decks\/([^/]+)\/deck\.json$/.exec(pathname);
        if (m) {
          const slug = m[1]!;
          if (!SLUG_RE.test(slug)) {
            sendJson(res, 404, { error: `no deck "${slug}"` });
            return;
          }
          void load(slug).then((r) => {
            if (!r) sendJson(res, 404, { error: `no deck "${slug}"` });
            else if (r.ok) sendJson(res, 200, r.deck);
            else sendJson(res, 500, { error: r.error, line: r.line });
          }, next);
          return;
        }

        next();
      });

      async function putMarks(req: IncomingMessage, res: ServerResponse, slug: string): Promise<void> {
        // Validate the raw path segment before it goes anywhere near a path:
        // the regex admits no `.`, `/`, `\`, or `%`.
        if (!SLUG_RE.test(slug)) {
          req.resume();
          sendJson(res, 400, { error: 'invalid deck slug' });
          return;
        }
        const deckDir = path.join(dir, slug);
        if (!existsSync(path.join(deckDir, 'deck.md'))) {
          req.resume();
          sendJson(res, 404, { error: `no deck "${slug}"` });
          return;
        }
        let body: Buffer;
        try {
          body = await readBody(req, MARKS_LIMIT);
        } catch (err) {
          if (err instanceof BodyTooLarge) {
            sendJson(res, 413, { error: `marks body is over ${MARKS_LIMIT} bytes` });
            return;
          }
          throw err;
        }
        let data: unknown;
        try {
          data = JSON.parse(body.toString('utf8'));
        } catch {
          sendJson(res, 400, { error: 'body is not valid JSON' });
          return;
        }
        if (!isMarks(data)) {
          sendJson(res, 400, { error: 'body is not a Marks object ({ version: 1, slides: {…} })' });
          return;
        }
        const target = path.join(deckDir, 'marks.json');
        const temp = path.join(deckDir, `.marks.json.${process.pid}.tmp`);
        await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
        await rename(temp, target);
        sendEmpty(res, 204);
      }
    },

    handleHotUpdate(ctx) {
      // Deck files (deck.md, marks.json, media) never reload the page; the
      // watcher above sends dex:* events instead.
      if (isUnderDir(ctx.file)) return [];
    },

    async generateBundle() {
      const slugs = await discoverDecks(dir);
      const index: DeckSummary[] = [];
      for (const slug of slugs) {
        const deckDir = path.join(dir, slug);
        const result = await compileFromDisk(dir, slug, config.logger);
        if (!result.ok) {
          this.error(`dex: ${slug}/deck.md:${result.line ?? '?'}: ${result.error}`);
        }
        const { deck, modified } = result;
        index.push({ slug, title: deck.meta.title, slides: deck.slides.length, modified: modified.toISOString() });
        this.emitFile({ type: 'asset', fileName: `decks/${slug}/deck.json`, source: JSON.stringify(deck) });
        for (const rel of await walk(deckDir)) {
          if (rel === 'deck.md') continue;
          this.emitFile({
            type: 'asset',
            fileName: `decks/${slug}/${rel}`,
            source: await readFile(path.join(deckDir, rel)),
          });
        }
      }
      index.sort((a, b) => b.modified.localeCompare(a.modified) || a.slug.localeCompare(b.slug));
      this.emitFile({ type: 'asset', fileName: 'decks/index.json', source: JSON.stringify(index) });
    },
  };
}
