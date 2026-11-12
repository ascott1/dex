import { parse as parseYaml, YAMLError } from 'yaml';
import type { DeckMeta } from '../../shared/types.ts';

/** Thrown only for frontmatter that is not valid YAML. */
export class DexCompileError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'DexCompileError';
    this.line = line;
  }
}

/** A warning whose `line` is 1-based in deck.md. */
export interface LineWarning { line: number; message: string }

/** Everything in `DeckMeta` except `title`, whose fallback needs the slides. */
export type MetaDefaults = Omit<DeckMeta, 'title'> & { title?: string };

export interface Frontmatter {
  meta: MetaDefaults;
  body: string;
  /** 1-based line in deck.md on which `body` starts. */
  bodyLine: number;
  warnings: LineWarning[];
}

const ENUMS = {
  theme: ['paper', 'ink'],
  aspect: ['16:9', '16:10', '4:3'],
  transition: ['fade', 'none'],
} as const;

const TEXT_KEYS = ['title', 'author', 'date', 'lang'] as const;

export function defaultMeta(): MetaDefaults {
  return { theme: 'paper', aspect: '16:9', build: false, transition: 'fade', lang: 'en' };
}

/** `source` must already have `\n` line endings. */
export function parseFrontmatter(source: string): Frontmatter {
  const meta = defaultMeta();
  const warnings: LineWarning[] = [];
  if (!source.startsWith('---\n')) return { meta, body: source, bodyLine: 1, warnings };

  const lines = source.split('\n');
  const close = lines.indexOf('---', 1);
  // No closing line: not frontmatter, so the leading `---` is just a slide break.
  if (close === -1) return { meta, body: source, bodyLine: 1, warnings };

  const yamlLines = lines.slice(1, close);
  const body = lines.slice(close + 1).join('\n');
  const bodyLine = close + 2;

  let data: unknown;
  try {
    data = parseYaml(yamlLines.join('\n'));
  } catch (err) {
    if (err instanceof YAMLError) {
      const yamlLine = err.linePos?.[0]?.line ?? 1;
      const first = (err.message.split('\n')[0] ?? 'invalid YAML').replace(/ at line \d+, column \d+:?$/, '');
      throw new DexCompileError(`Invalid frontmatter: ${first}`, yamlLine + 1);
    }
    throw err;
  }

  if (data === null || data === undefined) return { meta, body, bodyLine, warnings };

  if (typeof data !== 'object' || Array.isArray(data)) {
    warnings.push({ line: 2, message: 'frontmatter is not a key: value map; using defaults' });
    return { meta, body, bodyLine, warnings };
  }

  const lineOf = (key: string): number => {
    const re = new RegExp(`^\\s*["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`);
    const i = yamlLines.findIndex((l) => re.test(l));
    return i === -1 ? 2 : i + 2;
  };

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const bad = () =>
      warnings.push({ line: lineOf(key), message: `invalid frontmatter value for "${key}": ${JSON.stringify(value)}` });

    if ((TEXT_KEYS as readonly string[]).includes(key)) {
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        if (text) meta[key as (typeof TEXT_KEYS)[number]] = text;
        else bad();
      } else if (value instanceof Date) {
        meta[key as (typeof TEXT_KEYS)[number]] = value.toISOString().slice(0, 10);
      } else bad();
    } else if (key === 'build') {
      if (typeof value === 'boolean') meta.build = value;
      else bad();
    } else if (key in ENUMS) {
      const allowed = ENUMS[key as keyof typeof ENUMS] as readonly string[];
      if (typeof value === 'string' && allowed.includes(value)) {
        (meta as unknown as Record<string, unknown>)[key] = value;
      } else bad();
    } else {
      warnings.push({ line: lineOf(key), message: `unknown frontmatter key "${key}"` });
    }
  }

  return { meta, body, bodyLine, warnings };
}
