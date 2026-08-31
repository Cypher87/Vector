import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeFavoriteAircraftIds,
  parseFavoriteAircraftIds,
  toggleFavoriteAircraftId,
} from '../src/domain/favorite-aircraft.ts';

test('normalizes stored favorite aircraft IDs and removes invalid entries', () => {
  assert.deepEqual(normalizeFavoriteAircraftIds([' 484FDE ', '484fde', '~ABC123', '', 42]), [
    '484fde',
    '~abc123',
  ]);
});

test('recovers safely from missing or malformed favorite aircraft storage', () => {
  assert.deepEqual(parseFavoriteAircraftIds(null), []);
  assert.deepEqual(parseFavoriteAircraftIds('{broken'), []);
  assert.deepEqual(parseFavoriteAircraftIds(JSON.stringify(['4CA56E'])), ['4ca56e']);
});

test('toggles one favorite without losing the other saved aircraft', () => {
  assert.deepEqual(toggleFavoriteAircraftId(['484fde'], '4CA56E'), ['484fde', '4ca56e']);
  assert.deepEqual(toggleFavoriteAircraftId(['484fde', '4ca56e'], '484FDE'), ['4ca56e']);
});
