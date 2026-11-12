import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { compileDeck } from '../compiler/index.ts';
import { starterDeck, titleFromSlug } from './template.mjs';

const SCRIPT = fileURLToPath(new URL('./new.mjs', import.meta.url));

describe('starter template', () => {
  it('compiles to five slides with zero warnings', async () => {
    const deck = await compileDeck(starterDeck('my-talk'), { slug: 'my-talk' });
    expect(deck.warnings).toEqual([]);
    expect(deck.meta.title).toBe('My talk');
    expect(deck.slides.map((s) => s.layout)).toEqual(['title', 'default', 'default', 'quote', 'title']);
    expect(deck.slides[1]!.steps).toBe(3);
    expect(deck.slides[0]!.notes).toContain('README.md');
    expect(deck.slides[2]!.notes).toContain('media/photo.jpg');
    expect(deck.assets).toEqual([]);
  });

  it('turns the slug into a title', () => {
    expect(titleFromSlug('q3-review')).toBe('Q3 review');
    expect(titleFromSlug('talk')).toBe('Talk');
  });
});

describe('pnpm new', () => {
  let cwd = '';
  afterEach(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

  it('creates the deck, then refuses to overwrite it', () => {
    cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'dex-new-')));
    const first = run('scratch');
    expect(first.status).toBe(0);
    const file = path.join(cwd, 'decks', 'scratch', 'deck.md');
    expect(readFileSync(file, 'utf8')).toBe(starterDeck('scratch'));
    expect(existsSync(path.join(cwd, 'decks', 'scratch', 'media'))).toBe(true);

    const second = run('scratch');
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('decks/scratch/deck.md already exists');
    expect(readFileSync(file, 'utf8')).toBe(starterDeck('scratch'));
  });

  it('rejects a missing or invalid slug and writes nothing', () => {
    cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'dex-new-')));
    expect(run().status).toBe(1);
    for (const bad of ['../x', 'a/b', 'Talk', '-x', 'a_b', '.']) {
      const r = run(bad);
      expect(r.status, bad).toBe(1);
      expect(r.stderr).toContain('not a valid deck name');
    }
    expect(existsSync(path.join(cwd, 'decks'))).toBe(false);
  });
});
