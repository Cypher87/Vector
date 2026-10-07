import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aircraftFilterPresetMatches,
  emptyAircraftFilters,
  normalizeAircraftFilterPresets,
  parseAircraftFilterPresets,
} from '../src/domain/aircraft-filter-preset.ts';

test('filter presets retain only safe, supported values', () => {
  assert.deepEqual(normalizeAircraftFilterPresets([
    {
      id: 'preset_one',
      name: '  Mijn   favorieten  ',
      filters: { favoritesOnly: true, unexpected: true },
      sort: 'distance-asc',
      unexpected: true,
    },
    { id: '../unsafe', name: 'Unsafe', filters: {}, sort: 'altitude-desc' },
    { id: 'bad-sort', name: 'Bad sort', filters: {}, sort: 'random' },
    { id: 'empty-name', name: '   ', filters: {}, sort: 'altitude-desc' },
  ]), [{
    id: 'preset_one',
    name: 'Mijn favorieten',
    filters: { ...emptyAircraftFilters, favoritesOnly: true },
    sort: 'distance-asc',
  }]);
});

test('filter preset parsing survives invalid local storage and detects the active view', () => {
  assert.deepEqual(parseAircraftFilterPresets('{broken'), []);

  const [preset] = normalizeAircraftFilterPresets([{
    id: 'preset_active',
    name: 'Actief',
    filters: { airborneOnly: true },
    sort: 'seen-asc',
  }]);

  assert.equal(aircraftFilterPresetMatches(preset, preset.filters, 'seen-asc'), true);
  assert.equal(aircraftFilterPresetMatches(preset, preset.filters, 'altitude-desc'), false);
  assert.equal(aircraftFilterPresetMatches(preset, emptyAircraftFilters, 'seen-asc'), false);
});

test('saved views retain new sort directions and favorite priority; legacy views default to no priority', () => {
  const [modern, legacy, invalid] = normalizeAircraftFilterPresets([
    { id: 'modern', name: 'Fast favorites', filters: {}, sort: 'speed-asc', favoritesFirst: true },
    { id: 'legacy', name: 'Old view', filters: {}, sort: 'altitude-desc' },
    { id: 'invalid', name: 'Bad priority', filters: {}, sort: 'callsign-desc', favoritesFirst: 'true' },
  ]);
  assert.equal(modern.favoritesFirst, true);
  assert.equal(aircraftFilterPresetMatches(modern, emptyAircraftFilters, 'speed-asc', true), true);
  assert.equal(aircraftFilterPresetMatches(modern, emptyAircraftFilters, 'speed-asc', false), false);
  assert.equal(aircraftFilterPresetMatches(legacy, emptyAircraftFilters, 'altitude-desc', false), true);
  assert.equal(aircraftFilterPresetMatches(legacy, emptyAircraftFilters, 'altitude-desc', true), false);
  assert.equal(invalid.favoritesFirst, undefined);
});
