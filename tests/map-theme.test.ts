import assert from 'node:assert/strict';
import test from 'node:test';
import type { StyleSpecification } from 'maplibre-gl';
import { themes } from '../src/theme.ts';
import { applyMapTheme, mapThemePaint, openStreetMapRasterLayerId } from '../src/map/map-theme.ts';

test('dark reverses raster luminance; light preserves softly desaturated daytime colors', () => {
  const dark = mapThemePaint('dark'), light = mapThemePaint('light');
  assert.ok(dark['raster-brightness-min'] > dark['raster-brightness-max']);
  assert.ok(dark['raster-brightness-max'] < .15, 'light OSM land becomes truly dark');
  assert.ok(light['raster-brightness-max'] > .9);
  assert.ok(light['raster-brightness-min'] < light['raster-brightness-max']);
  for (const theme of themes) {
    const paint = mapThemePaint(theme);
    assert.equal(paint['raster-opacity'], 1);
    for (const key of ['raster-brightness-min', 'raster-brightness-max'] as const) assert.ok(paint[key] >= 0 && paint[key] <= 1);
    assert.ok(Math.abs(paint['raster-contrast']) <= 1);
    assert.ok(paint['raster-saturation'] < 0 && paint['raster-saturation'] >= -1);
  }
});

test('safely finds the OpenStreetMap raster layer in a loaded style', () => {
  for (const value of [undefined, {}, { layers: [] }, { layers: [null, {}, { id: 'other', type: 'raster' }] }]) {
    assert.equal(openStreetMapRasterLayerId(value), undefined);
  }
  assert.equal(openStreetMapRasterLayerId({ layers: [{ id: 'openstreetmap', type: 'raster' }] }), 'openstreetmap');
});

test('applies the resolved appearance in place, safely ignoring unloaded and custom styles', () => {
  let style: StyleSpecification | undefined = undefined;
  const writes: [string, string, unknown][] = [];
  const map = {
    getStyle: () => style!,
    setPaintProperty: (layer: string, name: string, value: unknown) => { writes.push([layer, name, value]); return map; },
  } as Pick<import('maplibre-gl').Map, 'getStyle' | 'setPaintProperty'>;
  applyMapTheme(map, 'light');
  assert.equal(writes.length, 0);
  style = { version: 8, sources: {}, layers: [] };
  applyMapTheme(map, 'dark');
  assert.equal(writes.length, 0);
  style.layers = [{ id: 'background', type: 'background' }, { id: 'openstreetmap', type: 'raster', source: 'tiles' }];
  for (const theme of themes) {
    writes.length = 0;
    applyMapTheme(map, theme);
    for (const [property, value] of Object.entries(mapThemePaint(theme))) {
      assert.ok(writes.some(([layer, name, actual]) => layer === 'openstreetmap' && name === property && actual === value));
      assert.deepEqual(writes.find(([, name]) => name === property + '-transition')?.[2], { duration: 0, delay: 0 });
    }
    assert.ok(writes.some(([layer, name]) => layer === 'background' && name === 'background-color'));
  }
});
