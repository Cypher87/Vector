import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft, AircraftTracePoint } from '../src/domain/aircraft.ts';
import { appendTracePoint, nearestTracePoint, profileSeries, traceFromHistory, tracePointFromAircraft } from '../src/domain/flight-profile.ts';

const point = (timestamp: number, overrides: Partial<AircraftTracePoint> = {}): AircraftTracePoint => ({
  timestamp, latitude: 52, longitude: 5, altitudeFt: 10000, groundSpeedKts: 200,
  onGround: false, stale: false, startsLeg: false, ...overrides,
});
const aircraft: Aircraft = { id: 'abc123', flight: 'TEST', latitude: 52, longitude: 5, altitudeFt: 10000,
  groundSpeedKts: 200, seenSeconds: 0, positionSeenSeconds: 2, onGround: false, source: 'adsb_icao', messages: 10, dbFlags: 0 };

test('trace captures measurement time and speed, excludes stale or missing positions', () => {
  assert.deepEqual(tracePointFromAircraft(aircraft, 102), point(100));
  assert.equal(tracePointFromAircraft({ ...aircraft, positionSeenSeconds: 21 }, 102), undefined);
  assert.equal(tracePointFromAircraft({ ...aircraft, latitude: undefined }, 102), undefined);
  assert.equal(tracePointFromAircraft({ ...aircraft, longitude: NaN }, 102), undefined);
});

test('local trace is bounded, skips duplicate timestamps and marks recording gaps', () => {
  const points = [point(100)];
  assert.equal(appendTracePoint(points, point(100)), points);
  assert.equal(appendTracePoint(points, point(101)), points);
  assert.equal(appendTracePoint(points, point(500)).at(-1)?.startsLeg, true);
  let history: AircraftTracePoint[] = [];
  for (let i = 0; i < 1000; i++) history = appendTracePoint(history, point(i * 3));
  assert.equal(history.length, 600);
});

test('replay profile uses only its own snapshots and does not connect missing aircraft', () => {
  const points = traceFromHistory([
    { timestamp: 100, aircraft: [aircraft] }, { timestamp: 130, aircraft: [aircraft] },
    { timestamp: 160, aircraft: [] }, { timestamp: 190, aircraft: [aircraft] },
  ], aircraft.id);
  assert.deepEqual(points.map((p) => p.timestamp), [98, 128, 188]);
  assert.deepEqual(points.map((p) => p.startsLeg), [true, false, true]);
  assert.equal(traceFromHistory([{ timestamp: 100, aircraft: [aircraft] }], 'unknown').length, 0);
});

test('profile series has real gaps for missing data, stale points and new legs', () => {
  const points = [point(100), point(130, { altitudeFt: undefined }), point(160), point(190),
    point(220, { stale: true }), point(250), point(280, { startsLeg: true }), point(900)];
  const altitude = profileSeries(points, 'altitudeFt', .3048, 24, 46);
  assert.equal((altitude.path.match(/M/g) ?? []).length, 5);
  assert.equal((altitude.path.match(/L/g) ?? []).length, 1);
  assert.equal(altitude.maximum, 10000 * .3048 * 1.08);
  const speed = profileSeries([point(100), point(130)], 'groundSpeedKts', 1.852, 113, 46);
  assert.equal(speed.maximum, 200 * 1.852 * 1.08);
  assert.ok(!altitude.path.includes('NaN'));
});

test('empty, ground, zero and negative measurements remain honest and finite', () => {
  assert.equal(profileSeries([], 'altitudeFt', 1, 0, 10).hasData, false);
  assert.equal(profileSeries([point(100, { onGround: true, altitudeFt: undefined })], 'altitudeFt', 1, 0, 10).hasData, false);
  assert.equal(profileSeries([point(100, { altitudeFt: -100 })], 'altitudeFt', 1, 0, 10).minimum, -100);
  const zero = profileSeries([point(100, { groundSpeedKts: 0 })], 'groundSpeedKts', 1, 0, 10);
  assert.equal(zero.hasData, true);
  assert.ok(!zero.path.includes('NaN'));
});

test('nearest point handles empty series, boundaries and uneven timestamps', () => {
  const points = [point(100), point(130), point(200)];
  assert.equal(nearestTracePoint([], 100), -1);
  assert.equal(nearestTracePoint(points, 0), 0);
  assert.equal(nearestTracePoint(points, 900), 2);
  assert.equal(nearestTracePoint(points, 140), 1);
  assert.equal(nearestTracePoint(points, 190), 2);
});
