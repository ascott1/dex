import { describe, expect, it } from 'vitest';
import { compileDeck } from './index.ts';

async function slide(md: string, deck = '') {
  const d = await compileDeck(deck + md, { slug: 'builds' });
  return d.slides[d.slides.length - 1]!;
}

describe('builds', () => {
  it('builds a + list one item per step', async () => {
    const s = await slide('## H\n\n+ a\n+ b\n+ c');
    expect(s.steps).toBe(3);
    expect(s.html).toContain('<li data-step="1">a</li>');
    expect(s.html).toContain('<li data-step="2">b</li>');
    expect(s.html).toContain('<li data-step="3">c</li>');
    expect(s.html).toContain('<ul>');
    expect(s.html).not.toContain('<ul data-step');
  });

  it('does not build - or * lists', async () => {
    for (const bullet of ['-', '*']) {
      const s = await slide(`## H\n\n${bullet} a\n${bullet} b`);
      expect(s.steps).toBe(0);
      expect(s.html).not.toContain('data-step');
    }
  });

  it('builds every top-level list with deck build: true', async () => {
    const s = await slide('## H\n\n- a\n- b\n\n1. c\n2. d', '---\nbuild: true\n---\n');
    expect(s.steps).toBe(4);
    expect(s.html).toContain('<li data-step="4">d</li>');
  });

  it('slide build: true builds any bullet', async () => {
    const s = await slide('<!-- build: true -->\n\n- a\n- b');
    expect(s.steps).toBe(2);
  });

  it('slide build: false beats + bullets and deck build', async () => {
    const s = await slide('<!-- build: false -->\n\n+ a\n+ b', '---\nbuild: true\n---\n');
    expect(s.steps).toBe(0);
    expect(s.html).not.toContain('data-step');
  });

  it('a pause holds back everything after it', async () => {
    const s = await slide('## H\n\nOne\n\n. . .\n\nTwo\n\n> Three\n\n. . .\n\nFour');
    expect(s.steps).toBe(2);
    expect(s.html).toContain('<p>One</p>');
    expect(s.html).toContain('<p data-step="1">Two</p>');
    expect(s.html).toContain('<blockquote data-step="1">');
    expect(s.html).toContain('<p data-step="2">Four</p>');
    expect(s.html).not.toContain('. . .');
  });

  it('a pause directly under a line of text still works', async () => {
    const s = await slide('One\n. . .\nTwo');
    expect(s.steps).toBe(1);
    expect(s.html).toContain('<p data-step="1">Two</p>');
  });

  it('a pause followed by a + list reveals the first item on the pause step', async () => {
    const s = await slide('## H\n\nIntro\n\n. . .\n\n+ a\n+ b\n\nAfter');
    expect(s.steps).toBe(2);
    expect(s.html).toContain('<ul data-step="1">');
    expect(s.html).toContain('<li data-step="1">a</li>');
    expect(s.html).toContain('<li data-step="2">b</li>');
    // Blocks after a pause take the counter at their position.
    expect(s.html).toContain('<p data-step="2">After</p>');
  });

  it('a + list, then a pause, numbers on from the list', async () => {
    const s = await slide('+ a\n+ b\n\n. . .\n\nEnd');
    expect(s.steps).toBe(3);
    expect(s.html).toContain('<p data-step="3">End</p>');
  });

  it('a trailing pause adds no step', async () => {
    const s = await slide('## H\n\nText\n\n. . .');
    expect(s.steps).toBe(0);
  });

  it('nested items carry no step', async () => {
    const s = await slide('+ a\n  - a1\n  - a2\n+ b');
    expect(s.steps).toBe(2);
    expect(s.html).toContain('<li>a1</li>');
    expect(s.html).toContain('<li>a2</li>');
    expect(s.html.match(/data-step/g)).toHaveLength(2);
  });

  it('wraps raw HTML after a pause so it can carry its step', async () => {
    const s = await slide('Text\n\n. . .\n\n<div class="x">Later</div>');
    expect(s.html).toContain('<div data-step="1"><div class="x">Later</div></div>');
  });

  it('carries a pause step onto figures', async () => {
    const s = await slide('## H\n\nText\n\n. . .\n\n![a](a.png)');
    expect(s.html).toContain('<figure class="media" data-step="1">');
  });
});
