import assert from 'node:assert/strict';
import test from 'node:test';
import type { AircraftTracePoint } from '../src/domain/aircraft.ts';
import type { AircraftWake } from '../src/map/aircraft-wake.ts';
import { aircraftWakeLane, aircraftWakeRoute, aircraftWakeOrigins } from '../src/map/aircraft-wake-route.ts';

const point = (timestamp: number, longitude: number, latitude = 52): AircraftTracePoint => ({
  timestamp, longitude, latitude, onGround: false, stale: false, startsLeg: false,
});
const project = ([lon, lat]: [number, number]) => ({ x: lon * 10_000, y: -lat * 10_000 });
const trace = [point(92, 5.001), point(94, 5.002), point(96, 5.003), point(98, 5.003, 52.001), point(100, 5.003, 52.002)];
const wake: AircraftWake = { style: 'jet', origins: [[11.5, 27], [28.5, 27]], width: 2.5, length: 81, duration: 1.6 };
const route = (points = trace, now = 100, rotation = 0) => aircraftWakeRoute(points, now, [5.003, 52.002], project, rotation, 101);

test('resizing aircraft moves only engine origins, keeping geographic history and trail length unchanged', () => {
  assert.deepEqual(aircraftWakeOrigins(wake, 1), wake.origins);
  const scale = 46 / 32.4;
  const resized = { ...wake, origins: aircraftWakeOrigins(wake, scale) };
  assert.deepEqual(wake.origins, [[11.5, 27], [28.5, 27]], 'do not mutate the shared definition');
  for (const [index, [x, y]] of resized.origins.entries()) {
    assert.ok(Math.abs(x - 20 - (wake.origins[index][0] - 20) * scale) < 1e-10);
    assert.ok(Math.abs(y - 20 - (wake.origins[index][1] - 20) * scale) < 1e-10);
    const geometry = aircraftWakeLane(resized, index, [{ x: 0, y: 0 }, { x: 0, y: 1_000 }]);
    assert.equal(geometry.length, wake.length);
    assert.deepEqual(geometry.end, { x: 0, y: wake.length });
  }
});

test('wake follows a measured corner, with short parallel engine lanes', () => {
  const coordinates = route();
  assert.equal(coordinates.length, 5);
  assert.ok(coordinates[1].y > 0);
  assert.ok(Math.abs(coordinates[1].x) < 1e-7);
  assert.ok(coordinates.at(-1)!.x < -20);
  for (let lane = 0; lane < 2; lane++) {
    const geometry = aircraftWakeLane(wake, lane, coordinates);
    assert.match(geometry.path, /^M0 0L.*Q/);
    assert.ok(geometry.end.x < -10);
    assert.ok(geometry.length > 30 && geometry.length <= wake.length);
    assert.doesNotMatch(geometry.path, /NaN|Infinity/);
  }
});

test('inside engine lane does not hook backwards at a sharp measured corner', () => {
  const corner = [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 0, y: 38 }, { x: 0, y: 40 }, { x: -2, y: 40 }, { x: -40, y: 40 }];
  for (const lane of [0, 1]) {
    const geometry = aircraftWakeLane(wake, lane, corner);
    const pairs = [...geometry.path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    for (let i = 1; i < pairs.length; i++) {
      assert.ok(pairs[i][0] <= pairs[i - 1][0], 'westward lane must not turn back east');
      assert.ok(pairs[i][1] >= pairs[i - 1][1], 'southward lane must not turn back north');
    }
  }
});

test('past positions stay anchored when the aircraft heading or map bearing rotates', () => {
  const baseline = route();
  for (const degrees of [45, 90, 180, 315]) {
    const angle = degrees * Math.PI / 180;
    const rotated = route(trace, 100, degrees);
    rotated.forEach((p, i) => {
      assert.ok(Math.abs(p.x * Math.cos(angle) - p.y * Math.sin(angle) - baseline[i].x) < 1e-7);
      assert.ok(Math.abs(p.x * Math.sin(angle) + p.y * Math.cos(angle) - baseline[i].y) < 1e-7);
    });
  }
});

test('route breaks on gaps, new legs, ground, stale points, and position jumps', () => {
  for (const patch of [{ startsLeg: true }, { stale: true }, { onGround: true }, { latitude: NaN }, { longitude: 181 }]) {
    assert.equal(route([...trace.slice(0, -1), { ...trace.at(-1)!, ...patch }]).length, 1);
  }
  assert.equal(route(trace, 116).length, 1);
  assert.equal(route([point(60, 5), trace.at(-1)!]).length, 1);
  assert.equal(route([point(98, 4), trace.at(-1)!]).length, 1);
  assert.equal(route([point(100, 4)]).length, 1, 'a jump before the next trace update is not bridged');
  assert.equal(route([...trace, point(99, 5.003, 52.002)]).length, 1, 'out-of-order records are not joined');
});

test('insufficient positions never generate an invented straight route', () => {
  for (const coordinates of [[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 0, y: 4 }]]) {
    assert.equal(aircraftWakeLane(wake, 0, coordinates).path, '');
  }
  const long = aircraftWakeLane(wake, 0, [{ x: 0, y: 0 }, { x: 0, y: 1_000 }]);
  assert.equal(long.length, 81);
  assert.deepEqual(long.end, { x: 0, y: 81 });
});

test('projection stays on the same world across the date line and scales with zoom', () => {
  const dates = [point(98, 179.999), point(100, -179.999)];
  const wrapped = aircraftWakeRoute(dates, 100, [-179.999, 52], project, 0, 100);
  assert.ok(Math.abs(wrapped.at(-1)!.x) < 30);
  const scaled = aircraftWakeRoute(trace, 100, [5.003, 52.002], (p) => {
    const value = project(p); return { x: value.x * 2, y: value.y * 2 };
  }, 0, 1_000);
  route().forEach((p, i) => {
    assert.ok(Math.abs(scaled[i].x - p.x * 2) < 1e-6);
    assert.ok(Math.abs(scaled[i].y - p.y * 2) < 1e-6);
  });
});

test('long wakes use up to twenty minutes of received positions with a bounded point count', () => {
  const history = Array.from({ length: 750 }, (_, i) => point(i * 2, 5 + i * .0001));
  const now = history.at(-1)!.timestamp;
  const position: [number, number] = [history.at(-1)!.longitude, 52];
  const coordinates = aircraftWakeRoute(history, now, position, project, 90, 1_000);
  assert.equal(coordinates.length, 600);
  assert.ok(coordinates.at(-1)!.y > 700, 'the old 300-point limit must not shorten the tail');
  const lane = aircraftWakeLane({ ...wake, length: 810 }, 0, coordinates);
  assert.ok(lane.length > 700 && lane.length <= 810);
  const sparse = history.map((point) => ({ ...point, timestamp: point.timestamp * 2 }));
  assert.equal(aircraftWakeRoute(sparse, now * 2, position, project, 90, 1_000).length, 301,
    'sparse samples still respect the twenty-minute limit');
});
