import { describe, expect, it } from 'vitest';
import { DexCompileError, parseFrontmatter } from './frontmatter.ts';
import { compileDeck } from './index.ts';

describe('frontmatter', () => {
  it('uses defaults when there is none', () => {
    const fm = parseFrontmatter('# Hello\n');
    expect(fm.meta).toEqual({ theme: 'paper', aspect: '16:9', build: false, transition: 'fade', lang: 'en' });
    expect(fm.body).toBe('# Hello\n');
    expect(fm.bodyLine).toBe(1);
    expect(fm.warnings).toEqual([]);
  });

  it('parses valid frontmatter and counts consumed lines', () => {
    const src = '---\ntitle: Talk\nauthor: Someone\ndate: 2026-11-12\ntheme: ink\naspect: 4:3\nbuild: true\ntransition: none\nlang: fr\n---\n# Hi';
    const fm = parseFrontmatter(src);
    expect(fm.meta).toEqual({
      title: 'Talk', author: 'Someone', date: '2026-11-12', theme: 'ink',
      aspect: '4:3', build: true, transition: 'none', lang: 'fr',
    });
    expect(fm.body).toBe('# Hi');
    expect(fm.bodyLine).toBe(11);
    expect(fm.warnings).toEqual([]);
  });

  it('accepts empty frontmatter', () => {
    const fm = parseFrontmatter('---\n---\n# Hi');
    expect(fm.meta.theme).toBe('paper');
    expect(fm.bodyLine).toBe(3);
  });

  it('warns on an unknown key and keeps the defaults', () => {
    const fm = parseFrontmatter('---\ntitle: T\nthemes: ink\n---\nx');
    expect(fm.warnings).toEqual([{ line: 3, message: 'unknown frontmatter key "themes"' }]);
    expect(fm.meta.theme).toBe('paper');
  });

  it('warns on a bad value and uses the default', () => {
    const fm = parseFrontmatter('---\ntheme: sepia\nbuild: yes please\n---\nx');
    expect(fm.meta.theme).toBe('paper');
    expect(fm.meta.build).toBe(false);
    expect(fm.warnings.map((w) => w.line)).toEqual([2, 3]);
    expect(fm.warnings[0]!.message).toMatch(/theme/);
  });

  it('throws DexCompileError with a deck.md line for invalid YAML', () => {
    const src = '---\ntitle: ok\nauthor: [unclosed\n---\n# Hi';
    let err: unknown;
    try {
      parseFrontmatter(src);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DexCompileError);
    expect((err as DexCompileError).line).toBeGreaterThanOrEqual(3);
    expect((err as DexCompileError).line).toBeLessThanOrEqual(4);
  });

  it('reports the exact line of a YAML error', () => {
    try {
      parseFrontmatter('---\ntitle: ok\nlang: en\n- item\n---\n');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DexCompileError);
      expect((e as DexCompileError).line).toBe(4);
      // The YAML library's own (frontmatter-relative) position is not repeated.
      expect((e as DexCompileError).message).not.toMatch(/at line/);
    }
  });

  it('compileDeck rejects invalid YAML and reports frontmatter warnings with slide -1', async () => {
    await expect(compileDeck('---\na: [\n---\nx', { slug: 't' })).rejects.toBeInstanceOf(DexCompileError);
    const deck = await compileDeck('---\nfoo: 1\n---\n# Hi', { slug: 't' });
    expect(deck.warnings).toEqual([{ slide: -1, line: 2, message: 'unknown frontmatter key "foo"' }]);
  });

  it('treats an unclosed leading --- as a slide break, not frontmatter', () => {
    const fm = parseFrontmatter('---\n# Hi\n');
    expect(fm.body).toBe('---\n# Hi\n');
  });

  it('does not swallow a first slide that sits between two separators', async () => {
    const source = '---\n# My Title\n---\n## Next\n\n- a';
    const fm = parseFrontmatter(source);
    expect(fm.body).toBe(source);
    expect(fm.bodyLine).toBe(1);
    const deck = await compileDeck(source, { slug: 't' });
    expect(deck.slides.map((s) => s.title)).toEqual(['My Title', 'Next']);
    expect(deck.warnings).toEqual([]);
  });

  it('treats a leading block that is not a key: value map as a slide', async () => {
    const deck = await compileDeck('---\nHello world\n---\n## Next', { slug: 't' });
    expect(deck.slides.map((s) => s.title)).toEqual(['Hello world', 'Next']);
    expect(deck.warnings).toEqual([]);
    const list = await compileDeck('---\n- one\n- two\n---\n## Next', { slug: 't' });
    expect(list.slides).toHaveLength(2);
  });

  it('does not report a YAML error for a leading block with no key: value line', async () => {
    const deck = await compileDeck('---\n*emphasis* and [a bracket\n---\n## Next', { slug: 't' });
    expect(deck.slides).toHaveLength(2);
  });
});
