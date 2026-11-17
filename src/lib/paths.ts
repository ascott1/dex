// Where a deck's files are, for messages that tell the author which file to open.
// `__DEX_DECKS__` is set by the dex Vite plugin (engine/vite-plugin.ts): `decks`
// in a built site and by default, or the folder DEX_DECKS names while editing,
// such as `~/Talks`.

declare const __DEX_DECKS__: string | undefined;

const DECKS = typeof __DEX_DECKS__ === 'string' ? __DEX_DECKS__ : 'decks';

/** `decks/talk/deck.md` */
export function deckFile(slug: string): string {
  return `${DECKS}/${slug}/deck.md`;
}
