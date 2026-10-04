import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import {
  activeAircraftFilterKeys, aircraftFilterCategory, emptyAircraftFilters, filterMeasurement,
  matchesAircraftFilters, normalizeAircraftFilterPatch, normalizeAircraftFilters,
} from '../src/domain/aircraft-filters.ts';
import { aircraftFilterPresetMatches, normalizeAircraftFilterPresets } from '../src/domain/aircraft-filter-preset.ts';
import { applySyncPreferencePatch, createSyncPreferencePatch } from '../src/sync/preferences.ts';

const aircraft: Aircraft = {
  id: 'abc123', flight: 'TEST', aircraftType: 'A320', category: 'A3', altitudeFt: 20_000,
  groundSpeedKts: 200, latitude: 52, longitude: 4, onGround: false, verticalRateFpm: 500,
  source: 'adsb_icao', seenSeconds: 0, messages: 1, dbFlags: 0,
};
const matches = (filters: unknown, patch: Partial<Aircraft> = {}, distanceKm?: number) => matchesAircraftFilters(
  { ...aircraft, ...patch }, normalizeAircraftFilters(filters), { favoriteIds: new Set(['abc123']), distanceKm },
);

test('legacy booleans migrate to explicit groups; newer fields take precedence', () => {
  assert.deepEqual(normalizeAircraftFilters({ adsbOnly: true, airborneOnly: true, positionOnly: true, favoritesOnly: true }), {
    ...emptyAircraftFilters, favoritesOnly: true, flightStatus: 'airborne', source: 'adsb', position: 'with',
  });
  assert.deepEqual(normalizeAircraftFilterPatch({ airborneOnly: true, flightStatus: 'ground', adsbOnly: false }), { flightStatus: 'ground', source: 'all' });
  assert.deepEqual(normalizeAircraftFilters(null), emptyAircraftFilters);
  assert.equal(activeAircraftFilterKeys(emptyAircraftFilters).length, 0);
});

test('normalization rejects invalid ranges, nonfinite values and unknown fields', () => {
  assert.deepEqual(normalizeAircraftFilterPatch({
    altitude: { min: 500, max: 100 }, speed: { min: -1, max: Infinity }, distance: NaN,
    source: 'url', flightStatus: 'hovering', position: true, alert: '1234', favoritesOnly: 'true', unexpected: true,
  }), {});
  assert.deepEqual(normalizeAircraftFilterPatch({ altitude: { min: null, max: 200_001 }, speed: { min: 0 }, distance: -1 }), {});
  assert.deepEqual(normalizeAircraftFilterPatch({
    categories: ['balloon', 'light', 'balloon', 'bogus'], typeCodes: [' b738 ', 'A320', 'A320', '<svg>', 12, 'toolong'],
  }), { categories: ['light', 'balloon'], typeCodes: ['A320', 'B738'] });
});

test('category choices are ORed, groups are ANDed, and use the marker classification', () => {
  assert.equal(matches({ categories: ['airliner', 'balloon'] }), true);
  assert.equal(matches({ categories: ['airliner', 'balloon'] }, { aircraftType: 'BALL', category: 'B2' }), true);
  assert.equal(matches({ categories: ['helicopter'] }, { aircraftType: 'H135', category: 'A7' }), true);
  assert.equal(matches({ categories: ['light'] }, { aircraftType: 'C172', category: 'A1' }), true);
  assert.equal(matches({ categories: ['glider'] }, { aircraftType: 'GLID', category: 'B1' }), true);
  assert.equal(matches({ categories: ['heavy'] }, { aircraftType: 'B744', category: 'A5' }), true);
  assert.equal(matches({ categories: ['turboprop'] }, { aircraftType: 'AT76', category: 'A2' }), true);
  assert.equal(matches({ categories: ['other'] }, { aircraftType: undefined, category: undefined }), true);
  assert.equal(aircraftFilterCategory('small'), 'light');
  assert.equal(aircraftFilterCategory('ultralight'), 'light');
  assert.equal(aircraftFilterCategory('uav'), 'other');
  assert.equal(matches({ categories: ['airliner', 'balloon'], altitude: { min: null, max: 1_000 } }), false);
  assert.equal(matches({ favoritesOnly: true }), true);
  assert.equal(matches({ favoritesOnly: true }, { id: 'def456' }), false);
});

test('numeric bounds are inclusive and missing measurements never become zero', () => {
  assert.equal(matches({ altitude: { min: 20_000, max: 20_000 }, speed: { min: 200, max: 200 }, distance: 25 }, {}, 25), true);
  assert.equal(matches({ distance: 25 }, {}, 25.01), false);
  assert.equal(matches({ distance: 25 }), false);
  assert.equal(matches({ distance: 25 }, {}, NaN), false);
  assert.equal(matches({ altitude: { min: 0, max: null } }, { altitudeFt: undefined }), false);
  assert.equal(matches({ speed: { min: 0, max: null } }, { groundSpeedKts: NaN }), false);
  assert.equal(matches({ speed: { min: 0, max: 0 }, altitude: { min: 0, max: 0 } }, { altitudeFt: 0, groundSpeedKts: 0, onGround: true }), true);
  assert.equal(matches({}, { altitudeFt: undefined, groundSpeedKts: undefined }), true);
  assert.equal(matches({ altitude: { min: -1_000, max: 0 } }, { altitudeFt: -50 }), true);
  assert.deepEqual(activeAircraftFilterKeys(normalizeAircraftFilters({ altitude: { min: 0, max: 1_000 }, categories: ['glider', 'balloon'] })), ['categories', 'altitude']);
});

test('flight status uses ground flag and known vertical speed with a deadband', () => {
  assert.equal(matches({ flightStatus: 'climbing' }), true);
  assert.equal(matches({ flightStatus: 'climbing' }, { verticalRateFpm: 127 }), false);
  assert.equal(matches({ flightStatus: 'climbing' }, { verticalRateFpm: 128 }), true);
  assert.equal(matches({ flightStatus: 'descending' }, { verticalRateFpm: -128 }), true);
  assert.equal(matches({ flightStatus: 'descending' }, { verticalRateFpm: undefined }), false);
  assert.equal(matches({ flightStatus: 'climbing' }, { onGround: true }), false);
  assert.equal(matches({ flightStatus: 'ground' }, { onGround: true }), true);
  assert.equal(matches({ flightStatus: 'airborne' }, { onGround: true }), false);
});

test('advanced filters match source, position, exact type codes and emergencies', () => {
  assert.equal(matches({ source: 'adsb' }, { source: 'adsb_icao_nt' }), true);
  assert.equal(matches({ source: 'adsb' }, { source: 'adsr_icao' }), false);
  assert.equal(matches({ source: 'mlat' }, { source: 'mlat' }), true);
  assert.equal(matches({ source: 'other' }, { source: 'tisb_icao' }), true);
  assert.equal(matches({ position: 'with' }, { latitude: 0, longitude: 0 }), true);
  assert.equal(matches({ position: 'without' }, { latitude: undefined }), true);
  assert.equal(matches({ position: 'with' }, { longitude: NaN }), false);
  assert.equal(matches({ typeCodes: ['a320', 'B738'] }), true);
  assert.equal(matches({ typeCodes: ['A32'] }), false);
  assert.equal(matches({ typeCodes: ['A320'] }, { aircraftType: undefined }), false);
  assert.equal(matches({ alert: 'emergency' }, { emergency: 'general' }), true);
  assert.equal(matches({ alert: 'emergency' }, { emergency: 'none' }), false);
  for (const squawk of ['7500', '7600', '7700']) {
    assert.equal(matches({ alert: 'emergency' }, { squawk }), true);
    assert.equal(matches({ alert: squawk }, { squawk }), true);
  }
  assert.equal(matches({ alert: '7700' }, { squawk: '7600' }), false);
});

test('display units convert to invariant physical filter values', () => {
  assert.equal(10_000 * filterMeasurement('altitude', 'metric').factor, 3_048);
  assert.equal(filterMeasurement('altitude', 'aeronautical').unit, 'ft');
  assert.ok(Math.abs(100 * filterMeasurement('speed', 'metric').factor - 185.2) < 1e-8);
  assert.equal(filterMeasurement('speed', 'aeronautical').factor, 1);
  assert.equal(filterMeasurement('speed', 'imperial').factor, 1.150779);
  assert.equal(filterMeasurement('distance', 'imperial').factor, 0.621371);
  assert.equal(filterMeasurement('distance', 'aeronautical').factor, 1 / 1.852);
});

test('views and concurrent sync patches preserve groups and support clearing ranges', () => {
  const filters = normalizeAircraftFilters({ altitude: { min: 100, max: 30_000 }, typeCodes: ['B738', 'A320'], categories: ['glider', 'light'], distance: 50 });
  const [preset] = normalizeAircraftFilterPresets([{ id: 'test', name: 'Test', sort: 'distance-asc', filters }]);
  assert.equal(aircraftFilterPresetMatches(preset, normalizeAircraftFilters({ ...filters, typeCodes: ['a320', 'b738'], categories: ['light', 'glider'] }), 'distance-asc'), true);
  const original = { aircraftFilters: filters };
  const a = createSyncPreferencePatch(original, { aircraftFilters: { ...filters, distance: null, altitude: { min: null, max: null } } });
  const b = createSyncPreferencePatch(original, { aircraftFilters: { ...filters, source: 'mlat', categories: ['balloon'] } });
  const result = applySyncPreferencePatch(applySyncPreferencePatch(original, a), b);
  assert.deepEqual(result.aircraftFilters, { ...filters, altitude: { min: null, max: null }, distance: null, source: 'mlat', categories: ['balloon'] });
  assert.deepEqual(createSyncPreferencePatch(original, { aircraftFilters: { ...filters, categories: ['light', 'glider'], typeCodes: ['A320', 'B738'] } }), {});
});
