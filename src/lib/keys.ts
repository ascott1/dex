// Global keydown → command (§7). Key names are normalized so the registry can
// list them as plain strings: `ArrowRight`, `Space`, `Shift+Space`, `t`, `Mod+z`,
// `Shift+Mod+z`, `+`. `Mod` is ⌘ on macOS and Ctrl elsewhere (either is accepted).

import { ui } from '../state/ui.svelte';
import { commands } from './commands';

export function normalizeKey(event: KeyboardEvent): string {
  let key = event.key;
  if (key === ' ' || key === 'Spacebar') key = 'Space';
  else if (key.length === 1) key = key.toLowerCase();
  const letter = /^[a-z]$/.test(key);
  const parts: string[] = [];
  // Shift is part of the name for letters and named keys; for punctuation it is
  // already in the character (`+` is Shift+= on a US layout).
  if (event.shiftKey && (letter || key.length > 1)) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  parts.push(key);
  return parts.join('+');
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const LABELS: Record<string, string> = {
  ArrowRight: '→', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑',
  Space: 'Space', PageDown: 'PgDn', PageUp: 'PgUp', Home: 'Home', End: 'End',
  Escape: 'Esc', Enter: 'Enter', Shift: '⇧', Alt: isMac ? '⌥' : 'Alt', Mod: isMac ? '⌘' : 'Ctrl',
};

/** Human-readable form of a normalized key, for the key list in settings. */
export function keyLabel(key: string): string {
  return key
    .split(/\+(?!$)/)
    .map((part) => LABELS[part] ?? part)
    .join(isMac ? '' : '+');
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isActivatable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, a[href], summary, [role="button"]') !== null;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS']);

export function handleKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  // Blackout (Phase 8): the next key clears it and does nothing else, so a
  // digit does not start a go-to and Esc does not close other layers first.
  // A modifier on its own, a held key, and browser shortcuts (⌘/Ctrl + key)
  // leave it on.
  if (ui.blackout) {
    if (MODIFIERS.has(event.key) || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (!event.repeat) ui.blackout = false;
    return;
  }
  // Ground rule 9: inputs keep their keys, except Escape.
  if (event.key !== 'Escape' && isEditable(event.target)) return;
  const key = normalizeKey(event);
  // A focused button or link activates itself on Enter and Space, unless a
  // command claims the key through its `when` (go-to: digits typed, then Enter).
  const activatable = (key === 'Enter' || key === 'Space') && isActivatable(event.target);
  for (const command of commands) {
    if (!command.keys.includes(key)) continue;
    if (activatable && !command.when) continue;
    if (command.when && !command.when(event)) continue;
    event.preventDefault();
    if (event.repeat && !command.repeat) return;
    command.run(event);
    return;
  }
}
