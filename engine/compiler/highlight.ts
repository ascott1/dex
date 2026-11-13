import { createCssVariablesTheme, createHighlighter, type Highlighter } from 'shiki';
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import { transformerMetaHighlight } from '@shikijs/transformers';

export const LANGS = [
  'ts', 'js', 'tsx', 'jsx', 'json', 'html', 'css', 'bash',
  'python', 'rust', 'swift', 'sql', 'yaml', 'markdown', 'diff',
] as const;

const base = createCssVariablesTheme({ name: 'dex', variablePrefix: '--shiki-', fontStyle: true });

// The css-variables theme gives variables, object names, and built-in types
// (`variable.other.*`, `support.*`) the same colour as literals, so a typical
// TypeScript block was mostly orange. Here names are plain ink and the
// constant colour is left to numbers, `true`/`null`/`this`, and the like.
// Appended last, so these win over the base rules for the same scopes.
const theme = {
  ...base,
  tokenColors: [
    ...(base.tokenColors ?? []),
    {
      scope: [
        'variable.other.object',
        'variable.other.class',
        'variable.other.constant',
        'support.type',
        'support.class',
        'support.variable',
      ],
      settings: { foreground: 'var(--shiki-foreground)' },
    },
  ],
};

let highlighter: Promise<Highlighter> | null = null;

/** One highlighter for the process, created on first use. */
export function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: [theme], langs: [...LANGS] });
  return highlighter;
}

/** Whether `lang` (a fence's info word) is highlighted rather than falling back to plain text. */
export function isKnownLang(hl: Highlighter, lang: string): boolean {
  const l = lang.toLowerCase();
  if (l === 'text' || l === 'txt' || l === 'plain' || l === 'plaintext') return true;
  return hl.getLoadedLanguages().includes(l);
}

export const shikiPlugin = rehypeShikiFromHighlighter;

export function shikiOptions() {
  return {
    theme: 'dex',
    transformers: [transformerMetaHighlight()],
    defaultLanguage: 'text',
    fallbackLanguage: 'text',
  };
}
