import { describe, expect, it } from 'vitest';
import { markdownParser } from './ast.ts';
import { extractComments, nearestDirective, splitSegments } from './comments.ts';
import { compileDeck } from './index.ts';

const parse = (md: string) => markdownParser().parse(md);

describe('comments', () => {
  it('reads a single directive and removes the comment', () => {
    const root = parse('<!-- layout: statement -->\n\nHello');
    const r = extractComments(root);
    expect(r.options).toEqual({ layout: 'statement' });
    expect(r.notes).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(root.children.map((n) => n.type)).toEqual(['paragraph']);
  });

  it('reads several pairs separated by commas', () => {
    const r = extractComments(parse('<!-- layout: split, invert: true, image: right, fit: contain -->'));
    expect(r.options).toEqual({ layout: 'split', invert: true, image: 'right', fit: 'contain' });
  });

  it('reads a multi-line directive', () => {
    const r = extractComments(parse('<!--\nid: intro\nskip: true\ntransition: none\nalign: center\nclass: wide dark\n-->'));
    expect(r.options).toEqual({ id: 'intro', skip: true, transition: 'none', align: 'center', class: 'wide dark' });
  });

  it('does not split on commas inside parentheses', () => {
    expect(splitSegments('bg: rgb(0, 0, 0), invert: true')).toEqual(['bg: rgb(0, 0, 0)', 'invert: true']);
  });

  it('warns on a bad value and ignores it', () => {
    const r = extractComments(parse('# Hi\n\n<!-- layout: sideways, invert: true -->'));
    expect(r.options).toEqual({ invert: true });
    expect(r.warnings).toEqual([{ line: 3, message: 'invalid value for directive "layout": "sideways"' }]);
    expect(r.notes).toEqual([]);
  });

  it('treats an unknown key as a note and warns', () => {
    const r = extractComments(parse('<!-- layuot: statement -->'));
    expect(r.options).toEqual({});
    expect(r.notes).toEqual(['layuot: statement']);
    expect(r.warnings).toEqual([{ line: 1, message: 'unknown directive "layuot" (did you mean "layout"?)' }]);
  });

  it('treats a plain comment as a note, without a warning', () => {
    const r = extractComments(parse('Text\n\n<!-- Pause here. Ask who has shipped something this week. -->'));
    expect(r.notes).toEqual(['Pause here. Ask who has shipped something this week.']);
    expect(r.warnings).toEqual([]);
  });

  it('leaves comments that are not whole root blocks alone', () => {
    const root = parse('Text <!-- inline --> more');
    const r = extractComments(root);
    expect(r.notes).toEqual([]);
    expect(root.children).toHaveLength(1);
  });

  it('joins two notes with a blank line and renders Markdown in notes', async () => {
    const deck = await compileDeck('# Hi\n\n<!-- First *note* -->\n\n<!--\n  - one\n  - two\n-->', { slug: 'c' });
    expect(deck.slides[0]!.notes).toBe('<p>First <em>note</em></p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
  });

  it('renders no raw HTML in notes', async () => {
    const deck = await compileDeck('# Hi\n\n<!-- Say <b>this</b> -->', { slug: 'c' });
    expect(deck.slides[0]!.notes).toBe('<p>Say this</p>');
  });

  it('has empty notes when there are none', async () => {
    const deck = await compileDeck('# Hi', { slug: 'c' });
    expect(deck.slides[0]!.notes).toBe('');
  });

  it('keeps a note that merely starts with a lowercase word and a colon, without a warning', () => {
    const r = extractComments(parse('Text\n\n<!-- todo: fix this before the talk -->'));
    expect(r.options).toEqual({});
    expect(r.notes).toEqual(['todo: fix this before the talk']);
    expect(r.warnings).toEqual([]);
  });

  it('warns when a real directive is mixed with an unknown key, and applies nothing', () => {
    const r = extractComments(parse('<!-- layout: split, colour: red -->'));
    expect(r.options).toEqual({});
    expect(r.notes).toEqual(['layout: split, colour: red']);
    expect(r.warnings).toEqual([
      { line: 1, message: 'unknown directive "colour"; the whole comment was kept as a note' },
    ]);
  });

  it('suggests the nearest directive only for near misses', () => {
    expect(nearestDirective('layuot')).toBe('layout');
    expect(nearestDirective('bild')).toBe('build');
    expect(nearestDirective('big')).toBe('bg');
    expect(nearestDirective('todo')).toBeNull();
    expect(nearestDirective('note')).toBeNull();
    expect(nearestDirective('remember')).toBeNull();
  });

  it('warns about a comment that is never closed and keeps its text as a note', () => {
    const root = parse('## A\n\nBody\n\n<!--\nline one');
    const r = extractComments(root);
    expect(r.notes).toEqual(['line one']);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.line).toBe(5);
    expect(r.warnings[0]!.message).toMatch(/never closed/);
    expect(root.children.some((n) => n.type === 'html')).toBe(false);
  });

  it('reports directive warnings with the deck.md line and slide index', async () => {
    const deck = await compileDeck('---\ntitle: T\n---\n# A\n\n---\n\n## B\n\n<!-- layuot: statement -->\n', { slug: 'c' });
    expect(deck.warnings).toEqual([{ slide: 1, line: 10, message: 'unknown directive "layuot" (did you mean "layout"?)' }]);
    expect(deck.slides[1]!.notes).toBe('<p>layuot: statement</p>');
  });
});
