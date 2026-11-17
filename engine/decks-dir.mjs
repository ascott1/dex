// Where the decks are. By default `decks/` in the project, where only the demo
// is in git. `DEX_DECKS` moves them anywhere: a folder of your own, a private
// repository, a synced drive. It is read from the environment, else from
// `.env.local` in the project (gitignored), so it can be set once per machine:
//
//   DEX_DECKS=~/Talks
//
// Used by the Vite plugin (dev server and build) and by `pnpm new` and `pnpm fonts`.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const DECKS_ENV = 'DEX_DECKS';
export const LOCAL_ENV_FILE = '.env.local';

/**
 * The decks folder as an absolute path. A relative value is taken from `root`
 * (the project), and a leading `~` is the home folder.
 */
export function decksDir(root = process.cwd(), env = process.env) {
  let value = env[DECKS_ENV]?.trim();
  if (!value) {
    const file = path.join(root, LOCAL_ENV_FILE);
    if (existsSync(file)) value = parseEnv(readFileSync(file, 'utf8'))[DECKS_ENV]?.trim();
  }
  if (!value) return path.join(root, 'decks');
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) value = path.join(homedir(), value.slice(1));
  return path.resolve(root, value);
}

/**
 * A path as a person would type it, with `/` separators: relative to the
 * project when it is inside it (`decks/talk`), from `~` when it is under the
 * home folder, absolute otherwise.
 */
export function showPath(file, root = process.cwd()) {
  const posix = (p) => p.split(path.sep).join('/');
  const within = (parent) => {
    const rel = path.relative(parent, file);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
  };
  const inProject = within(root);
  if (inProject) return posix(inProject);
  const inHome = within(homedir());
  if (inHome) return `~/${posix(inHome)}`;
  return posix(file);
}
