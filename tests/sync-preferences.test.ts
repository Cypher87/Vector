import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyAircraftFilters } from '../src/domain/aircraft-filters.ts';
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
    aircraftFilters: { ...emptyAircraftFilters, source: 'adsb', favoritesOnly: true, position: 'with' },
    aircraftSort: 'callsign-asc',
    autoHideDetails: false,
    distanceRings: true,
    favoriteAircraft: ['4840d6', 'abc123'],
    language: 'en',
    legTrace: true,
    legTracePeriod: 240,
    mapLabels: false,
    radarEventPreferences: { emergency: true, favorite: false, receiver: true },
    theme: 'dark',
    unitSystem: 'metric',
  });
});

test('appearance migrates old profiles, ignores retired map styles and syncs mode rather than system colors', () => {
  assert.deepEqual(normalizeSyncPreferences({ theme: 'daylight', mapTheme: 'dark' }), { theme: 'light' });
  assert.deepEqual(normalizeSyncPreferences({ theme: 'auto', mapTheme: 'standard' }), { theme: 'auto' });
  assert.deepEqual(normalizeSyncPreferences({ theme: 'invalid', mapTheme: 'light' }), {});
  assert.deepEqual(normalizeSyncPreferencePatch({ settings: { theme: 'amber', mapTheme: 'contrast' } }), { settings: { theme: 'dark' } });
  assert.deepEqual(applySyncPreferencePatch({ theme: 'dark' }, { settings: { theme: 'auto' } }), { theme: 'auto' });
  assert.deepEqual(createSyncPreferencePatch({ theme: 'auto' }, { theme: 'auto' }), {});
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

test('new sorting preferences synchronize independently and retain false values', () => {
  const before = { aircraftSort: 'distance-asc' as const, aircraftFavoritesFirst: true };
  const patch = createSyncPreferencePatch(before, { ...before, aircraftSort: 'speed-desc' });
  assert.deepEqual(patch, { settings: { aircraftSort: 'speed-desc' } });
  const priority = createSyncPreferencePatch(before, { ...before, aircraftFavoritesFirst: false });
  assert.deepEqual(priority, { settings: { aircraftFavoritesFirst: false } });
  assert.deepEqual(applySyncPreferencePatch(applySyncPreferencePatch(before, patch), priority), {
    aircraftSort: 'speed-desc', aircraftFavoritesFirst: false,
  });
  assert.deepEqual(normalizeSyncPreferences({ aircraftSort: 'seen-desc', aircraftFavoritesFirst: 'true' }), { aircraftSort: 'seen-desc' });
  const preset = { id: 'favorites', name: 'Fast favorites', filters: emptyAircraftFilters, sort: 'speed-desc' as const, favoritesFirst: true };
  assert.deepEqual(applySyncPreferencePatch({}, { filterPresets: { upsert: [preset] } }), { filterPresets: [preset] });
});

test('aircraft trail layer sync preserves booleans and independent preferences', () => {
  for (const aircraftWakes of [true, false]) {
    assert.deepEqual(normalizeSyncPreferences({ aircraftWakes }), { aircraftWakes });
  }
  for (const aircraftWakes of ['false', 0, null, undefined, {}]) {
    assert.deepEqual(normalizeSyncPreferences({ aircraftWakes }), {});
  }
  const before = { aircraftWakes: true, aircraftShadows: true, aircraftMotion: true, legTrace: true };
  const patch = createSyncPreferencePatch(before, { ...before, aircraftWakes: false });
  assert.deepEqual(patch, { settings: { aircraftWakes: false } });
  assert.deepEqual(applySyncPreferencePatch(before, patch), { ...before, aircraftWakes: false });
  assert.deepEqual(applySyncPreferencePatch({ aircraftWakes: false }, { settings: { mapLabels: false } }), {
    aircraftWakes: false, mapLabels: false,
  });
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
    aircraftFilters: { ...emptyAircraftFilters, favoritesOnly: true },
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
    aircraftFilters: { source: 'adsb' },
    favoriteAircraft: { add: ['abc123'], remove: [] },
    settings: { mapLabels: true },
  });
});

test('callsign favorites sync with independent add/remove operations, including an explicit empty list', () => {
  const original = { favoriteAircraft: ['abc123'], favoriteCallsigns: ['KLM123'] };
  assert.deepEqual(normalizeSyncPreferences({ favoriteCallsigns: ['klm 123', '*', 'KLM123', '../bad'] }), { favoriteCallsigns: ['KLM123'] });
  const add = createSyncPreferencePatch(original, { ...original, favoriteCallsigns: ['KLM123', 'BAW456'] });
  const remove = createSyncPreferencePatch(original, { ...original, favoriteCallsigns: [] });
  assert.deepEqual(add, { favoriteCallsigns: { add: ['BAW456'], remove: [] } });
  assert.deepEqual(applySyncPreferencePatch(applySyncPreferencePatch(original, add), remove), { favoriteAircraft: ['abc123'], favoriteCallsigns: ['BAW456'] });
  assert.deepEqual(applySyncPreferencePatch(original, remove), { favoriteAircraft: ['abc123'], favoriteCallsigns: [] });
  assert.deepEqual(normalizeSyncPreferencePatch({ favoriteCallsigns: { add: ['x*'], remove: '../bad' } }), {});
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
      { ...favoritePreset, name: 'Mijn favorieten', filters: { ...emptyAircraftFilters, favoritesOnly: true } },
      {
        id: 'preset_airborne',
        name: 'In de lucht',
        filters: { ...emptyAircraftFilters, flightStatus: 'airborne' },
        sort: 'altitude-desc',
      },
    ],
  });
});
