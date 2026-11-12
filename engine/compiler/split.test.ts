import { describe, expect, it } from 'vitest';
import { compileDeck } from './index.ts';
import { isolateMarkers, splitSlides } from './split.ts';

describe('split', () => {
  it('splits on lines of dashes', () => {
    const chunks = splitSlides('# One\n\n---\n\n## Two\n\n-----\n\nThree');
    expect(chunks.map((c) => c.text)).toEqual(['# One', '## Two', 'Three']);
  });

  it('ignores --- inside a backtick fence', () => {
    const chunks = splitSlides('```yaml\n---\nkey: v\n---\n```\n\n---\n\nnext');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text).toBe('```yaml\n---\nkey: v\n---\n```');
  });

  it('ignores --- inside a tilde fence, which a shorter or different fence does not close', () => {
    const chunks = splitSlides('~~~~\n---\n```\n~~~\n---\n~~~~\n---\nnext');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text).toBe('~~~~\n---\n```\n~~~\n---\n~~~~');
    expect(chunks[1]!.text).toBe('next');
  });

  it('splits on --- directly under a line of text', () => {
    const chunks = splitSlides('Some text\n---\nMore text');
    expect(chunks.map((c) => c.text)).toEqual(['Some text', 'More text']);
  });

  it('produces no empty slides from leading, trailing, or doubled separators', () => {
    const chunks = splitSlides('\n---\n\n# A\n---\n---\n  \n---\n# B\n---\n\n');
    expect(chunks.map((c) => c.text)).toEqual(['# A', '# B']);
  });

  it('records 1-based start lines without frontmatter', () => {
    const chunks = splitSlides('# A\n\n---\n\n\n## B\ntext\n---\nC');
    expect(chunks.map((c) => c.line)).toEqual([1, 6, 9]);
  });

  it('records deck.md lines with frontmatter', async () => {
    const src = '---\ntitle: T\n---\n\n# A\n\n---\n\n## B\n';
    const deck = await compileDeck(src, { slug: 'split-lines' });
    expect(deck.slides.map((s) => s.line)).toEqual([5, 9]);
    expect(deck.slides[1]!.source).toBe('## B');
  });

  it('isolates marker lines into their own paragraphs, mapping lines back', () => {
    const iso = isolateMarkers('text\n|||\nmore');
    expect(iso.text).toBe('text\n\n|||\n\nmore');
    expect(iso.lineMap).toEqual([1, 2, 2, 2, 3]);
    expect(isolateMarkers('```\n|||\n```').text).toBe('```\n|||\n```');
  });
});
