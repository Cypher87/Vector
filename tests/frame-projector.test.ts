import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameProjector } from '../src/map/frame-projector.ts';
import type { AircraftPosition } from '../src/map/aircraft-motion.ts';

test('flat Mercator traces need only three full map projections per frame, regardless of trace length', () => {
  for (const zoom of [3, 7.2, 12, 18]) for (const bearing of [0, 45, 130, -170]) for (const center of [-185, 4.8, 180]) {
    const angle = bearing * Math.PI / 180, scale = 512 * 2 ** zoom;
    const nativeProject = ([longitude, latitude]: AircraftPosition) => {
      const x = (longitude - center) / 360 * scale;
      const y = -Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) / (2 * Math.PI) * scale;
      return { x: 720 + x * Math.cos(angle) - y * Math.sin(angle), y: 500 + x * Math.sin(angle) + y * Math.cos(angle) };
    };
    let calls = 0;
    const project = createFrameProjector((point) => { calls++; return nativeProject(point); }, center, true);
    for (let i = 0; i < 600; i++) {
      const position: AircraftPosition = [center - 5 + i / 60, -80 + i * 160 / 600];
      const expected = nativeProject(position), actual = project(position);
      assert.ok(Math.abs(actual.x - expected.x) < .00001);
      assert.ok(Math.abs(actual.y - expected.y) < .00001);
      assert.deepEqual(project(position), actual, 'cached coordinates do not change the result');
    }
    assert.equal(calls, 3);
  }
});

test('coordinate cache preserves camera changes and unsupported projections use the original engine', () => {
  const point: AircraftPosition = [5, 52];
  const first = createFrameProjector(([x, y]) => ({ x, y: Math.log(Math.tan(Math.PI / 4 + y * Math.PI / 360)) }), 0, true)(point);
  const next = createFrameProjector(([x, y]) => ({ x: 10 + 2 * x, y: 20 + 2 * Math.log(Math.tan(Math.PI / 4 + y * Math.PI / 360)) }), 0, true)(point);
  assert.ok(Math.abs(next.x - (10 + 2 * first.x)) < 1e-9);
  assert.ok(Math.abs(next.y - (20 + 2 * first.y)) < 1e-9);
  const perspective = ([x, y]: AircraftPosition) => ({ x: x / (1 + y), y });
  assert.equal(createFrameProjector(perspective, 0, false), perspective);
});
