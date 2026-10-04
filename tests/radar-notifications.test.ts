import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft, FeedStatus } from '../src/domain/aircraft.ts';
import {
  defaultRadarEventPreferences, detectRadarEvents, emptyRadarEventMonitorState,
  favoriteAbsenceMs, mergeRadarEvents, parseRadarEvents,
  radarEventCooldownMs, radarEventRetentionMs, receiverAlertDelayMs,
  type RadarEvent, type RadarEventKind,
} from '../src/domain/radar-event.ts';

const aircraft = (id = 'abc123', overrides: Partial<Aircraft> = {}): Aircraft => ({
  dbFlags: 0, flight: id.toUpperCase(), id, messages: 10, onGround: false,
  seenSeconds: 0, source: 'adsb_icao', ...overrides,
});
const now = 1_800_000_000_000;
const event = (kind: RadarEventKind, timestamp = now, read = false, aircraftId = 'abc123'): RadarEvent => ({
  id: `${timestamp}-${kind}-${aircraftId}`, kind, timestamp, read,
  ...(kind.startsWith('receiver-') ? {} : { aircraftId }),
});

function monitor() {
  let state = emptyRadarEventMonitorState();
  let timestamp = now;
  const favorites = new Set(['abc123']);
  const preferences = { ...defaultRadarEventPreferences };
  const step = (items: Aircraft[] = [], status: FeedStatus = 'live', ms = 1_000, visible = true) => {
    timestamp += ms;
    const result = detectRadarEvents(state, items, favorites, status, preferences, timestamp, visible);
    state = result.state;
    return result.events;
  };
  const observeFor = (ms: number, items: Aircraft[] = [], status: FeedStatus = 'live', visible = true) => {
    const events: RadarEvent[] = [];
    for (let elapsed = 0; elapsed < ms; elapsed += 1_000) events.push(...step(items, status, 1_000, visible));
    return events;
  };
  return { step, observeFor, favorites, preferences };
}

test('connecting/empty startup and the first live snapshot do not announce existing favorites', () => {
  const m = monitor();
  assert.deepEqual(m.step([], 'connecting'), []);
  assert.deepEqual(m.step([], 'offline'), []);
  assert.deepEqual(m.step([aircraft()]), []);
});

test('a new favorite is announced; brief gaps are ignored; five observed minutes rearm arrivals', () => {
  const m = monitor();
  m.step();
  assert.deepEqual(m.step([aircraft()]).map((e) => e.kind), ['favorite-entered']);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(m.step(), []);
    assert.deepEqual(m.step([aircraft()]), []);
  }
  m.step();
  m.observeFor(favoriteAbsenceMs - 2_000);
  assert.deepEqual(m.step([aircraft()]), []);
  m.step();
  m.observeFor(favoriteAbsenceMs);
  assert.deepEqual(m.step([aircraft()]).map((e) => e.kind), ['favorite-entered']);
});

test('favoriting an aircraft already present never counts as an arrival', () => {
  const m = monitor();
  m.favorites.clear();
  m.step([aircraft()]);
  m.favorites.add('abc123');
  assert.deepEqual(m.step([aircraft()]), []);
  m.favorites.clear();
  m.step([aircraft()]);
  m.favorites.add('abc123');
  assert.deepEqual(m.step([aircraft()]), []);
});

test('stale snapshots, reconnects and sleep do not manufacture favorite arrivals', () => {
  const m = monitor();
  m.step([aircraft()]);
  m.observeFor(favoriteAbsenceMs, [], 'stale');
  assert.deepEqual(m.step([aircraft()]), []);
  assert.deepEqual(m.step([], 'offline'), []);
  assert.deepEqual(m.step([aircraft()]), []);
  m.step();
  assert.deepEqual(m.step([aircraft()], 'live', 10 * 60_000), []);
  assert.deepEqual(m.step([aircraft()], 'live', -60_000), []);
  assert.deepEqual(m.step([aircraft('def456', { squawk: '7700' })], 'stale'), []);
});

test('stale per-aircraft data is not a fresh arrival or emergency', () => {
  const m = monitor();
  m.step();
  assert.deepEqual(m.step([aircraft('abc123', { seenSeconds: 90, squawk: '7700' })]), []);
  assert.deepEqual(m.step([aircraft('abc123', { seenSeconds: NaN, squawk: '7700' })]), []);
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7700' })]).map((e) => e.kind), ['squawk-7700']);
});

test('emergency codes remain immediate on startup, change and in background tabs, not on short gaps', () => {
  const m = monitor();
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7700' })]).map((e) => e.kind), ['squawk-7700']);
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7700' })]), []);
  m.step();
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7700' })]), []);
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7600' })], 'live', 1_000, false).map((e) => e.kind), ['squawk-7600']);
  m.step([aircraft('abc123', { squawk: '1200' })]);
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7500' })]).map((e) => e.kind), ['squawk-7500']);
});

test('emergencies take precedence over simultaneous favorite arrivals', () => {
  const m = monitor();
  m.step();
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7700' })]).map((e) => e.kind), ['squawk-7700']);
});

test('brief delays and short outages never produce recovery-only notifications', () => {
  const m = monitor();
  m.step();
  m.observeFor(60_000, [], 'stale');
  assert.deepEqual(m.step(), []);
  assert.deepEqual(m.observeFor(receiverAlertDelayMs, [], 'offline'), []);
  assert.deepEqual(m.step(), []);
});

test('a sustained visible outage is announced once and can recover in a background tab', () => {
  const m = monitor();
  m.step();
  assert.deepEqual(m.step([], 'offline'), []);
  assert.deepEqual(m.observeFor(receiverAlertDelayMs, [], 'offline').map((e) => e.kind), ['receiver-offline']);
  assert.deepEqual(m.observeFor(90_000, [], 'offline'), []);
  assert.deepEqual(m.step([], 'live', 1_000, false).map((e) => e.kind), ['receiver-online']);
  assert.deepEqual(m.step(), []);
});

test('hidden tabs, sleep and clock changes do not manufacture receiver incidents', () => {
  const m = monitor();
  m.step();
  assert.deepEqual(m.observeFor(120_000, [], 'offline', false), []);
  assert.deepEqual(m.step(), []);
  m.step([], 'offline');
  assert.deepEqual(m.step([], 'offline', 10 * 60_000), []);
  assert.deepEqual(m.step(), []);
  m.step([], 'offline');
  assert.deepEqual(m.step([], 'offline', -60_000), []);
  assert.deepEqual(m.step(), []);
});

test('disabled notification preferences do not enqueue alerts for later enabling', () => {
  const m = monitor();
  Object.assign(m.preferences, { emergency: false, favorite: false, receiver: false });
  m.step();
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7500' })]), []);
  assert.deepEqual(m.observeFor(120_000, [], 'offline'), []);
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7500' })]), []);
  Object.assign(m.preferences, defaultRadarEventPreferences);
  assert.deepEqual(m.step([aircraft('abc123', { squawk: '7500' })]), []);
});

test('repeats update one row and do not re-arm a read badge within the cooldown', () => {
  let events = [event('favorite-entered', now, true)];
  for (let i = 1; i <= 5; i++) {
    events = mergeRadarEvents(events, [event('favorite-entered', now + i * 60_000)], now + i * 60_000);
    assert.equal(events.length, 1);
    assert.equal(events[0].read, true);
  }
  const later = now + 5 * 60_000 + radarEventCooldownMs;
  events = mergeRadarEvents(events, [event('favorite-entered', later)], later);
  assert.equal(events.length, 1);
  assert.equal(events[0].read, false);
  assert.equal(events[0].timestamp, later);
});

test('receiver changes share one row and recovery never adds another unread badge', () => {
  let events = mergeRadarEvents([], [event('receiver-offline')], now);
  events = mergeRadarEvents(events, [event('receiver-online', now + 60_000)], now + 60_000);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'receiver-online');
  assert.equal(events[0].read, false);
  events[0] = { ...events[0], read: true };
  events = mergeRadarEvents(events, [event('receiver-offline', now + 120_000)], now + 120_000);
  assert.equal(events[0].read, true);
  assert.equal(mergeRadarEvents([], [event('receiver-online')], now)[0].read, true);
});

test('different aircraft and emergency codes remain separate and unread', () => {
  const events = mergeRadarEvents([event('squawk-7700', now - 1_000, true)], [
    event('squawk-7600'), event('squawk-7700', now, false, 'def456'),
  ], now);
  assert.equal(events.length, 3);
  assert.equal(events.filter((e) => !e.read).length, 2);
});

test('legacy duplicates are consolidated and expired/malformed rows removed on load', () => {
  const events = parseRadarEvents(JSON.stringify([
    event('favorite-entered', now - 1_000), event('favorite-entered', now, true),
    event('receiver-online'), event('receiver-offline', now - 2_000),
    event('squawk-7700', now - radarEventRetentionMs - 1), event('squawk-7500', now + 120_000),
    event('squawk-7600', now, false, 'invalid'), { id: 'bad', kind: 'unknown', timestamp: now },
  ]), now);
  assert.equal(events.length, 2);
  assert.equal(events.find((e) => e.kind === 'favorite-entered')?.read, true);
  assert.equal(events.find((e) => e.kind === 'receiver-offline'), undefined);
  assert.deepEqual(parseRadarEvents('invalid', now), []);
  // Non-ICAO contacts use a leading tilde, just like the stored favorites.
  assert.equal(parseRadarEvents(JSON.stringify([event('favorite-entered', now, false, '~ABC123')]), now)[0]?.aircraftId, '~abc123');
});

test('notifications expire during use, stay bounded and ignore older incoming copies', () => {
  const stored = [event('favorite-entered')];
  assert.equal(mergeRadarEvents(stored, [], now), stored);
  assert.deepEqual(mergeRadarEvents(stored, [], now + radarEventRetentionMs + 1), []);
  assert.equal(mergeRadarEvents(stored, [event('favorite-entered', now - 1_000)], now), stored);
  const many = Array.from({ length: 120 }, (_, i) => event('favorite-entered', now - i, false, i.toString(16).padStart(6, '0')));
  assert.equal(mergeRadarEvents([], many, now).length, 100);
});
