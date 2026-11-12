import { createCssVariablesTheme, createHighlighter, type Highlighter } from 'shiki';
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import { transformerMetaHighlight } from '@shikijs/transformers';

export const LANGS = [
  'ts', 'js', 'tsx', 'jsx', 'json', 'html', 'css', 'bash',
  'python', 'rust', 'swift', 'sql', 'yaml', 'markdown', 'diff',
] as const;

const theme = createCssVariablesTheme({ name: 'dex', variablePrefix: '--shiki-', fontStyle: true });

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
