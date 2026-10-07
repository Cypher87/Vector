import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft, FeedStatus } from '../src/domain/aircraft.ts';
import { emptyAircraftFilters, type AircraftFilterPreset } from '../src/domain/aircraft-filter-preset.ts';
import { filterMatchDelayMs, filterMatchRearmMs } from '../src/domain/filter-notifications.ts';
import { defaultRadarEventPreferences, detectRadarEvents, emptyRadarEventMonitorState, mergeRadarEvents, parseRadarEvents } from '../src/domain/radar-event.ts';
import { applySyncPreferencePatch, createSyncPreferencePatch, normalizeSyncPreferences } from '../src/sync/preferences.ts';

const helicopter = (overrides: Partial<Aircraft> = {}): Aircraft => ({
  dbFlags: 0, id: 'abc123', flight: 'HELI01', aircraftType: 'H135', category: 'A7',
  onGround: false, seenSeconds: 0, messages: 20, source: 'adsb_icao', altitudeFt: 1_000,
  ...overrides,
});
const rule = (overrides: Partial<AircraftFilterPreset> = {}): AircraftFilterPreset => ({
  id: 'nearby', name: 'Nearby helicopters', sort: 'distance-asc', notifyOnMatch: true,
  filters: { ...emptyAircraftFilters, categories: ['helicopter'], distance: 25 }, ...overrides,
});

function monitor(initialPresets = [rule()]) {
  let state = emptyRadarEventMonitorState();
  let now = 1_800_000_000_000;
  const context = { presets: initialPresets, receiverKey: '52:4', distanceKm: () => 10 as number | undefined };
  const favorites = new Set<string>();
  const preferences = { ...defaultRadarEventPreferences, receiver: false };
  const step = (items: Aircraft[] = [], ms = 1_000, status: FeedStatus = 'live') => {
    now += ms;
    const result = detectRadarEvents(state, items, favorites, status, preferences, now, true, context);
    state = result.state;
    return result.events;
  };
  const observe = (ms: number, items: Aircraft[] = []) => {
    const events = [];
    for (let elapsed = 0; elapsed < ms; elapsed += 1_000) events.push(...step(items));
    return events;
  };
  return { step, observe, context, favorites, preferences, state: () => state, now: () => now };
}

test('startup establishes a baseline, and a new stable match produces one useful filter notification', () => {
  const m = monitor();
  assert.deepEqual(m.step([helicopter()]), []);
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter()]), []);
  const newcomer = helicopter({ id: 'def456', flight: 'HELI02' });
  assert.deepEqual(m.step([helicopter(), newcomer]), []);
  assert.deepEqual(m.observe(filterMatchDelayMs - 1_000, [helicopter(), newcomer]), []);
  const events = m.step([helicopter(), newcomer]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'filter-matched');
  assert.equal(events[0].flight, 'HELI02');
  assert.deepEqual(events[0].matchedFilters, [{ id: 'nearby', name: 'Nearby helicopters' }]);
  assert.deepEqual(m.observe(60_000, [helicopter(), newcomer]), []);
});

test('overlapping filters and favorites share one row and preserve its read state during the cooldown', () => {
  const m = monitor([rule(), rule({ id: 'low', name: 'Low aircraft', filters: { ...emptyAircraftFilters, altitude: { min: null, max: 2_000 } } })]);
  m.favorites.add('abc123');
  m.step();
  const favorite = m.step([helicopter()]);
  assert.equal(favorite[0].kind, 'favorite-entered');
  const matches = m.observe(filterMatchDelayMs, [helicopter()]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchedFilters?.length, 2);
  const merged = mergeRadarEvents([{ ...favorite[0], read: true }], matches, m.now());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].read, true);
  assert.equal(merged[0].kind, 'filter-matched');
  assert.equal(parseRadarEvents(JSON.stringify(merged), m.now())[0].matchedFilters?.length, 2);
});

test('unstable matches never alert and short exits do not rearm an already announced aircraft', () => {
  const m = monitor();
  m.step();
  m.step([helicopter()]);
  m.step([], filterMatchDelayMs - 1);
  m.step([helicopter()]);
  assert.deepEqual(m.observe(filterMatchDelayMs - 1_000, [helicopter()]), []);
  assert.equal(m.step([helicopter()]).length, 1);
  for (let i = 0; i < 3; i++) {
    m.step();
    assert.deepEqual(m.observe(30_000), []);
    assert.deepEqual(m.observe(30_000, [helicopter()]), []);
  }
  m.step();
  m.observe(filterMatchRearmMs - 1_000);
  assert.deepEqual(m.step([helicopter()]), []);
  assert.equal(m.observe(filterMatchDelayMs, [helicopter()]).length, 1);
});

test('stale data, disconnects, long observation gaps and returning from history establish a fresh baseline', () => {
  const m = monitor();
  m.step();
  m.step([helicopter()]);
  assert.deepEqual(m.step([helicopter()], 5_000, 'stale'), []);
  assert.deepEqual(m.step([helicopter()]), []);
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter()]), []);
  m.step([], 1_000, 'offline');
  assert.deepEqual(m.step([helicopter()]), []);
  assert.deepEqual(m.step([helicopter({ id: 'def456' })], 10 * 60_000), []);
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter({ id: 'def456' })]), []);
  assert.deepEqual(m.step([helicopter()], -60_000), []);
  m.step();
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter({ seenSeconds: 90 })]), []);
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter({ seenSeconds: NaN })]), []);
});

test('enabling and editing filters never announce existing matches; renaming preserves pending matches', () => {
  const m = monitor([rule({ notifyOnMatch: false })]);
  m.step([helicopter()]);
  m.context.presets = [rule()];
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter()]), []);
  m.context.presets = [rule({ filters: { ...emptyAircraftFilters, altitude: { min: null, max: 5_000 } } })];
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter()]), []);
  const newcomer = helicopter({ id: 'def456' });
  m.step([newcomer]);
  m.context.presets = m.context.presets.map((preset) => ({ ...preset, name: 'Renamed', sort: 'altitude-desc' }));
  assert.equal(m.observe(filterMatchDelayMs, [newcomer])[0]?.matchedFilters?.[0].name, 'Renamed');
  m.context.presets = [];
  m.step([newcomer]);
  assert.equal(m.state().filters.size, 0);
});

test('distance and favorites use the filter matcher, and context changes do not manufacture arrivals', () => {
  const m = monitor();
  m.context.distanceKm = () => undefined;
  m.step();
  assert.deepEqual(m.observe(filterMatchDelayMs * 2, [helicopter()]), []);
  m.context.distanceKm = () => 30;
  assert.deepEqual(m.observe(filterMatchDelayMs * 2, [helicopter()]), []);
  m.context.distanceKm = () => 24;
  m.step([helicopter()]);
  assert.equal(m.observe(filterMatchDelayMs, [helicopter()]).length, 1);
  m.context.receiverKey = '53:5';
  assert.deepEqual(m.observe(filterMatchDelayMs, [helicopter()]), []);
  m.context.presets = [rule({ filters: { ...emptyAircraftFilters, favoritesOnly: true } })];
  m.preferences.favorite = false;
  m.step([helicopter()]);
  m.favorites.add('abc123');
  assert.deepEqual(m.observe(filterMatchDelayMs * 2, [helicopter()]), []);
});

test('emergency alerts remain immediate and suppress redundant filter alerts for that sighting', () => {
  const m = monitor();
  m.step();
  assert.equal(m.step([helicopter({ squawk: '7700' })])[0]?.kind, 'squawk-7700');
  assert.deepEqual(m.observe(filterMatchDelayMs * 2, [helicopter({ squawk: '7700' })]), []);
  assert.deepEqual(m.step([helicopter()]), []);
  m.preferences.emergency = false;
  const newcomer = helicopter({ id: 'def456', squawk: '7600' });
  m.step([newcomer]);
  assert.equal(m.observe(filterMatchDelayMs, [newcomer])[0]?.kind, 'filter-matched');
});

test('unfiltered presets cannot notify, and absence removes old contacts from monitor memory', () => {
  const m = monitor([rule({ filters: emptyAircraftFilters })]);
  m.step();
  assert.deepEqual(m.observe(filterMatchDelayMs * 2, [helicopter()]), []);
  assert.equal(m.state().filters.size, 0);
  m.context.presets = [rule()];
  m.step([helicopter()]);
  m.observe(filterMatchRearmMs + 1_000);
  assert.equal(m.state().filters.get('nearby')?.contacts.size, 0);
});

test('filter notification opt-in synchronizes and invalid or legacy values stay off', () => {
  const before = { filterPresets: [rule({ notifyOnMatch: false })] };
  const after = { filterPresets: [rule()] };
  const patch = createSyncPreferencePatch(before, after);
  assert.equal(applySyncPreferencePatch(before, patch).filterPresets?.[0].notifyOnMatch, true);
  assert.equal(applySyncPreferencePatch(after, createSyncPreferencePatch(after, before)).filterPresets?.[0].notifyOnMatch, false);
  assert.equal(normalizeSyncPreferences({ filterPresets: [{ ...rule(), notifyOnMatch: 'true' }] }).filterPresets?.[0].notifyOnMatch, undefined);
  const { notifyOnMatch: omitted, ...legacy } = rule();
  assert.equal(omitted, true);
  assert.equal(normalizeSyncPreferences({ filterPresets: [legacy] }).filterPresets?.[0].notifyOnMatch, undefined);
  assert.deepEqual(parseRadarEvents(JSON.stringify([{
    id: 'bad', kind: 'filter-matched', aircraftId: 'abc123', timestamp: Date.now(),
    matchedFilters: [{ id: '../invalid', name: 'bad' }],
  }])), []);
});
