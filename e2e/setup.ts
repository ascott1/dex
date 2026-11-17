import { copyDemo, removeTempDecks } from './temp-deck.ts';

// Before any spec: the tests' decks folder holds the demo as it is now, and nothing else.
export default function setup(): void {
  removeTempDecks();
  copyDemo();
}
