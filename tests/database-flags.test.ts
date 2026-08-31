import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeAircraftDatabaseFlags } from '../src/domain/database-flags.ts';

test('decodes all documented readsb database flags', () => {
  assert.deepEqual(decodeAircraftDatabaseFlags(0), { flags: [], unknownMask: 0 });
  assert.deepEqual(decodeAircraftDatabaseFlags(1).flags, ['military']);
  assert.deepEqual(decodeAircraftDatabaseFlags(2).flags, ['interesting']);
  assert.deepEqual(decodeAircraftDatabaseFlags(4).flags, ['pia']);
  assert.deepEqual(decodeAircraftDatabaseFlags(8).flags, ['ladd']);
  assert.deepEqual(decodeAircraftDatabaseFlags(15), {
    flags: ['military', 'interesting', 'pia', 'ladd'],
    unknownMask: 0,
  });
});

test('keeps undocumented future flag bits visible', () => {
  assert.deepEqual(decodeAircraftDatabaseFlags(17), {
    flags: ['military'],
    unknownMask: 16,
  });
});
