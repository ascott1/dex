import { posix } from 'node:path';
import type { HElement, HNode, HParent, HRoot } from './ast.ts';

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/|#)/i;
const VIDEO_FLAGS = ['autoplay', 'loop', 'muted'] as const;

export interface MediaContext {
  slug: string;
  /** Deck-relative paths referenced by the slide; filled in by the plugin. */
  assets: Set<string>;
  /** Problems found, by message. */
  warnings: string[];
}

function splitSuffix(url: string): [path: string, suffix: string] {
  const i = url.search(/[?#]/);
  return i === -1 ? [url, ''] : [url.slice(0, i), url.slice(i)];
}

function decode(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * Rewrite a deck-relative URL to `decks/<slug>/<path>` and record it as an
 * asset. URLs with a scheme, or starting with `//`, `/`, or `#`, are returned
 * unchanged (`//` is covered by `/`).
 */
export function rewriteUrl(url: string, ctx: MediaContext): string {
  const trimmed = url.trim();
  if (trimmed === '' || ABSOLUTE.test(trimmed)) return url;
  const [path, suffix] = splitSuffix(trimmed);
  if (path === '') return url;
  const normal = posix.normalize(path);
  if (normal === '..' || normal.startsWith('../')) {
    ctx.warnings.push(`path outside the deck folder: ${url}`);
    return url;
  }
  ctx.assets.add(decode(normal));
  return `decks/${ctx.slug}/${normal}${suffix}`;
}

/** Whether a relative link target looks like a file (its last segment has an extension). */
function pointsToFile(href: string): boolean {
  const [path] = splitSuffix(href);
  const last = path.split('/').pop() ?? '';
  return /\.[a-z0-9]+$/i.test(last);
}

function isWhitespace(node: HNode): boolean {
  return node.type === 'text' && node.value.trim() === '';
}

function el(tagName: string, properties: Record<string, unknown>, children: HNode[] = []): HElement {
  return { type: 'element', tagName, properties, children };
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** An `<img>` becomes a `<video>` when its source is a video file. */
function convertImage(img: HElement): HElement {
  const src = str(img.properties.src);
  if (!VIDEO_EXT.test(splitSuffix(src)[0])) {
    img.properties.draggable = 'false';
    img.properties.decoding = 'async';
    return img;
  }
  const alt = str(img.properties.alt);
  const words = alt.split(/\s+/).filter(Boolean);
  const flags = new Set(words.map((w) => w.toLowerCase()).filter((w) => (VIDEO_FLAGS as readonly string[]).includes(w)));
  const label = words.filter((w) => !(VIDEO_FLAGS as readonly string[]).includes(w.toLowerCase())).join(' ');
  const props: Record<string, unknown> = { src, controls: true, playsInline: true, preload: 'metadata' };
  if (flags.has('autoplay')) props.dataAutoplay = '';
  if (flags.has('loop')) props.loop = true;
  if (flags.has('muted')) props.muted = true;
  if (label) props.ariaLabel = label;
  return el('video', props);
}

function figureFor(img: HElement, step: unknown): HElement {
  const title = str(img.properties.title);
  delete img.properties.title;
  const media = convertImage(img);
  const props: Record<string, unknown> = { className: ['media'] };
  if (step !== undefined) props.dataStep = step;
  const children: HNode[] = [media];
  if (title) children.push(el('figcaption', {}, [{ type: 'text', value: title }]));
  return el('figure', props, children);
}

function walk(parent: HParent, ctx: MediaContext): void {
  const next: HNode[] = [];
  for (const node of parent.children) {
    if (node.type !== 'element') {
      next.push(node);
      continue;
    }
    // A <p> of only images becomes one <figure> per image.
    if (
      node.tagName === 'p' &&
      node.children.some((c) => c.type === 'element' && c.tagName === 'img') &&
      node.children.every((c) => isWhitespace(c) || (c.type === 'element' && (c.tagName === 'img' || c.tagName === 'br')))
    ) {
      for (const c of node.children) {
        if (c.type === 'element' && c.tagName === 'img') {
          rewriteProps(c, ctx);
          next.push(figureFor(c, node.properties.dataStep ?? node.properties['data-step']));
        }
      }
      continue;
    }
    rewriteProps(node, ctx);
    walk(node, ctx);
    next.push(node.tagName === 'img' ? convertImage(node) : node);
  }
  parent.children = next;
}

function rewriteProps(node: HElement, ctx: MediaContext): void {
  const p = node.properties;
  if (['img', 'video', 'source', 'iframe'].includes(node.tagName) && typeof p.src === 'string') {
    p.src = rewriteUrl(p.src, ctx);
  }
  if (node.tagName === 'a' && typeof p.href === 'string' && !ABSOLUTE.test(p.href.trim()) && pointsToFile(p.href)) {
    p.href = rewriteUrl(p.href, ctx);
  }
}

/** The rehype plugin: figures, video, and URL rewriting (PLAN.md §6). */
export function rehypeMedia(ctx: MediaContext) {
  return (tree: HRoot) => {
    walk(tree, ctx);
  };
}
