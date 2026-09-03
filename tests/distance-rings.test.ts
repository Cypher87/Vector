import assert from 'node:assert/strict';
import test from 'node:test';
import { createDistanceRings, destinationCoordinate, distanceRingScale } from '../src/map/distance-rings.ts';

test('uses rounded distance-ring scales for each unit system', () => {
  assert.deepEqual(distanceRingScale('metric').map((ring) => ring.label), ['50 km', '100 km', '150 km', '200 km']);
  assert.deepEqual(distanceRingScale('aeronautical').map((ring) => ring.label), ['25 NM', '50 NM', '75 NM', '100 NM']);
  assert.deepEqual(distanceRingScale('imperial').map((ring) => ring.label), ['25 mi', '50 mi', '75 mi', '100 mi']);
});

test('creates closed geodesic rings around the configured receiver', () => {
  const rings = createDistanceRings([4.7639, 52.3086], 'metric', 24);

  assert.equal(rings.length, 4);
  assert.equal(rings[0].coordinates.length, 25);
  assert.deepEqual(rings[0].coordinates[0], rings[0].coordinates.at(-1));
  assert.ok(rings.every((ring) => ring.labelCoordinate[1] === 52.3086));
  assert.ok(rings.every((ring) => ring.labelCoordinate[0] > 4.7639));
  assert.ok(rings.every((ring, index) => index === 0 || ring.labelCoordinate[0] > rings[index - 1].labelCoordinate[0]));
});

test('normalizes coordinates that cross the antimeridian', () => {
  const [longitude, latitude] = destinationCoordinate([179.9, 0], 100, 90);

  assert.ok(longitude >= -180 && longitude <= 180);
  assert.ok(longitude < 0);
  assert.ok(Math.abs(latitude) < 0.01);
});
