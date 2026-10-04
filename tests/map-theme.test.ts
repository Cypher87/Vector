import assert from 'node:assert/strict';
import test from 'node:test';
import { themes } from '../src/theme.ts';
import {
  defaultMapTheme,
  mapThemePaint,
  mapThemes,
  openStreetMapRasterLayerId,
  parseMapTheme,
} from '../src/map/map-theme.ts';

test('offers five stable OpenStreetMap display themes', () => {
  assert.deepEqual(mapThemes, ['vector', 'standard', 'light', 'dark', 'contrast']);
  assert.equal(new Set(mapThemes.map((theme) => JSON.stringify(mapThemePaint(theme)))).size, mapThemes.length);
});

test('accepts known map themes and safely falls back to Vector', () => {
  for (const theme of mapThemes) assert.equal(parseMapTheme(theme), theme);
  assert.equal(parseMapTheme('satellite'), defaultMapTheme);
  assert.equal(parseMapTheme(null), defaultMapTheme);
});

test('Daylight brightens only the Default map presentation', () => {
  const muted = mapThemePaint('vector');
  const daylight = mapThemePaint('vector', 'daylight');
  assert.equal(daylight['raster-opacity'], 1);
  assert.ok(daylight['raster-brightness-max'] > muted['raster-brightness-max']);
  assert.ok(daylight['raster-saturation'] < 0);
  for (const theme of themes.filter((theme) => theme !== 'daylight')) {
    assert.deepEqual(mapThemePaint('vector', theme), muted);
  }
});

test('explicit map styles do not change when switching the interface theme', () => {
  for (const style of mapThemes.filter((style) => style !== 'vector')) {
    for (const theme of themes) assert.deepEqual(mapThemePaint(style, theme), mapThemePaint(style));
  }
});

test('all theme combinations have valid raster paint ranges', () => {
  for (const style of mapThemes) {
    for (const theme of themes) {
      const paint = mapThemePaint(style, theme);
      assert.ok(paint['raster-opacity'] >= 0 && paint['raster-opacity'] <= 1);
      assert.ok(paint['raster-brightness-min'] >= 0);
      assert.ok(paint['raster-brightness-max'] <= 1);
      assert.ok(paint['raster-brightness-min'] <= paint['raster-brightness-max']);
      assert.ok(Math.abs(paint['raster-contrast']) <= 1);
      assert.ok(Math.abs(paint['raster-saturation']) <= 1);
    }
  }
});

test('safely finds the OpenStreetMap raster layer in a loaded style', () => {
  assert.equal(openStreetMapRasterLayerId(undefined), undefined);
  assert.equal(openStreetMapRasterLayerId({}), undefined);
  assert.equal(openStreetMapRasterLayerId({ layers: [] }), undefined);
  assert.equal(openStreetMapRasterLayerId({
    layers: [
      { id: 'background', type: 'background' },
      { id: 'openstreetmap', type: 'raster' },
    ],
  }), 'openstreetmap');
});
