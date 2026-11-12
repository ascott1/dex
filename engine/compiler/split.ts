export interface Chunk {
  /** The slide's Markdown, without leading and trailing blank lines. */
  text: string;
  /** 1-based line in deck.md of the chunk's first non-blank line. */
  line: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const SEPARATOR = /^---+\s*$/;

/**
 * Split the deck body into slide chunks, line by line (not by AST, so that
 * `---` under a line of text is still a slide break). `---` inside fenced code
 * is ignored. `bodyLine` is the deck.md line on which `body` starts.
 */
export function splitSlides(body: string, bodyLine = 1): Chunk[] {
  const lines = body.split('\n');
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentStart = bodyLine;
  let fence: { char: string; len: number } | null = null;

  const flush = () => {
    let first = 0;
    let last = current.length - 1;
    while (first <= last && current[first]!.trim() === '') first++;
    while (last >= first && current[last]!.trim() === '') last--;
    if (first <= last) {
      chunks.push({ text: current.slice(first, last + 1).join('\n'), line: currentStart + first });
    }
  };

  lines.forEach((line, i) => {
    if (fence) {
      const m = /^ {0,3}(`+|~+)\s*$/.exec(line);
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len) fence = null;
      current.push(line);
      return;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const run = open[1]!;
      // A backtick fence's info string may not contain backticks; then it is not a fence.
      const info = line.slice(line.indexOf(run) + run.length);
      if (!(run[0] === '`' && info.includes('`'))) fence = { char: run[0]!, len: run.length };
      current.push(line);
      return;
    }
    if (SEPARATOR.test(line)) {
      flush();
      current = [];
      currentStart = bodyLine + i + 1;
      return;
    }
    current.push(line);
  });
  flush();
  return chunks;
}

const MARKER_LINE = /^(\. \. \.|\|\|\|)\s*$/;

/**
 * Make sure every line that is only `. . .` or `|||` (outside fenced code) is
 * its own paragraph, by adding blank lines around it. Without this, a marker
 * written directly under a line of text would be swallowed into that
 * paragraph. `lineMap[i]` is the 1-based chunk line of output line `i + 1`.
 */
export function isolateMarkers(text: string): { text: string; lineMap: number[] } {
  const out: string[] = [];
  const lineMap: number[] = [];
  let fence: { char: string; len: number } | null = null;
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const n = i + 1;
    if (fence) {
      const m = /^ {0,3}(`+|~+)\s*$/.exec(line);
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len) fence = null;
    } else {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        const run = open[1]!;
        const info = line.slice(line.indexOf(run) + run.length);
        if (!(run[0] === '`' && info.includes('`'))) fence = { char: run[0]!, len: run.length };
      } else if (MARKER_LINE.test(line)) {
        if (out.length > 0 && out[out.length - 1]!.trim() !== '') {
          out.push('');
          lineMap.push(n);
        }
        out.push(line.trim());
        lineMap.push(n);
        if (i + 1 < lines.length && lines[i + 1]!.trim() !== '') {
          out.push('');
          lineMap.push(n);
        }
        return;
      }
    }
    out.push(line);
    lineMap.push(n);
  });
  return { text: out.join('\n'), lineMap };
}
