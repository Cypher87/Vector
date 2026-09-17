import assert from 'node:assert/strict';
import test from 'node:test';
import { altitudeColorForValue, altitudeLegendGradient } from '../src/map/altitude-color.ts';

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

test('uses a matching altitude palette for every theme', () => {
  const themes = ['vector', 'midnight', 'radar', 'amber', 'daylight'] as const;
  const lowColors = themes.map((theme) => altitudeColorForValue(0, false, theme));
  const highColors = themes.map((theme) => altitudeColorForValue(12 * feetPerKilometre, false, theme));

  assert.equal(new Set(lowColors).size, themes.length);
  assert.equal(new Set(highColors).size, themes.length);
  themes.forEach((theme, index) => {
    const gradient = altitudeLegendGradient(theme);
    assert.match(gradient, /^linear-gradient\(90deg, /);
    assert.ok(gradient.includes(`${lowColors[index]} 0.000%`));
    assert.ok(gradient.includes(`${highColors[index]} 100.000%`));
  });
});
