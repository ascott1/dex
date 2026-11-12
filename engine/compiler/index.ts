import { createHash } from 'node:crypto';
import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { CompileWarning, Deck, DeckMeta, LayoutName, Slide, SlideOptions } from '../../shared/types.ts';
import { hProps, markdownParser, type HRoot, type MdRoot } from './ast.ts';
import { applyBuilds, extractMarkers } from './builds.ts';
import { extractComments, isImagePath } from './comments.ts';
import { parseFrontmatter, type LineWarning } from './frontmatter.ts';
import { getHighlighter, isKnownLang, shikiOptions, shikiPlugin } from './highlight.ts';
import { analyze, computeAttrs, inferLayout } from './layout.ts';
import { rehypeMedia, rewriteUrl, type MediaContext } from './media.ts';
import { applyRegions } from './regions.ts';
import { isolateMarkers, splitSlides } from './split.ts';

export { DexCompileError } from './frontmatter.ts';

/** The cached result of compiling one chunk. Position-dependent fields are filled in later. */
export interface CompiledChunk {
  layout: LayoutName;
  /** True when the layout was inferred rather than set by a directive. */
  inferred: boolean;
  title: string | null;
  html: string;
  attrs: Record<string, string>;
  notes: string;
  steps: number;
  options: SlideOptions;
  assets: string[];
  /** `line` is 1-based within the chunk. */
  warnings: LineWarning[];
}

/** Counts real (uncached) chunk compiles. Tests read this. */
export const compileStats = { chunks: 0 };

const CACHE_LIMIT = 5000;
const cache = new Map<string, CompiledChunk>();

export function clearCompileCache(): void {
  cache.clear();
}

export function chunkHash(text: string, slug: string, deckBuild: boolean): string {
  return createHash('sha1').update(`${text}\0${slug}\0${deckBuild}`).digest('hex').slice(0, 10);
}

function slideTitle(root: MdRoot): string | null {
  const blocks = root.children.filter((n) => !['definition', 'footnoteDefinition', 'html'].includes(n.type));
  const heading = blocks.find((n) => n.type === 'heading' && n.depth <= 3);
  if (heading) {
    const t = toString(heading).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  const text = blocks.map((b) => toString(b)).join(' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 60).trim() : null;
}

async function renderNotes(notes: string[]): Promise<string> {
  if (notes.length === 0) return '';
  // No raw HTML in notes: remark-rehype drops `html` nodes by default.
  const file = await markdownParser().use(remarkRehype).use(rehypeStringify).process(notes.join('\n\n'));
  return String(file).trim();
}

/** Compile one slide chunk. Pure apart from the shared highlighter. */
export async function compileChunk(text: string, slug: string, deckBuild: boolean, hash: string): Promise<CompiledChunk> {
  compileStats.chunks++;
  const hl = await getHighlighter();
  const iso = isolateMarkers(text);
  const root = markdownParser().parse(iso.text);
  const warnings: LineWarning[] = [];
  const mapLine = (line: number) => iso.lineMap[line - 1] ?? line;

  // Comments: directives and speaker notes.
  const comments = extractComments(root);
  const options = comments.options;
  for (const w of comments.warnings) warnings.push({ line: mapLine(w.line), message: w.message });

  // Unknown code languages fall back to plain text; say so.
  visit(root, 'code', (node) => {
    // rehype-raw drops `data`, where remark-rehype puts the meta string; Shiki
    // also reads it from the `metastring` property, which survives.
    if (node.meta) hProps(node).metastring = node.meta;
    if (node.lang && !isKnownLang(hl, node.lang)) {
      warnings.push({ line: mapLine(node.position?.start.line ?? 1), message: `unknown code language "${node.lang}"; shown as plain text` });
    }
  });

  const markers = extractMarkers(root);
  const steps = applyBuilds(root, markers.pauses, { slideBuild: options.build, deckBuild, source: iso.text });

  const analysis = analyze(root.children);
  if (analysis.blocks.length === 0 && !analysis.eyebrow) warnings.push({ line: 1, message: 'empty slide' });
  const inferred = options.layout === undefined;
  const layout = options.layout ?? inferLayout(analysis, { breaks: markers.breaks.length, first: false });
  const title = slideTitle(root);

  const media: MediaContext = { slug, assets: new Set(), warnings: [] };
  const count = applyRegions(root, layout, markers.breaks);
  const attrs = computeAttrs(layout, analysis, options, count);

  if (options.bg !== undefined) {
    if (isImagePath(options.bg)) {
      options.bg = rewriteUrl(options.bg, media);
      attrs['data-bg'] = 'image';
      attrs['style'] = `--slide-bg: url("${options.bg.replace(/["\\]/g, '\\$&')}")`;
    } else {
      attrs['style'] = `background: ${options.bg}`;
    }
  }

  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: `fn-${hash}-` })
    .use(rehypeRaw)
    .use(() => rehypeMedia(media) as unknown as (tree: HRoot) => void)
    .use(shikiPlugin, hl, shikiOptions())
    .use(rehypeStringify);
  const hast = await processor.run(root);
  const html = processor.stringify(hast);

  for (const message of media.warnings) warnings.push({ line: 1, message });

  return {
    layout,
    inferred,
    title,
    html,
    attrs,
    notes: await renderNotes(comments.notes),
    steps,
    options,
    assets: [...media.assets],
    warnings,
  };
}

export interface CompileOptions { slug: string }

/** Compile a deck's Markdown into the `Deck` JSON of PLAN.md §5. Reads no files. */
export async function compileDeck(source: string, opts: CompileOptions): Promise<Deck> {
  const { slug } = opts;
  const normalized = source.replace(/\r\n?/g, '\n');
  const fm = parseFrontmatter(normalized);
  const chunks = splitSlides(fm.body, fm.bodyLine);

  const warnings: CompileWarning[] = fm.warnings.map((w) => ({ slide: -1, line: w.line, message: w.message }));
  const assets = new Set<string>();
  const slugger = new GithubSlugger();
  const slides: Slide[] = [];
  let sections = 0;

  for (const [index, chunk] of chunks.entries()) {
    const hash = chunkHash(chunk.text, slug, fm.meta.build);
    let compiled = cache.get(hash);
    if (!compiled) {
      compiled = await compileChunk(chunk.text, slug, fm.meta.build, hash);
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(hash, compiled);
    }

    // A `#`-alone slide is a section divider, except as the first slide.
    let layout = compiled.layout;
    if (compiled.inferred && layout === 'section' && index === 0) layout = 'title';

    const attrs = { ...compiled.attrs };
    if (layout === 'section') attrs['data-section'] = String(++sections).padStart(2, '0');

    const options = { ...compiled.options };
    let id = '';
    if (options.id) id = slugger.slug(options.id);
    if (!id && compiled.title) id = slugger.slug(compiled.title);
    if (!id) id = slugger.slug(`slide-${index + 1}`);

    for (const a of compiled.assets) assets.add(a);
    for (const w of compiled.warnings) {
      warnings.push({ slide: index, line: chunk.line + w.line - 1, message: w.message });
    }

    slides.push({
      id,
      index,
      title: compiled.title,
      layout,
      html: compiled.html,
      attrs,
      notes: compiled.notes,
      steps: compiled.steps,
      options,
      source: chunk.text,
      line: chunk.line,
      hash,
    });
  }

  const meta: DeckMeta = {
    title: fm.meta.title ?? slides[0]?.title ?? slug,
    ...(fm.meta.author !== undefined && { author: fm.meta.author }),
    ...(fm.meta.date !== undefined && { date: fm.meta.date }),
    theme: fm.meta.theme,
    aspect: fm.meta.aspect,
    build: fm.meta.build,
    transition: fm.meta.transition,
    lang: fm.meta.lang,
  };

  return { slug, meta, slides, assets: [...assets], warnings };
}
