import { describe, expect, it } from 'vitest';
import { compileDeck } from './index.ts';

async function first(md: string) {
  const deck = await compileDeck(md, { slug: 'hl' });
  return { slide: deck.slides[0]!, deck };
}

describe('highlight', () => {
  it('highlights with CSS variables and marks lines from {2,4-5}', async () => {
    const { slide } = await first('```ts {2,4-5}\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\n```');
    expect(slide.html).toContain('<pre class="shiki dex"');
    expect(slide.html).toContain('var(--shiki-token-keyword)');
    const lines = [...slide.html.matchAll(/<span class="(line[^"]*)">/g)].map((m) => m[1]);
    expect(lines).toEqual(['line', 'line highlighted', 'line', 'line highlighted', 'line highlighted']);
    expect(slide.html).not.toContain('metastring');
  });

  it('renders a fence without a language as plain text through Shiki', async () => {
    const { slide, deck } = await first('```\nplain --- text\n```');
    expect(slide.html).toContain('<pre class="shiki dex"');
    expect(slide.html).toContain('plain --- text');
    expect(deck.warnings).toEqual([]);
  });

  it('accepts language aliases', async () => {
    const { deck } = await first('```sh\nls\n```\n\n```yml\na: 1\n```');
    expect(deck.warnings).toEqual([]);
  });

  it('falls back to plain text for an unknown language and warns', async () => {
    const { slide, deck } = await first('## Code\n\n```brainfudge\n+++\n```');
    expect(slide.html).toContain('<pre class="shiki dex"');
    expect(deck.warnings).toEqual([{ slide: 0, line: 3, message: 'unknown code language "brainfudge"; shown as plain text' }]);
  });
});
