import { removeTempDecks } from './temp-deck.ts';

// Second line of defence after each spec's afterAll.
export default function teardown(): void {
  removeTempDecks();
}
