import assert from 'node:assert/strict';
import test from 'node:test';
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
