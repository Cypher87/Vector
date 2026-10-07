import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import {
  aircraftSortDirection, aircraftSortField, aircraftSortFields, defaultAircraftSort,
  isAircraftSort, reverseAircraftSort, sortAircraft,
} from '../src/domain/aircraft-sort.ts';

const plane = (id: string, patch: Partial<Aircraft> = {}): Aircraft => ({
  id, flight: `TEST${id}`, altitudeFt: 10_000, groundSpeedKts: 200, seenSeconds: 1,
  onGround: false, source: 'adsb_icao', messages: 100, dbFlags: 0, ...patch,
});
const ids = (aircraft: Aircraft[]) => aircraft.map((item) => item.id);

test('all five criteria support either direction without changing legacy serialized values', () => {
  for (const field of aircraftSortFields) {
    for (const direction of ['asc', 'desc'] as const) {
      const sort = `${field}-${direction}` as const;
      assert.equal(isAircraftSort(sort), true);
      assert.equal(aircraftSortField(sort), field);
      assert.equal(aircraftSortDirection(sort), direction);
      assert.equal(reverseAircraftSort(reverseAircraftSort(sort)), sort);
    }
  }
  for (const value of [null, 1, {}, 'speed-fast', 'unknown-asc', 'altitude-asc-extra']) assert.equal(isAircraftSort(value), false);
  assert.equal(defaultAircraftSort('altitude'), 'altitude-desc');
  assert.equal(defaultAircraftSort('speed'), 'speed-desc');
  assert.equal(defaultAircraftSort('distance'), 'distance-asc');
  assert.equal(defaultAircraftSort('seen'), 'seen-asc');
  assert.equal(defaultAircraftSort('callsign'), 'callsign-asc');
});

test('numeric criteria reverse only known values, with zero valid and missing values always last', () => {
  for (const [field, property] of [['altitude', 'altitudeFt'], ['speed', 'groundSpeedKts'], ['seen', 'seenSeconds']] as const) {
    const input = [plane('1', { [property]: 100 }), plane('2', { [property]: undefined }),
      plane('3', { [property]: 0 }), plane('4', { [property]: NaN }), plane('5', { [property]: Infinity })];
    assert.deepEqual(ids(sortAircraft(input, `${field}-asc`)), ['3', '1', '2', '4', '5']);
    assert.deepEqual(ids(sortAircraft(input, `${field}-desc`)), ['1', '3', '2', '4', '5']);
    assert.deepEqual(ids(input), ['1', '2', '3', '4', '5'], 'do not mutate the source feed');
  }
});

test('ground contacts sort as zero altitude, while negative measured altitudes remain valid', () => {
  const input = [plane('1', { onGround: true, altitudeFt: undefined }), plane('2', { altitudeFt: -100 }), plane('3')];
  assert.deepEqual(ids(sortAircraft(input, 'altitude-asc')), ['2', '1', '3']);
  assert.deepEqual(ids(sortAircraft(input, 'altitude-desc')), ['3', '1', '2']);
});

test('distance is calculated once per aircraft and missing receiver or aircraft positions stay last', () => {
  const input = [plane('1'), plane('2'), plane('3')];
  let calls = 0;
  const distanceKm = (item: Aircraft) => { calls++; return item.id === '1' ? 0 : item.id === '2' ? 5 : undefined; };
  assert.deepEqual(ids(sortAircraft(input, 'distance-desc', { distanceKm })), ['2', '1', '3']);
  assert.equal(calls, input.length);
  assert.deepEqual(ids(sortAircraft([...input].reverse(), 'distance-asc')), ['1', '2', '3']);
  sortAircraft(input, 'speed-asc', { distanceKm });
  assert.equal(calls, input.length, 'other criteria must not compute distances');
});

test('callsigns use natural ordering, missing callsigns stay last, and ICAO resolves equal names', () => {
  const input = [plane('3', { flight: 'TEST10' }), plane('2', { flight: 'test2' }),
    plane('1', { flight: 'TEST2' }), plane('4', { flight: '' }), plane('abc123', { flight: 'ABC123' })];
  assert.deepEqual(ids(sortAircraft(input, 'callsign-asc', { language: 'nl' })), ['1', '2', '3', '4', 'abc123']);
  assert.deepEqual(ids(sortAircraft(input, 'callsign-desc', { language: 'en' })), ['3', '1', '2', '4', 'abc123']);
  for (const sort of ['altitude-asc', 'altitude-desc', 'speed-asc', 'seen-desc'] as const) {
    assert.deepEqual(ids(sortAircraft(input, sort)), ids(sortAircraft([...input].reverse(), sort)));
  }
});

test('favorites form a sorted leading group without hiding other aircraft or pulling unknown values upwards', () => {
  const input = [plane('1', { altitudeFt: 30000 }), plane('2', { altitudeFt: 5000 }),
    plane('3', { altitudeFt: 10000 }), plane('4', { altitudeFt: undefined }), plane('5', { altitudeFt: undefined })];
  const options = { favoritesFirst: true, favoriteIds: new Set(['2', '3', '5']) };
  assert.deepEqual(ids(sortAircraft(input, 'altitude-desc', options)), ['3', '2', '1', '5', '4']);
  assert.deepEqual(ids(sortAircraft(input, 'altitude-asc', options)), ['2', '3', '1', '5', '4']);
  assert.deepEqual(ids(sortAircraft(input, 'altitude-desc', { ...options, favoritesFirst: false })), ['1', '3', '2', '4', '5']);
});
