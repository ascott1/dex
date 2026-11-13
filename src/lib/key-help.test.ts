import { describe, expect, test } from 'vitest';
import { commands, getCommand } from './commands';
import { KEY_GROUPS, keyGroups } from './key-help';

const named = KEY_GROUPS.flatMap((g) => g.rows.flatMap((r) => (r.id === undefined ? [] : [r.id])));

describe('key help', () => {
  test('the groups are in order', () => {
    expect(KEY_GROUPS.map((g) => g.name)).toEqual(['Move', 'View', 'Draw and notes', 'Zoom', 'Present']);
  });

  test('every id the groups name exists', () => {
    for (const id of named) expect(getCommand(id), id).toBeDefined();
  });

  test('every command with keys appears in exactly one group', () => {
    for (const command of commands) {
      if (command.keys.length === 0) continue;
      expect(named.filter((id) => id === command.id), command.id).toHaveLength(1);
    }
  });

  test('no row is empty', () => {
    for (const group of keyGroups()) {
      for (const row of group.rows) {
        expect(row.keys.length, row.title).toBeGreaterThan(0);
        expect(row.title).not.toBe('');
      }
    }
  });
});
