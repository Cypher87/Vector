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
    filters: { ...emptyAircraftFilters, airborneOnly: true },
    sort: 'seen-asc',
  }]);

  assert.equal(aircraftFilterPresetMatches(preset, preset.filters, 'seen-asc'), true);
  assert.equal(aircraftFilterPresetMatches(preset, preset.filters, 'altitude-desc'), false);
  assert.equal(aircraftFilterPresetMatches(preset, emptyAircraftFilters, 'seen-asc'), false);
});
