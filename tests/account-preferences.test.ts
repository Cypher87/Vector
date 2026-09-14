import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUserPreferences } from '../src/account/preferences.ts';

test('normalizes only supported account preferences', () => {
  assert.deepEqual(normalizeUserPreferences({
    actualRangeOutline: true,
    aircraftFilters: { adsbOnly: true, airborneOnly: 1, favoritesOnly: false },
    aircraftSort: 'distance-asc',
    autoHideDetails: false,
    distanceRings: true,
    favoriteAircraft: ['ABC123', 'invalid', 'abc123', '~123abc'],
    language: 'en',
    legTrace: false,
    legTracePeriod: 240,
    mapLabels: true,
    unitSystem: 'aeronautical',
    unknown: 'discarded',
  }), {
    actualRangeOutline: true,
    aircraftFilters: { adsbOnly: true, airborneOnly: false, favoritesOnly: false, positionOnly: false },
    aircraftSort: 'distance-asc',
    autoHideDetails: false,
    distanceRings: true,
    favoriteAircraft: ['abc123', '~123abc'],
    language: 'en',
    legTrace: false,
    legTracePeriod: 240,
    mapLabels: true,
    unitSystem: 'aeronautical',
  });
});

test('rejects unsupported preference values instead of coercing them', () => {
  assert.deepEqual(normalizeUserPreferences({
    aircraftSort: 'random',
    language: 'de',
    legTracePeriod: 999,
    mapLabels: 'yes',
    unitSystem: 'nautical',
  }), {});
});
