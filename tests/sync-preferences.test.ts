import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySyncPreferencePatch,
  createSyncPreferencePatch,
  normalizeSyncPreferencePatch,
  normalizeSyncPreferences,
} from '../src/sync/preferences.ts';

test('synchronized preferences retain only supported values', () => {
  assert.deepEqual(normalizeSyncPreferences({
    actualRangeOutline: true,
    aircraftMotion: false,
    aircraftShadows: false,
    aircraftFilters: { adsbOnly: true, airborneOnly: false, favoritesOnly: true, positionOnly: true, unexpected: true },
    aircraftSort: 'callsign-asc',
    autoHideDetails: false,
    distanceRings: true,
    favoriteAircraft: ['ABC123', 'abc123', '../secret', '4840D6'],
    language: 'en',
    legTrace: true,
    legTracePeriod: 240,
    mapLabels: false,
    mapTheme: 'dark',
    radarEventPreferences: { emergency: true, favorite: false, receiver: true },
    theme: 'midnight',
    unitSystem: 'metric',
    unknown: 'discarded',
  }), {
    actualRangeOutline: true,
    aircraftMotion: false,
    aircraftShadows: false,
    aircraftFilters: { adsbOnly: true, airborneOnly: false, favoritesOnly: true, positionOnly: true },
    aircraftSort: 'callsign-asc',
    autoHideDetails: false,
    distanceRings: true,
    favoriteAircraft: ['4840d6', 'abc123'],
    language: 'en',
    legTrace: true,
    legTracePeriod: 240,
    mapLabels: false,
    mapTheme: 'dark',
    radarEventPreferences: { emergency: true, favorite: false, receiver: true },
    theme: 'midnight',
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

test('preference patches merge independent device changes and favorite operations', () => {
  const original = {
    aircraftFilters: { adsbOnly: false, airborneOnly: false, favoritesOnly: false, positionOnly: false },
    favoriteAircraft: ['4840d6'],
    language: 'nl' as const,
    mapLabels: true,
  };
  const fromDeviceA = createSyncPreferencePatch(original, {
    ...original,
    favoriteAircraft: ['4840d6', 'abc123'],
    language: 'en',
  });
  const fromDeviceB = createSyncPreferencePatch(original, {
    ...original,
    aircraftFilters: { ...original.aircraftFilters, favoritesOnly: true },
    favoriteAircraft: [],
    mapLabels: false,
  });

  const afterBoth = applySyncPreferencePatch(applySyncPreferencePatch(original, fromDeviceA), fromDeviceB);
  assert.deepEqual(afterBoth, {
    aircraftFilters: { adsbOnly: false, airborneOnly: false, favoritesOnly: true, positionOnly: false },
    favoriteAircraft: ['abc123'],
    language: 'en',
    mapLabels: false,
  });
});

test('preference patches discard unknown and invalid fields', () => {
  assert.deepEqual(normalizeSyncPreferencePatch({
    aircraftFilters: { adsbOnly: true, invalid: true },
    favoriteAircraft: { add: ['ABC123', '../secret'], remove: '4840d6' },
    settings: { language: 'de', mapLabels: true, unknown: true },
  }), {
    aircraftFilters: { adsbOnly: true },
    favoriteAircraft: { add: ['abc123'], remove: [] },
    settings: { mapLabels: true },
  });
});

test('filter preset patches preserve independent changes from multiple devices', () => {
  const favoritePreset = {
    id: 'preset_favorites',
    name: 'Favorieten',
    filters: { adsbOnly: false, airborneOnly: false, favoritesOnly: true, positionOnly: false },
    sort: 'distance-asc' as const,
  };
  const original = { filterPresets: [favoritePreset] };
  const fromDeviceA = createSyncPreferencePatch(original, {
    filterPresets: [
      favoritePreset,
      {
        id: 'preset_airborne',
        name: 'In de lucht',
        filters: { adsbOnly: false, airborneOnly: true, favoritesOnly: false, positionOnly: false },
        sort: 'altitude-desc',
      },
    ],
  });
  const fromDeviceB = createSyncPreferencePatch(original, {
    filterPresets: [{ ...favoritePreset, name: 'Mijn favorieten' }],
  });

  assert.deepEqual(applySyncPreferencePatch(applySyncPreferencePatch(original, fromDeviceA), fromDeviceB), {
    filterPresets: [
      { ...favoritePreset, name: 'Mijn favorieten' },
      {
        id: 'preset_airborne',
        name: 'In de lucht',
        filters: { adsbOnly: false, airborneOnly: true, favoritesOnly: false, positionOnly: false },
        sort: 'altitude-desc',
      },
    ],
  });
});
