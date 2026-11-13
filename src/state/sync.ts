// BroadcastChannel wrapper between windows of the same deck (§9 Phase 8,
// task 1). One channel at a time, named `dex:<slug>`. A window never receives
// its own messages (BroadcastChannel does not deliver to the sender), so echo
// is only a risk when a receiver re-sends what it applied; lib/session.svelte.ts
// makes sure it does not.

import type { SyncMessage } from '$shared/types';

let channel: BroadcastChannel | null = null;

/** Open the `dex:<slug>` channel (closing any other) and deliver its messages to `onMessage`. */
export function openSync(slug: string, onMessage: (message: SyncMessage) => void): void {
  closeSync();
  if (typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(`dex:${slug}`);
  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const message = event.data;
    if (message && typeof message === 'object' && typeof message.type === 'string') onMessage(message);
  };
}

/** Send a message to the other windows of this deck. No-op while closed. */
export function broadcast(message: SyncMessage): void {
  channel?.postMessage(message);
}

/** Close the channel. */
export function closeSync(): void {
  channel?.close();
  channel = null;
}
