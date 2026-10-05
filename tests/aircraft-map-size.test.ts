import assert from 'node:assert/strict';
import test from 'node:test';
import { aircraftMapIconScale } from '../src/map/aircraft-map-size.ts';

test('map icons stay bounded between overview size and 46 pixels', () => {
  for (const zoom of [NaN, Infinity, -Infinity, -1, 5, 7.2]) assert.equal(aircraftMapIconScale(zoom), 1);
  for (const zoom of [11.5, 12, 24]) assert.equal(32.4 * aircraftMapIconScale(zoom), 46);
  assert.ok(32.4 * aircraftMapIconScale(9.2) > 38 && 32.4 * aircraftMapIconScale(9.2) < 39);
});

test('map icon sizing has no threshold jumps or overshoot', () => {
  let previous = 32.4;
  for (let step = 1; step <= 430; step++) {
    const size = 32.4 * aircraftMapIconScale(7.2 + step / 100);
    assert.ok(size >= previous && size <= 46);
    assert.ok(size - previous < .05);
    previous = size;
  }
  assert.ok(aircraftMapIconScale(7.201) - 1 < .000001);
  assert.ok(46 / 32.4 - aircraftMapIconScale(11.499) < .000001);
});
