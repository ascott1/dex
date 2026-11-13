import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { chunkHash, clearCompileCache, compileDeck, compileStats } from './index.ts';

const DEMO = fileURLToPath(new URL('../../decks/demo/deck.md', import.meta.url));
const demoSource = () => readFileSync(DEMO, 'utf8');

describe('compileDeck', () => {
  it('assigns ids from titles, de-duplicated per deck', async () => {
    const deck = await compileDeck('## Intro\n\n---\n\n## Intro\n\n---\n\n## Intro\n\n---\n\n## Other', { slug: 'ids' });
    expect(deck.slides.map((s) => s.id)).toEqual(['intro', 'intro-1', 'intro-2', 'other']);
    expect(deck.slides.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('uses the id directive, falls back to slide-<n>, and keeps ids unique', async () => {
    const deck = await compileDeck(
      '<!-- id: opening -->\n\n## Intro\n\n---\n\n![](a.png)\n\n---\n\n<!-- id: intro -->\n\n## Again\n\n---\n\n## Intro',
      { slug: 'ids' },
    );
    expect(deck.slides.map((s) => s.id)).toEqual(['opening', 'slide-2', 'intro', 'intro-1']);
    expect(deck.slides[0]!.options.id).toBe('opening');
  });

  it('numbers sections in order with zero padding', async () => {
    const parts = ['# Deck', ...Array.from({ length: 10 }, (_, i) => `# Part ${i + 1}`)];
    const deck = await compileDeck(parts.join('\n\n---\n\n'), { slug: 'sec' });
    expect(deck.slides[0]!.layout).toBe('title');
    expect(deck.slides.slice(1).map((s) => s.attrs['data-section'])).toEqual([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
    ]);
  });

  it('a section moved to the front becomes a title, from the cache', async () => {
    clearCompileCache();
    const a = await compileDeck('# Deck\n\n---\n\n# Part', { slug: 'move' });
    expect(a.slides[1]!.layout).toBe('section');
    const b = await compileDeck('# Part\n\n---\n\n# Deck', { slug: 'move' });
    expect(b.slides[0]!.layout).toBe('title');
    expect(b.slides[0]!.attrs['data-section']).toBeUndefined();
    expect(b.slides[1]!.layout).toBe('section');
    expect(b.slides[1]!.attrs['data-section']).toBe('01');
  });

  it('falls back for titles: heading of depth ≤ 3, then 60 characters of text, then null', async () => {
    const long = 'A sentence that goes on for quite a while, longer than sixty characters in total.';
    const deck = await compileDeck(
      `###### Eyebrow\n\n### Sub *heading*\n\n---\n\n#### Small\n\n${long}\n\n---\n\n<div></div>\n\n---\n\n# Real`,
      { slug: 'titles' },
    );
    expect(deck.slides[0]!.title).toBe('Sub heading');
    expect(deck.slides[1]!.title).toBe(`Small ${long}`.slice(0, 60));
    expect(deck.slides[2]!.title).toBeNull();
    expect(deck.slides[2]!.id).toBe('slide-3');
  });

  it('meta.title falls back to the first slide title, then the slug', async () => {
    expect((await compileDeck('---\ntitle: Given\n---\n# First', { slug: 's' })).meta.title).toBe('Given');
    expect((await compileDeck('# First\n\n---\n\n# Second', { slug: 's' })).meta.title).toBe('First');
    expect((await compileDeck('<div></div>', { slug: 'the-slug' })).meta.title).toBe('the-slug');
    expect((await compileDeck('', { slug: 'empty' })).slides).toEqual([]);
  });

  it('normalizes CRLF line endings', async () => {
    const deck = await compileDeck('---\r\ntitle: T\r\n---\r\n# A\r\n\r\n---\r\n\r\n## B\r\n', { slug: 'crlf' });
    expect(deck.meta.title).toBe('T');
    expect(deck.slides.map((s) => s.line)).toEqual([4, 8]);
  });

  it('keeps hashes stable, and changing one slide changes only its hash', async () => {
    const src = '# A\n\n---\n\n## B\n\n- one\n\n---\n\n## C';
    const a = await compileDeck(src, { slug: 'h' });
    const b = await compileDeck(src, { slug: 'h' });
    expect(b.slides.map((s) => s.hash)).toEqual(a.slides.map((s) => s.hash));
    expect(a.slides[0]!.hash).toMatch(/^[0-9a-f]{10}$/);

    const c = await compileDeck(src.replace('- one', '- two'), { slug: 'h' });
    expect(c.slides[0]!.hash).toBe(a.slides[0]!.hash);
    expect(c.slides[1]!.hash).not.toBe(a.slides[1]!.hash);
    expect(c.slides[2]!.hash).toBe(a.slides[2]!.hash);

    // The slug and the deck's build setting are part of the hash.
    const d = await compileDeck(src, { slug: 'other' });
    expect(d.slides[0]!.hash).not.toBe(a.slides[0]!.hash);
    const e = await compileDeck('---\nbuild: true\n---\n' + src, { slug: 'h' });
    expect(e.slides[0]!.hash).not.toBe(a.slides[0]!.hash);
    expect(chunkHash('# A', 'h', false)).toBe(a.slides[0]!.hash);
  });

  it('does not let one compile mutate another through the cache', async () => {
    const src = '# Deck\n\n---\n\n# Part';
    const a = await compileDeck(src, { slug: 'iso' });
    a.slides[1]!.attrs['data-x'] = 'y';
    a.slides[1]!.options.invert = true;
    const b = await compileDeck(src, { slug: 'iso' });
    expect(b.slides[1]!.attrs).toEqual({ 'data-section': '01' });
    expect(b.slides[1]!.options).toEqual({});
  });
});

describe('per-slide cache', () => {
  beforeEach(() => clearCompileCache());

  it('recompiles only the slide that changed', async () => {
    const src = demoSource();
    compileStats.chunks = 0;
    const first = await compileDeck(src, { slug: 'demo' });
    expect(compileStats.chunks).toBe(23);

    compileStats.chunks = 0;
    await compileDeck(src, { slug: 'demo' });
    expect(compileStats.chunks).toBe(0);

    compileStats.chunks = 0;
    const edited = src.replace('+ Press → or Space to show the next item', '+ Press → or Space to show the next one');
    const second = await compileDeck(edited, { slug: 'demo' });
    expect(compileStats.chunks).toBe(1);

    const changed = second.slides.filter((s, i) => s.hash !== first.slides[i]!.hash).map((s) => s.index);
    expect(changed).toEqual([3]);
    expect(second.slides[3]!.html).toContain('to show the next one');
  });

  it('re-emits cached warnings with the right lines', async () => {
    const src = '# A\n\n---\n\n<!-- layuot: x -->\n\n## B';
    const a = await compileDeck(src, { slug: 'w' });
    const b = await compileDeck('# Inserted\n\n---\n\n' + src, { slug: 'w' });
    expect(a.warnings).toEqual([{ slide: 1, line: 5, message: 'unknown directive "layuot" (did you mean "layout"?)' }]);
    expect(b.warnings).toEqual([{ slide: 2, line: 9, message: 'unknown directive "layuot" (did you mean "layout"?)' }]);
  });
});

describe('demo deck', () => {
  it('compiles to 23 slides with zero warnings', async () => {
    const deck = await compileDeck(demoSource(), { slug: 'demo' });
    expect(deck.slides).toHaveLength(23);
    expect(deck.warnings).toEqual([]);
    expect(deck.assets).toEqual(['media/plate-1.svg', 'media/plate-2.svg', 'media/plate-3.svg', 'media/plate-4.svg']);
    // Every slide has a speaker note.
    expect(deck.slides.filter((s) => s.notes === '').map((s) => s.index)).toEqual([]);
    expect(deck.slides.map((s) => s.layout)).toEqual([
      'title', 'statement', 'section', 'default', 'default', 'columns', 'columns', 'split', 'split',
      'figure', 'image', 'gallery', 'quote', 'statement', 'default', 'default', 'default', 'statement',
      'default', 'default', 'default', 'default', 'title',
    ]);
  });

  it('matches the snapshot', async () => {
    const deck = await compileDeck(demoSource(), { slug: 'demo' });
    expect({ ...deck, slides: deck.slides.map(({ source: _source, ...rest }) => rest) }).toMatchSnapshot();
  });
});
