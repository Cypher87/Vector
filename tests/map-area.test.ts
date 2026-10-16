import assert from 'node:assert/strict';
import test from 'node:test';
import { areaContains, areaOutline, drawingMapArea, normalizeMapArea, relocateCircleDrawing, type AreaDrawing, type MapArea } from '../src/domain/map-area.ts';
import { emptyAircraftFilters, matchesAircraftFilters, normalizeAircraftFilters } from '../src/domain/aircraft-filters.ts';
import { normalizeAircraftFilterPresets, type AircraftFilterPreset } from '../src/domain/aircraft-filter-preset.ts';
import { observeFilterNotifications, filterMatchRearmMs, type FilterNotificationState } from '../src/domain/filter-notifications.ts';
import { applySyncPreferencePatch, createSyncPreferencePatch } from '../src/sync/preferences.ts';
import type { Aircraft } from '../src/domain/aircraft.ts';

const circle: MapArea = { kind: 'circle', center: [4.8, 52.3], radiusKm: 20 };
const plane: Aircraft = { id: 'abc123', flight: 'HELI1', aircraftType: 'H135', category: 'A7', latitude: 52.3, longitude: 4.8,
  seenSeconds: 0, onGround: false, source: 'adsb_icao', messages: 1, dbFlags: 0, altitudeFt: 1000 };
const preset: AircraftFilterPreset = { id: 'area', name: 'Local helicopters', sort: 'altitude-desc', notifyOnMatch: true,
  filters: { ...emptyAircraftFilters, area: circle, categories: ['helicopter'], altitude: { min: null, max: 2000 } } };

test('circles use real distance, include their boundary and wrap across the date line', () => {
  assert.equal(areaContains(circle, 4.8, 52.3), true);
  assert.equal(areaContains(circle, 5.8, 52.3), false);
  assert.ok(areaOutline(circle).every(([lon, lat]) => areaContains(circle, lon, lat)));
  const seam: MapArea = { kind: 'circle', center: [179.95, 0], radiusKm: 20 };
  assert.equal(areaContains(seam, -179.95, 0), true);
  assert.equal(areaContains(seam, 0, 0), false);
});

test('concave polygons, boundaries and date-line polygons select only the drawn region', () => {
  const area = normalizeMapArea({ kind: 'polygon', points: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]] });
  assert.ok(area);
  for (const [lon, lat] of [[.5, 1.5], [1.5, .5], [0, 1], [1, 1]]) assert.equal(areaContains(area, lon, lat), true);
  assert.equal(areaContains(area, 1.5, 1.5), false);
  const seam = normalizeMapArea({ kind: 'polygon', points: [[179, -1], [-179, -1], [-179, 1], [179, 1]] });
  assert.ok(seam);
  assert.equal(areaContains(seam, 179.5, 0), true);
  assert.equal(areaContains(seam, -179.5, 0), true);
  assert.equal(areaContains(seam, 0, 0), false);
});

test('invalid, unbounded or crossing geometry cannot become an alert rule', () => {
  for (const value of [null, {}, { ...circle, radiusKm: Infinity }, { ...circle, radiusKm: -.1 }, { ...circle, radiusKm: 501 },
    { ...circle, center: [NaN, 52] }, { ...circle, center: [4, 90] },
    { kind: 'polygon', points: [[0, 0], [1, 1]] }, { kind: 'polygon', points: [[0, 0], [1, 1], [2, 2]] },
    { kind: 'polygon', points: [[0, 0], [1, 1], [0, 1], [1, 0]] },
    { kind: 'polygon', points: Array(33).fill([4, 52]) }]) assert.equal(normalizeMapArea(value), undefined);
  assert.deepEqual(normalizeAircraftFilterPresets([{ ...preset, filters: { area: { ...circle, radiusKm: -1 } } }]), []);
  assert.deepEqual(normalizeAircraftFilters({}).area, null);
  assert.equal(drawingMapArea({ kind: 'circle', points: [] }), undefined);
  assert.deepEqual(drawingMapArea({ kind: 'circle', points: [circle.center], radiusKm: 20 }), circle);
});

test('area filtering is ANDed with other criteria and requires a fresh measured position', () => {
  const filters = preset.filters;
  const match = (patch: Partial<Aircraft> = {}) => matchesAircraftFilters({ ...plane, ...patch }, filters, { favoriteIds: new Set() });
  assert.equal(match(), true);
  for (const patch of [{ longitude: 10 }, { latitude: undefined }, { longitude: NaN }, { positionSeenSeconds: 21 },
    { positionSeenSeconds: Infinity }, { aircraftType: 'A320', category: 'A3' }, { altitudeFt: 3000 }]) assert.equal(match(patch), false);
  assert.equal(match({ positionSeenSeconds: 0, seenSeconds: 30 }), true);
});

test('moving a circle preserves entered or measured radius without mutating the original drawing', () => {
  const original: AreaDrawing = { kind: 'circle', points: [[4.8, 52.3], [4.9, 52.3]] };
  const before = drawingMapArea(original);
  const moved = relocateCircleDrawing(original, [5, 53]);
  assert.deepEqual(moved.points, [[5, 53]]);
  assert.equal(drawingMapArea(moved)?.kind, 'circle');
  assert.equal(moved.radiusKm, before?.kind === 'circle' ? before.radiusKm : undefined);
  assert.deepEqual(original.points, [[4.8, 52.3], [4.9, 52.3]]);
  assert.equal(relocateCircleDrawing({ ...original, radiusKm: 30 }, [-179, 40]).radiusKm, 30);
  assert.deepEqual(relocateCircleDrawing({ kind: 'circle', points: [[4, 52]] }, [181, 90]), { kind: 'circle', points: [[-179, 85]] });
  assert.equal(relocateCircleDrawing(original, [NaN, 52]), original);
  const polygon: AreaDrawing = { kind: 'polygon', points: [[0, 0], [1, 0], [0, 1]] };
  assert.equal(relocateCircleDrawing(polygon, [2, 2]), polygon);
});

test('area filters and visibility synchronize per field and per saved filter without overwriting other device edits', () => {
  const before = { aircraftFilters: emptyAircraftFilters, filterPresets: [preset], mapAreas: true };
  const edited = { ...preset, filters: { ...preset.filters, area: { ...circle, radiusKm: 30 } as MapArea } };
  const patch = createSyncPreferencePatch(before, { ...before, aircraftFilters: { ...emptyAircraftFilters, area: circle }, filterPresets: [edited], mapAreas: false });
  const concurrent = { ...before, aircraftFilters: { ...emptyAircraftFilters, favoritesOnly: true }, filterPresets: [preset, { ...preset, id: 'other', name: 'Other' }] };
  const merged = applySyncPreferencePatch(concurrent, patch);
  assert.equal(merged.aircraftFilters?.favoritesOnly, true);
  assert.deepEqual(merged.aircraftFilters?.area, circle);
  assert.deepEqual(merged.filterPresets?.find((p) => p.id === 'area')?.filters.area, edited.filters.area);
  assert.equal(merged.filterPresets?.length, 2);
  assert.equal(merged.mapAreas, false);
  assert.equal(applySyncPreferencePatch(merged, { aircraftFilters: { area: null } }).aircraftFilters?.area, null);
  assert.deepEqual(applySyncPreferencePatch(merged, { aircraftFilters: { area: { kind: 'circle', radiusKm: -1 } } }).aircraftFilters?.area, circle);
});

test('area alerts require stable matches and observed exits; position gaps and changes within the area do not repeat alerts', () => {
  let state: FilterNotificationState = new Map();
  let timestamp = 0;
  const context = { presets: [preset], receiverKey: '', distanceKm: () => undefined };
  const observe = (aircraft: Aircraft[], elapsed = 1000, baseline = false) => {
    timestamp += elapsed;
    const next = observeFilterNotifications(state, aircraft, new Set(), context, timestamp, baseline);
    state = next.state;
    return next.matches.size;
  };
  assert.equal(observe([], 0, true), 0);
  assert.equal(observe([plane]), 0);
  assert.equal(observe([plane], 10_000), 1);
  assert.equal(observe([], filterMatchRearmMs + 1000), 0);
  assert.equal(observe([plane]), 0);
  assert.equal(observe([{ ...plane, altitudeFt: 3000 }]), 0);
  assert.equal(observe([{ ...plane, altitudeFt: 3000 }], filterMatchRearmMs + 1000), 0);
  assert.equal(observe([plane], 10_000), 0);
  assert.equal(observe([{ ...plane, longitude: 8 }]), 0);
  assert.equal(observe([{ ...plane, longitude: 8 }], filterMatchRearmMs + 1000), 0);
  assert.equal(observe([plane]), 0);
  assert.equal(observe([plane], 10_000), 1);
  context.presets = [{ ...preset, filters: { ...preset.filters, area: { ...circle, radiusKm: 25 } } }];
  assert.equal(observe([plane], 10_000), 0);
  assert.equal(observe([plane], 10_000), 0);
});
