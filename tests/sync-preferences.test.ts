import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSyncPreferences } from '../src/sync/preferences.ts';

test('synchronized preferences retain only supported values', () => {
  assert.deepEqual(normalizeSyncPreferences({
    actualRangeOutline: true,
    aircraftFilters: { adsbOnly: true, airborneOnly: false, favoritesOnly: true, positionOnly: true, unexpected: true },
    aircraftSort: 'callsign-asc',
    autoHideDetails: false,
    distanceRings: true,
    favoriteAircraft: ['ABC123', 'abc123', '../secret', '4840D6'],
    language: 'en',
    legTrace: true,
    legTracePeriod: 240,
    mapLabels: false,
    unitSystem: 'metric',
    unknown: 'discarded',
  }), {
    actualRangeOutline: true,
    aircraftFilters: { adsbOnly: true, airborneOnly: false, favoritesOnly: true, positionOnly: true },
    aircraftSort: 'callsign-asc',
    autoHideDetails: false,
    distanceRings: true,
    favoriteAircraft: ['4840d6', 'abc123'],
    language: 'en',
    legTrace: true,
    legTracePeriod: 240,
    mapLabels: false,
    unitSystem: 'metric',
  });
});

test('invalid preference values are discarded', () => {
  assert.deepEqual(normalizeSyncPreferences({
    aircraftFilters: 'all',
    aircraftSort: 'random',
    favoriteAircraft: 'abc123',
    language: 'de',
    legTracePeriod: 999,
    unitSystem: 'nautical',
  }), {});
  assert.deepEqual(normalizeSyncPreferences(null), {});
});
