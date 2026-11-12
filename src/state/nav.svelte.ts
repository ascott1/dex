// Current slide and build step, with the navigation rules from §7.

import { deck } from './deck.svelte';
import { settings } from './settings.svelte';
import { resetCamera } from './ui.svelte';

export const nav = $state({ index: 0, step: 0 });

function slides() {
  return deck.current?.slides ?? [];
}

function clampIndex(i: number): number {
  const n = slides().length;
  return n === 0 ? 0 : Math.min(Math.max(0, Math.trunc(i)), n - 1);
}

/** Move to slide `i` at `step`. Changing slide resets the camera. */
export function show(i: number, step = 0): void {
  const index = clampIndex(i);
  if (index !== nav.index) resetCamera();
  nav.index = index;
  nav.step = Math.max(0, Math.min(step, slides()[index]?.steps ?? 0));
}

/** The next slide after `from` that is not `skip`, or -1. */
export function nextShown(from: number): number {
  const list = slides();
  for (let i = from + 1; i < list.length; i++) if (!list[i]!.options.skip) return i;
  return -1;
}

/** The previous slide before `from` that is not `skip`, or -1. */
export function prevShown(from: number): number {
  const list = slides();
  for (let i = from - 1; i >= 0; i--) if (!list[i]!.options.skip) return i;
  return -1;
}

export function next(): void {
  const slide = slides()[nav.index];
  if (!slide) return;
  if (settings.builds && nav.step < slide.steps) {
    nav.step += 1;
    return;
  }
  const i = nextShown(nav.index);
  if (i >= 0) show(i, 0);
}

export function prev(): void {
  if (settings.builds && nav.step > 0) {
    nav.step -= 1;
    return;
  }
  const i = prevShown(nav.index);
  if (i >= 0) show(i, slides()[i]!.steps);
}

export function nextSlide(): void {
  const i = nextShown(nav.index);
  if (i >= 0) show(i, 0);
}

export function prevSlide(): void {
  const i = prevShown(nav.index);
  if (i >= 0) show(i, 0);
}

/** Go to slide `i` (0-based) at step 0. Skipped slides can be reached this way. */
export function goto(i: number): void {
  show(i, 0);
}

export function first(): void {
  const list = slides();
  const i = list.findIndex((s) => !s.options.skip);
  show(i >= 0 ? i : 0, 0);
}

export function last(): void {
  const list = slides();
  let i = list.length - 1;
  while (i > 0 && list[i]!.options.skip) i--;
  show(i, 0);
}
