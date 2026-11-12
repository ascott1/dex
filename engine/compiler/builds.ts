import { toString } from 'mdast-util-to-string';
import { hProps, region, type MdBlock, type MdList, type MdRoot } from './ast.ts';

export interface Markers {
  /** For each pause marker, the number of remaining root blocks before it. */
  pauses: number[];
  /** For each `|||` column break, the number of remaining root blocks before it. */
  breaks: number[];
}

/** Remove root-level `. . .` and `|||` paragraphs, remembering where they were. */
export function extractMarkers(root: MdRoot): Markers {
  const markers: Markers = { pauses: [], breaks: [] };
  const kept: MdBlock[] = [];
  for (const node of root.children) {
    if (node.type === 'paragraph') {
      const t = toString(node).trim();
      if (t === '. . .') { markers.pauses.push(kept.length); continue; }
      if (t === '|||') { markers.breaks.push(kept.length); continue; }
    }
    kept.push(node);
  }
  root.children = kept;
  return markers;
}

/** The bullet character of a list, read from the source (mdast does not store it). */
export function bulletOf(list: MdList, source: string): string {
  const offset = list.children[0]?.position?.start.offset;
  return offset === undefined ? '' : source.charAt(offset);
}

export interface BuildOptions {
  /** The slide's `build` directive, if any. */
  slideBuild: boolean | undefined;
  /** The deck's frontmatter `build`. */
  deckBuild: boolean;
  /** The chunk text the tree was parsed from (for bullet characters). */
  source: string;
}

function setStep(node: { data?: unknown }, step: number) {
  hProps(node)['data-step'] = step;
}

/**
 * Number build steps by setting `data-step` on root blocks and on the items
 * of building lists. Returns the slide's step count.
 *
 * A pause takes effect at the next block that needs a step, so a building
 * list directly after a pause reveals its first item on the pause's step, and
 * a trailing pause adds no empty step (see PLAN.md §11).
 */
export function applyBuilds(root: MdRoot, pauses: number[], opts: BuildOptions): number {
  let counter = 0;
  let pending = false;
  let pauseSeen = false;
  const pauseSet = new Set(pauses);

  root.children = root.children.map((node, i) => {
    if (pauseSet.has(i)) { pending = true; pauseSeen = true; }
    if (node.type === 'definition' || node.type === 'footnoteDefinition') return node;

    const builds =
      node.type === 'list' &&
      (opts.slideBuild ?? (opts.deckBuild || bulletOf(node, opts.source) === '+'));

    if (builds) {
      const list = node as MdList;
      list.children.forEach((item, j) => {
        if (j === 0 && pending) {
          counter++;
          pending = false;
          setStep(list, counter);
        } else {
          if (j === 0 && pauseSeen) setStep(list, counter);
          counter++;
        }
        setStep(item, counter);
      });
      return node;
    }

    if (pending) { counter++; pending = false; }
    if (!pauseSeen) return node;
    if (node.type === 'html') {
      // Raw HTML cannot carry properties; wrap it so the step has an element.
      const wrapper = region(null, [node]);
      setStep(wrapper, counter);
      return wrapper;
    }
    setStep(node, counter);
    return node;
  });

  return counter;
}
