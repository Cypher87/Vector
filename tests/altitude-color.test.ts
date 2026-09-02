import assert from 'node:assert/strict';
import test from 'node:test';
import { altitudeColorForValue } from '../src/map/altitude-color.ts';

const feetPerKilometre = 3_280.84;

test('uses a distinct altitude color anchor for every kilometre', () => {
  const expectedColors = [
    [110, 216, 154],
    [110, 216, 182],
    [110, 216, 211],
    [110, 194, 216],
    [110, 166, 216],
    [110, 138, 216],
    [110, 110, 216],
    [138, 110, 216],
    [166, 110, 216],
    [194, 110, 216],
    [216, 110, 211],
    [216, 110, 182],
    [216, 110, 154],
  ];

  expectedColors.forEach((color, altitudeKm) => {
    assert.equal(altitudeColorForValue(altitudeKm * feetPerKilometre), `rgb(${color.join(', ')})`);
  });
});

test('interpolates within an altitude interval and clamps out-of-range values', () => {
  assert.equal(altitudeColorForValue(4.5 * feetPerKilometre), 'rgb(110, 152, 216)');
  assert.equal(altitudeColorForValue(-500), 'rgb(110, 216, 154)');
  assert.equal(altitudeColorForValue(50_000), 'rgb(216, 110, 154)');
  assert.equal(altitudeColorForValue(undefined), '#d5e1e4');
});
