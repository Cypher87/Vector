import assert from 'node:assert/strict';
import test from 'node:test';
import type { AircraftTracePoint } from '../src/domain/aircraft.ts';
import {
  defaultLegTracePeriod,
  limitAircraftTracePeriod,
  parseLegTracePeriod,
} from '../src/domain/aircraft-trace.ts';

const point = (timestamp: number): AircraftTracePoint => ({
  altitudeFt: 1_000,
  latitude: 53,
  longitude: 6,
  onGround: false,
  stale: false,
  startsLeg: false,
  timestamp,
});

test('defaults the stored leg trace period to 30 minutes', () => {
  assert.equal(parseLegTracePeriod(null), defaultLegTracePeriod);
  assert.equal(parseLegTracePeriod('invalid'), defaultLegTracePeriod);
  assert.equal(parseLegTracePeriod('30'), 30);
  assert.equal(parseLegTracePeriod('120'), 120);
  assert.equal(parseLegTracePeriod('240'), 240);
  assert.equal(parseLegTracePeriod('480'), 480);
  assert.equal(parseLegTracePeriod('full'), 'full');
});

test('limits the trace relative to its newest point', () => {
  const points = [point(1_000), point(2_000), point(2_800), point(3_000)];

  assert.deepEqual(limitAircraftTracePeriod(points, 30), points.slice(1));
  assert.equal(limitAircraftTracePeriod(points, 60), points);
  assert.equal(limitAircraftTracePeriod(points, 'full'), points);
});
