// BroadcastChannel wrapper between windows of the same deck. Phase 8 fills
// this in (§9 Phase 8, task 1).

import type { SyncMessage } from '$shared/types';

/** Phase 8: open the `dex:<slug>` channel. */
export function openSync(_slug: string): void {}

/** Phase 8: send a message to the other windows of this deck. */
export function broadcast(_message: SyncMessage): void {}

/** Phase 8: close the channel. */
export function closeSync(): void {}
