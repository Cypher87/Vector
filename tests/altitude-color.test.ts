import assert from 'node:assert/strict';
import test from 'node:test';
import { altitudeColorForValue, altitudeLegendGradient } from '../src/map/altitude-color.ts';
import { altitudeColorMaximumFt, feetPerKilometre } from '../src/domain/altitude-scale.ts';
import { themes } from '../src/theme.ts';
import { altitudeLegendScale } from '../src/units.ts';

const rgb = (color: string) => color.match(/\d+/g)!.map(Number);
const hue = ([r, g, b]: number[]) => {
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b), delta = maximum - minimum;
  return ((maximum === r ? (g - b) / delta : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
};

test('uses a distinct altitude color anchor for every kilometre', () => {
  const expectedColors = [
    [83, 177, 118], [58, 181, 143], [49, 177, 184], [66, 165, 205],
    [84, 149, 212], [103, 136, 214], [118, 124, 213], [134, 117, 211],
    [147, 108, 204], [161, 97, 204], [197, 90, 174], [224, 102, 132], [236, 139, 96],
  ];

  expectedColors.forEach((color, altitudeKm) => {
    assert.equal(altitudeColorForValue(altitudeKm * feetPerKilometre), `rgb(${color.join(', ')})`);
  });
});

test('interpolates within an altitude interval and clamps out-of-range values', () => {
  assert.equal(altitudeColorForValue(4.5 * feetPerKilometre), 'rgb(94, 143, 213)');
  assert.equal(altitudeColorForValue(-500), 'rgb(83, 177, 118)');
  assert.equal(altitudeColorForValue(50_000), 'rgb(236, 139, 96)');
  assert.equal(altitudeColorForValue(undefined), '#d5e1e4');
  assert.equal(altitudeColorForValue(30_000, true), altitudeColorForValue(0));
});

test('uses a matching altitude palette for every theme', () => {
  const lowColors = themes.map((theme) => altitudeColorForValue(0, false, theme));
  const highColors = themes.map((theme) => altitudeColorForValue(12 * feetPerKilometre, false, theme));

  assert.equal(new Set(lowColors).size, themes.length);
  assert.equal(new Set(highColors).size, themes.length);
  themes.forEach((theme, index) => {
    const gradient = altitudeLegendGradient(theme);
    assert.match(gradient, /^linear-gradient\(90deg, /);
    assert.ok(gradient.includes(`${lowColors[index]} 0.000%`));
    assert.ok(gradient.includes(`${highColors[index]} 100.000%`));
    for (let km = 0; km <= 12; km++) {
      const color = altitudeColorForValue(km * feetPerKilometre, false, theme);
      assert.ok(gradient.includes(`${color} ${(km / 12 * 100).toFixed(3)}%`));
      const difference = Math.abs(hue(rgb(color)) - hue(rgb(altitudeColorForValue(km * feetPerKilometre))));
      assert.ok(Math.min(difference, 360 - difference) < 1, `${theme} keeps the hue at ${km} km`);
      assert.ok(rgb(color).every((channel) => channel >= 0 && channel <= 255));
    }
  });
});

test('cruise anchors progress from violet through berry and rose to coral in every theme', () => {
  for (const theme of themes) {
    const hues = [9, 10, 11, 12].map((km) => hue(rgb(altitudeColorForValue(km * feetPerKilometre, false, theme))));
    const ranges = [[270, 290], [305, 325], [335, 355], [10, 25]];
    hues.forEach((value, index) => assert.ok(value >= ranges[index][0] && value <= ranges[index][1]));
    for (let index = 1; index < hues.length; index++) {
      assert.ok((hues[index] - hues[index - 1] + 360) % 360 >= 25, `${theme}: distinct cruise hues`);
    }
  }
});

test('the full altitude gradient never doubles back in hue, including between anchors', () => {
  for (const theme of themes) {
    const hues = Array.from({ length: 49 }, (_, index) => {
      const value = hue(rgb(altitudeColorForValue(index / 4 * feetPerKilometre, false, theme)));
      // Continue past red (360°) into coral/orange, without wrapping the scale.
      return value < 100 ? value + 360 : value;
    });
    assert.ok(hues[0] >= 130 && hues[0] <= 155, `${theme}: low altitude starts green`);
    for (let index = 1; index < hues.length; index++) {
      const step = hues[index] - hues[index - 1];
      assert.ok(step > 0 && step < 20, `${theme}: forward progression at ${index / 4} km`);
    }
    for (const km of [7, 8]) {
      const difference = Math.abs(hues[km * 4] - hues[0]);
      assert.ok(Math.min(difference, 360 - difference) > 90, `${theme}: ${km} km is clearly separate from ground hue`);
    }
  }
});

test('legend endpoints and tick positions use the same physical altitude in every unit system', () => {
  assert.equal(altitudeLegendScale('metric').ticks.at(-1)!.label, '12+');
  for (const units of ['aeronautical', 'imperial'] as const) {
    const scale = altitudeLegendScale(units, 'en');
    assert.equal(scale.ticks.at(-1)!.label, '39.4+');
    assert.equal(altitudeLegendScale(units, 'nl').ticks.at(-1)!.label, '39,4+');
    for (const tick of scale.ticks.slice(0, -1)) {
      assert.ok(Math.abs(tick.position / 100 * altitudeColorMaximumFt - Number(tick.label) * 1000) < .00001);
    }
  }
});
