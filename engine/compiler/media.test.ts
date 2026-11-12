import { describe, expect, it } from 'vitest';
import { compileDeck } from './index.ts';
import { rewriteUrl, type MediaContext } from './media.ts';

async function html(md: string) {
  const deck = await compileDeck(md, { slug: 'talk' });
  return { html: deck.slides[0]!.html, deck };
}

describe('media', () => {
  it('turns an image paragraph into a figure with a caption', async () => {
    const { html: h } = await html('## H\n\n![Desk](media/desk.jpg "Paper prototypes")');
    expect(h).toContain(
      '<figure class="media"><img src="decks/talk/media/desk.jpg" alt="Desk" draggable="false" decoding="async"><figcaption>Paper prototypes</figcaption></figure>',
    );
  });

  it('makes one figure per image when a paragraph has several', async () => {
    const { html: h } = await html('![a](a.png) ![b](b.png)\n![c](c.png)');
    expect(h.match(/<figure class="media">/g)).toHaveLength(3);
    expect(h).not.toContain('<p>');
  });

  it('marks inline images but keeps them in their paragraph', async () => {
    const { html: h } = await html('## H\n\nAn icon ![i](i.png) inline. More text here to keep it a paragraph.\n\n- x');
    expect(h).toContain('<p>An icon <img src="decks/talk/i.png" alt="i" draggable="false" decoding="async"> inline.');
  });

  it('turns a video path into a video with flags from the alt text', async () => {
    const { html: h } = await html('![Demo autoplay loop muted](media/clip.mp4 "The clip")');
    expect(h).toContain(
      '<figure class="media"><video src="decks/talk/media/clip.mp4" controls playsinline preload="metadata" data-autoplay="" loop muted aria-label="Demo"></video><figcaption>The clip</figcaption></figure>',
    );
    const { html: plain } = await html('![](media/clip.webm)');
    expect(plain).toContain('<video src="decks/talk/media/clip.webm" controls playsinline preload="metadata"></video>');
    expect(plain).not.toContain('autoplay');
    const { html: mov } = await html('![](media/CLIP.MOV)');
    expect(mov).toContain('<video');
  });

  it('rewrites each kind of URL correctly', () => {
    const ctx: MediaContext = { slug: 'talk', assets: new Set(), warnings: [] };
    expect(rewriteUrl('media/a.png', ctx)).toBe('decks/talk/media/a.png');
    expect(rewriteUrl('./media/b.png', ctx)).toBe('decks/talk/media/b.png');
    expect(rewriteUrl('media/c.svg#icon', ctx)).toBe('decks/talk/media/c.svg#icon');
    expect(rewriteUrl('https://example.com/a.png', ctx)).toBe('https://example.com/a.png');
    expect(rewriteUrl('http://example.com/a.png', ctx)).toBe('http://example.com/a.png');
    expect(rewriteUrl('data:image/png;base64,AAAA', ctx)).toBe('data:image/png;base64,AAAA');
    expect(rewriteUrl('//cdn.example.com/a.png', ctx)).toBe('//cdn.example.com/a.png');
    expect(rewriteUrl('/abs/a.png', ctx)).toBe('/abs/a.png');
    expect(rewriteUrl('#frag', ctx)).toBe('#frag');
    expect(rewriteUrl('mailto:x@example.com', ctx)).toBe('mailto:x@example.com');
    expect(rewriteUrl('../other/a.png', ctx)).toBe('../other/a.png');
    expect(ctx.warnings).toEqual(['path outside the deck folder: ../other/a.png']);
    expect([...ctx.assets]).toEqual(['media/a.png', 'media/b.png', 'media/c.svg']);
  });

  it('rewrites src on img, video, source and iframe in raw HTML, and file links', async () => {
    const { html: h } = await html(
      '<!-- layout: full -->\n\n<video><source src="media/v.webm"></video>\n\n<iframe src="embed/page.html"></iframe>\n\n<img src="media/raw.png">\n\n[Handout](files/handout.pdf) · [Next](other) · [Site](https://example.com) · [Top](#top)',
    );
    expect(h).toContain('<source src="decks/talk/media/v.webm">');
    expect(h).toContain('<iframe src="decks/talk/embed/page.html"></iframe>');
    expect(h).toContain('<img src="decks/talk/media/raw.png" draggable="false" decoding="async">');
    expect(h).toContain('<a href="decks/talk/files/handout.pdf">Handout</a>');
    expect(h).toContain('<a href="other">Next</a>');
    expect(h).toContain('<a href="https://example.com">Site</a>');
    expect(h).toContain('<a href="#top">Top</a>');
  });

  it('collects assets across the deck, decoded and de-duplicated', async () => {
    const { deck } = await html(
      '![a](media/a.png)\n\n---\n\n![b](<media/my photo.jpg>)\n\n---\n\n## H\n\n![a again](media/a.png) ![remote](https://example.com/x.png)\n\n---\n\n<!-- bg: media/back.svg -->\n\n# End\n\nText.',
    );
    expect(deck.assets).toEqual(['media/a.png', 'media/my photo.jpg', 'media/back.svg']);
    expect(deck.slides[1]!.html).toContain('src="decks/talk/media/my%20photo.jpg"');
  });

  it('warns on a path that leaves the deck folder', async () => {
    const { deck } = await html('## H\n\n![x](../x.png)');
    expect(deck.warnings).toEqual([{ slide: 0, line: 1, message: 'path outside the deck folder: ../x.png' }]);
  });
});
