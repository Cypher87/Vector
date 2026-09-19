import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import {
  aircraftMotionEnabled,
  aircraftPositionDistanceMetres,
  interpolateAircraftPosition,
  maximumAircraftProjectionSeconds,
  projectAircraftPosition,
} from '../src/map/aircraft-motion.ts';

const aircraft = (overrides: Partial<Aircraft> = {}): Aircraft => ({
  dbFlags: 0,
  flight: 'VECTOR',
  groundSpeedKts: 360,
  id: '484fde',
  latitude: 53,
  longitude: 6,
  messages: 100,
  onGround: false,
  positionSeenSeconds: 0,
  seenSeconds: 0,
  source: 'adsb_icao',
  trackDeg: 90,
  ...overrides,
});

test('projects a moving aircraft along its reported track', () => {
  const start: [number, number] = [6, 53];
  const projected = projectAircraftPosition(aircraft(), 5)!;
  assert.ok(projected[0] > start[0]);
  assert.ok(Math.abs(projected[1] - start[1]) < 0.001);
  assert.ok(Math.abs(aircraftPositionDistanceMetres(start, projected) - 926) < 2);
});

test('caps extrapolation and freezes stale positions at the projection limit', () => {
  const capped = projectAircraftPosition(aircraft(), 60)!;
  const maximumDistance = 360 * 0.514444 * maximumAircraftProjectionSeconds;
  assert.ok(Math.abs(aircraftPositionDistanceMetres([6, 53], capped) - maximumDistance) < 2);
  assert.equal(aircraftMotionEnabled(aircraft({ groundSpeedKts: 3 })), false);
  assert.deepEqual(projectAircraftPosition(aircraft({ onGround: true }), 5), [6, 53]);
  const stale = projectAircraftPosition(aircraft({ positionSeenSeconds: 20 }), 5)!;
  assert.equal(aircraftMotionEnabled(aircraft({ positionSeenSeconds: 20 })), false);
  assert.ok(Math.abs(aircraftPositionDistanceMetres([6, 53], stale) - maximumDistance) < 2);
});

test('smoothly corrects positions across the antimeridian', () => {
  const halfway = interpolateAircraftPosition([179.8, 10], [-179.8, 12], 0.5);
  assert.ok(Math.abs(Math.abs(halfway[0]) - 180) < 0.0001);
  assert.equal(halfway[1], 11);
});
