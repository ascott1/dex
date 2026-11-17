import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decksDir, showPath } from './decks-dir.mjs';

describe('decksDir', () => {
  let root = '';
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });
  const project = (envLocal?: string) => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dex-dir-')));
    if (envLocal !== undefined) writeFileSync(path.join(root, '.env.local'), envLocal);
    return root;
  };

  it('is decks/ in the project when nothing is set', () => {
    expect(decksDir(project(), {})).toBe(path.join(root, 'decks'));
    expect(decksDir(project('# nothing here\nOTHER=1\n'), {})).toBe(path.join(root, 'decks'));
    expect(decksDir(project('DEX_DECKS=\n'), { DEX_DECKS: '  ' })).toBe(path.join(root, 'decks'));
  });

  it('reads DEX_DECKS from .env.local: absolute, relative to the project, or from ~', () => {
    expect(decksDir(project('DEX_DECKS=/srv/talks\n'), {})).toBe(path.resolve('/srv/talks'));
    expect(decksDir(project('DEX_DECKS="../my talks"\n'), {})).toBe(path.resolve(root, '..', 'my talks'));
    expect(decksDir(project('# mine\nDEX_DECKS=~/Talks\nOTHER=1\n'), {})).toBe(path.join(homedir(), 'Talks'));
    expect(decksDir(project('DEX_DECKS=~\n'), {})).toBe(homedir());
  });

  it('prefers the environment to the file', () => {
    expect(decksDir(project('DEX_DECKS=/srv/talks\n'), { DEX_DECKS: 'elsewhere' })).toBe(path.join(root, 'elsewhere'));
  });
});

describe('showPath', () => {
  it('is relative inside the project, from ~ under the home folder, absolute otherwise', () => {
    const root = path.join(homedir(), 'Projects', 'dex');
    expect(showPath(path.join(root, 'decks', 'talk', 'deck.md'), root)).toBe('decks/talk/deck.md');
    expect(showPath(path.join(homedir(), 'Talks', 'talk'), root)).toBe('~/Talks/talk');
    expect(showPath(path.resolve('/srv/talks/talk'), root)).toBe(path.resolve('/srv/talks/talk').split(path.sep).join('/'));
  });
});
