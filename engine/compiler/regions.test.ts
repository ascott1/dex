import { describe, expect, it } from 'vitest';
import type { Slide } from '../../shared/types.ts';
import { compileDeck } from './index.ts';

async function second(md: string): Promise<Slide> {
  const deck = await compileDeck(`# First\n\n---\n\n${md}`, { slug: 'r' });
  return deck.slides[1]!;
}

/** The element skeleton of slide HTML: tags with their classes, no text. */
function shape(html: string): string {
  return html
    .replace(/\n/g, '')
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/g, (_m, close: string, tag: string, attrs: string) => {
      const cls = /class="([^"]*)"/.exec(attrs);
      return `<${close}${tag}${!close && cls ? '.' + cls[1]!.split(' ').join('.') : ''}>`;
    })
    .replace(/>[^<]+</g, '><')
    .replace(/^[^<]+|[^>]+$/g, '');
}

describe('regions (HTML contract)', () => {
  it('default: head and body', async () => {
    const s = await second('## Title\n\nText.\n\n- a');
    expect(s.layout).toBe('default');
    expect(shape(s.html)).toBe(
      '<div.s-main><header.s-head><h2></h2></header><div.s-body><p></p><ul><li></li></ul></div></div>',
    );
  });

  it('default: no head when there is no h1/h2, and the first h1/h2 is hoisted', async () => {
    expect(shape((await second('### Sub\n\n' + 'Long text. '.repeat(30))).html)).toBe(
      '<div.s-main><div.s-body><h3></h3><p></p></div></div>',
    );
  });

  it('title: eyebrow and heading in the head, lede in the body', async () => {
    const s = await second('###### Eyebrow\n\n# Title\n\nLede.');
    expect(s.layout).toBe('title');
    expect(shape(s.html)).toBe('<div.s-main><header.s-head><h6></h6><h1></h1></header><div.s-body><p></p></div></div>');
  });

  it('section: head only, body omitted', async () => {
    const s = await second('# Part');
    expect(s.layout).toBe('section');
    expect(shape(s.html)).toBe('<div.s-main><header.s-head><h1></h1></header></div>');
  });

  it('statement: body only, head omitted', async () => {
    const s = await second('Short.\n\nLabel.');
    expect(s.layout).toBe('statement');
    expect(shape(s.html)).toBe('<div.s-main><div.s-body><p></p><p></p></div></div>');
  });

  it('quote: body with the attribution marked and its dashes removed', async () => {
    const s = await second('> Less, but better.\n>\n> — Dieter Rams');
    expect(s.layout).toBe('quote');
    expect(shape(s.html)).toBe('<div.s-main><div.s-body><blockquote><p></p><p.attrib></p></blockquote></div></div>');
    expect(s.html).toContain('<p class="attrib">Dieter Rams</p>');
  });

  it('quote: an attribution on the last line of the same paragraph, with --', async () => {
    const s = await second('> Less, but better.\n> -- *Dieter* Rams');
    expect(s.html).toContain('<p>Less, but better.</p>');
    expect(s.html).toContain('<p class="attrib"><em>Dieter</em> Rams</p>');
  });

  it('quote: no attribution when the last line has no dash', async () => {
    const s = await second('> Less, but better.\n> Dieter Rams');
    expect(s.html).not.toContain('attrib');
  });

  it('columns from ###: head, lede, cols', async () => {
    const s = await second('## H\n\nLede.\n\n### A\n\nOne.\n\n### B\n\n- two');
    expect(s.layout).toBe('columns');
    expect(shape(s.html)).toBe(
      '<div.s-main><header.s-head><h2></h2></header><div.s-lede><p></p></div>' +
        '<div.s-cols><section.s-col><h3></h3><p></p></section><section.s-col><h3></h3><ul><li></li></ul></section></div></div>',
    );
  });

  it('columns from |||: no lede, one column per segment', async () => {
    const s = await second('## H\n\nOne.\n\n|||\n\nTwo.\n\n|||\n\nThree.');
    expect(s.attrs['data-count']).toBe('3');
    expect(shape(s.html)).toBe(
      '<div.s-main><header.s-head><h2></h2></header><div.s-cols>' +
        '<section.s-col><p></p></section><section.s-col><p></p></section><section.s-col><p></p></section></div></div>',
    );
    expect(s.html).not.toContain('|||');
  });

  it('columns from ||| written directly under text', async () => {
    const s = await second('## H\n\nOne.\n|||\nTwo.');
    expect(s.layout).toBe('columns');
    expect(s.attrs['data-count']).toBe('2');
  });

  it('split: head and body in main, the figure in media', async () => {
    const s = await second('## H\n\nText.\n\n![a](a.svg "Cap")');
    expect(shape(s.html)).toBe(
      '<div.s-main><header.s-head><h2></h2></header><div.s-body><p></p></div></div>' +
        '<div.s-media><figure.media><img><figcaption></figcaption></figure></div>',
    );
  });

  it('figure: head in main, figure in media', async () => {
    const s = await second('## H\n\n![a](a.svg)');
    expect(shape(s.html)).toBe('<div.s-main><header.s-head><h2></h2></header></div><div.s-media><figure.media><img></figure></div>');
  });

  it('gallery: optional head, all figures in media', async () => {
    const withHead = await second('## H\n\n![a](a.svg) ![b](b.svg)');
    expect(withHead.layout).toBe('gallery');
    expect(shape(withHead.html)).toBe(
      '<div.s-main><header.s-head><h2></h2></header></div><div.s-media><figure.media><img></figure><figure.media><img></figure></div>',
    );
    const bare = await second('![a](a.svg)\n\n![b](b.svg)');
    expect(shape(bare.html)).toBe('<div.s-media><figure.media><img></figure><figure.media><img></figure></div>');
  });

  it('image: no main, the figure in media', async () => {
    const s = await second('![a](a.svg)');
    expect(shape(s.html)).toBe('<div.s-media><figure.media><img></figure></div>');
  });

  it('full: every block directly in main', async () => {
    const s = await second('<!-- layout: full -->\n\n## H\n\n<iframe src="https://example.com/x"></iframe>');
    expect(shape(s.html)).toBe('<div.s-main><h2></h2><iframe></iframe></div>');
  });

  it('footnotes stay outside the regions, at the end', async () => {
    const s = await second('## H\n\nText.[^1]\n\n[^1]: Source.');
    expect(s.html).toMatch(/<\/div><\/div>\n<section data-footnotes="" class="footnotes">/);
  });
});
