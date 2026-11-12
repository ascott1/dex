import { describe, expect, it } from 'vitest';
import type { Slide } from '../../shared/types.ts';
import { compileDeck } from './index.ts';

const P60 = 'This paragraph is exactly sixty characters long, as counted.';
const P300 = 'word '.repeat(60).trim();
const FILLER = ['# Opening\n\nA lede.', '## Filler\n\n- point'];

/** Compile `md` as slide `n` (1-based) of a deck padded with filler slides. */
async function at(md: string, n = 2): Promise<Slide> {
  const before = Array.from({ length: n - 1 }, (_, i) => FILLER[i % FILLER.length]);
  const deck = await compileDeck([...before, md].join('\n\n---\n\n'), { slug: 'layout' });
  expect(deck.slides).toHaveLength(n);
  return deck.slides[n - 1]!;
}

describe('layout inference fixtures (PLAN.md §6)', () => {
  it('sanity: fixture paragraph lengths', () => {
    expect(P60).toHaveLength(60);
    expect(P300).toHaveLength(299);
  });

  it('`# Title` as slide 1 → title', async () => {
    expect((await at('# Title', 1)).layout).toBe('title');
  });

  it('`# Title` + one paragraph → title', async () => {
    expect((await at('# Title\n\nA paragraph.')).layout).toBe('title');
  });

  it('`# Part two` as slide 3 → section, data-section 01', async () => {
    const s = await at('# Part two', 3);
    expect(s.layout).toBe('section');
    expect(s.attrs['data-section']).toBe('01');
  });

  it('`## Heading` + list → default', async () => {
    expect((await at('## Heading\n\n- a\n- b')).layout).toBe('default');
  });

  it('`# Heading` + list → default', async () => {
    expect((await at('# Heading\n\n- a\n- b')).layout).toBe('default');
  });

  it('`## Heading` alone → default', async () => {
    expect((await at('## Heading')).layout).toBe('default');
  });

  it('one 60-character paragraph → statement, data-len m', async () => {
    const s = await at(P60);
    expect(s.layout).toBe('statement');
    expect(s.attrs['data-len']).toBe('m');
  });

  it('`73%` + one paragraph → statement, data-len xs', async () => {
    const s = await at('73%\n\nof teams ship faster with fewer features');
    expect(s.layout).toBe('statement');
    expect(s.attrs['data-len']).toBe('xs');
  });

  it('one 300-character paragraph → default', async () => {
    expect((await at(P300 + 'x')).layout).toBe('default');
  });

  it('blockquote only → quote', async () => {
    expect((await at('> Less, but better.\n>\n> — Dieter Rams')).layout).toBe('quote');
  });

  it('one image → image', async () => {
    const s = await at('![A plate](media/a.svg)');
    expect(s.layout).toBe('image');
    expect(s.attrs['data-imgfit']).toBe('cover');
  });

  it('`## H` + one image → figure', async () => {
    const s = await at('## H\n\n![A plate](media/a.svg)');
    expect(s.layout).toBe('figure');
    expect(s.attrs['data-imgfit']).toBe('contain');
  });

  it('image, then `## H`, then a paragraph → split, data-image left', async () => {
    const s = await at('![A plate](media/a.svg)\n\n## H\n\nText.');
    expect(s.layout).toBe('split');
    expect(s.attrs['data-image']).toBe('left');
    expect(s.attrs['data-imgfit']).toBe('cover');
  });

  it('`## H`, paragraph, image → split, data-image right', async () => {
    const s = await at('## H\n\nText.\n\n![A plate](media/a.svg)');
    expect(s.layout).toBe('split');
    expect(s.attrs['data-image']).toBe('right');
  });

  it('same, with `<!-- image: left -->` → split, data-image left', async () => {
    const s = await at('<!-- image: left -->\n\n## H\n\nText.\n\n![A plate](media/a.svg)');
    expect(s.layout).toBe('split');
    expect(s.attrs['data-image']).toBe('left');
  });

  it('three images → gallery, data-count 3', async () => {
    const s = await at('![a](a.svg)\n![b](b.svg)\n\n![c](c.svg)');
    expect(s.layout).toBe('gallery');
    expect(s.attrs['data-count']).toBe('3');
  });

  it('`## H` + three `###` groups → columns, data-count 3', async () => {
    const s = await at('## H\n\n### A\n\nOne.\n\n### B\n\nTwo.\n\n### C\n\nThree.');
    expect(s.layout).toBe('columns');
    expect(s.attrs['data-count']).toBe('3');
  });

  it('`## H`, text, `|||`, text → columns, data-count 2', async () => {
    const s = await at('## H\n\nLeft text.\n\n|||\n\nRight text.');
    expect(s.layout).toBe('columns');
    expect(s.attrs['data-count']).toBe('2');
  });

  it('`## H` + two images + a paragraph → default', async () => {
    expect((await at('## H\n\n![a](a.svg) ![b](b.svg)\n\nText.')).layout).toBe('default');
    expect((await at('## H\n\n![a](a.svg)\n\n![b](b.svg)\n\nText.')).layout).toBe('default');
  });

  it('`###### Label` + `# Title` + paragraph → title, eyebrow inside the head', async () => {
    const s = await at('###### Label\n\n# Title\n\nA paragraph.');
    expect(s.layout).toBe('title');
    expect(s.html).toMatch(/^<div class="s-main"><header class="s-head"><h6>Label<\/h6><h1>Title<\/h1><\/header>/);
  });

  it('`<!-- layout: full -->` + raw HTML → full', async () => {
    const s = await at('<!-- layout: full -->\n\n<iframe src="https://example.com"></iframe>');
    expect(s.layout).toBe('full');
  });
});

describe('layout details', () => {
  it('an empty slide is default and warns', async () => {
    const deck = await compileDeck('# A\n\n---\n\n<!-- only a note -->', { slug: 'layout' });
    expect(deck.slides[1]!.layout).toBe('default');
    expect(deck.warnings).toEqual([{ slide: 1, line: 5, message: 'empty slide' }]);
  });

  it('a 200-character statement is the limit', async () => {
    expect((await at('x'.repeat(200))).layout).toBe('statement');
    expect((await at('x'.repeat(201))).layout).toBe('default');
  });

  it('data-len boundaries', async () => {
    expect((await at('x'.repeat(8))).attrs['data-len']).toBe('xs');
    expect((await at('x'.repeat(9))).attrs['data-len']).toBe('s');
    expect((await at('x'.repeat(40))).attrs['data-len']).toBe('s');
    expect((await at('x'.repeat(41))).attrs['data-len']).toBe('m');
    expect((await at('x'.repeat(101))).attrs['data-len']).toBe('l');
  });

  it('a layout directive overrides inference', async () => {
    expect((await at('<!-- layout: statement -->\n\n## H\n\nText.')).layout).toBe('statement');
  });

  it('`# H` alone on slide 1 via directive stays as set', async () => {
    expect((await at('<!-- layout: section -->\n\n# H', 1)).layout).toBe('section');
  });

  it('numbers section slides in order', async () => {
    const deck = await compileDeck('# Deck\n\n---\n\n# One\n\n---\n\n## x\n\n- y\n\n---\n\n# Two', { slug: 'layout' });
    expect(deck.slides.map((s) => s.attrs['data-section'])).toEqual([undefined, '01', undefined, '02']);
  });

  it('columns need the first ### headings to come after at most one h1/h2', async () => {
    expect((await at('Intro.\n\n### A\n\nOne.\n\n### B\n\nTwo.')).layout).toBe('columns');
    expect((await at('## H\n\n## I\n\n### A\n\nOne.\n\n### B\n\nTwo.')).layout).toBe('default');
    expect((await at('## H\n\n### A\n\nOne.\n\n## J\n\n### B\n\nTwo.')).layout).toBe('default');
    expect((await at('## H\n\n### A\n\n#### a\n\n### B\n\nTwo.')).layout).toBe('columns');
  });

  it('fit, align and bg become attributes', async () => {
    const s = await at('<!-- fit: contain, align: center, bg: rgb(10, 20, 30) -->\n\n## H\n\nText.\n\n![a](a.svg)');
    expect(s.attrs).toEqual({
      'data-image': 'right',
      'data-imgfit': 'contain',
      'data-align': 'center',
      style: 'background: rgb(10, 20, 30)',
    });
    const bg = await at('<!-- bg: media/back.jpg -->\n\n## H');
    expect(bg.attrs).toEqual({ 'data-bg': 'image', style: '--slide-bg: url("decks/layout/media/back.jpg")' });
    expect(bg.options.bg).toBe('decks/layout/media/back.jpg');
  });
});
