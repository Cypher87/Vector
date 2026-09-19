import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import {
  defaultRadarEventPreferences,
  detectRadarEvents,
  emptyRadarEventMonitorState,
  parseRadarEventPreferences,
  parseRadarEvents,
} from '../src/domain/radar-event.ts';

const aircraft = (id: string, overrides: Partial<Aircraft> = {}): Aircraft => ({
  dbFlags: 0,
  flight: id.toUpperCase(),
  id,
  messages: 10,
  onGround: false,
  seenSeconds: 0,
  source: 'adsb_icao',
  ...overrides,
});

test('initial feed creates no event flood and later detects favorite arrivals', () => {
  const favoriteIds = new Set(['abc123']);
  const initial = detectRadarEvents(
    emptyRadarEventMonitorState(),
    [aircraft('abc123')],
    favoriteIds,
    'live',
    defaultRadarEventPreferences,
    1,
  );
  assert.deepEqual(initial.events, []);

  const absent = detectRadarEvents(initial.state, [], favoriteIds, 'live', defaultRadarEventPreferences, 2);
  const returned = detectRadarEvents(absent.state, [aircraft('abc123')], favoriteIds, 'live', defaultRadarEventPreferences, 3);
  assert.deepEqual(returned.events.map((event) => event.kind), ['favorite-entered']);
});

test('detects emergency squawk changes and receiver recovery once', () => {
  const initial = detectRadarEvents(
    emptyRadarEventMonitorState(),
    [aircraft('abc123')],
    new Set(),
    'live',
    defaultRadarEventPreferences,
    1,
  );
  const emergency = detectRadarEvents(
    initial.state,
    [aircraft('abc123', { squawk: '7700' })],
    new Set(),
    'live',
    defaultRadarEventPreferences,
    2,
  );
  assert.deepEqual(emergency.events.map((event) => event.kind), ['squawk-7700']);

  const offline = detectRadarEvents(emergency.state, [], new Set(), 'offline', defaultRadarEventPreferences, 3);
  assert.deepEqual(offline.events.map((event) => event.kind), ['receiver-offline']);
  const online = detectRadarEvents(offline.state, [], new Set(), 'live', defaultRadarEventPreferences, 4);
  assert.deepEqual(online.events.map((event) => event.kind), ['receiver-online']);
});

test('respects event preferences and safely parses local storage', () => {
  const disabled = { emergency: false, favorite: false, receiver: false };
  const initial = detectRadarEvents(emptyRadarEventMonitorState(), [], new Set(['abc123']), 'live', disabled, 1);
  const next = detectRadarEvents(initial.state, [aircraft('abc123', { squawk: '7500' })], new Set(['abc123']), 'offline', disabled, 2);
  assert.deepEqual(next.events, []);
  assert.deepEqual(parseRadarEventPreferences('{"favorite":false}'), {
    emergency: true,
    favorite: false,
    receiver: true,
  });
  assert.deepEqual(parseRadarEventPreferences('invalid'), defaultRadarEventPreferences);
  assert.deepEqual(parseRadarEvents('[{"id":"bad","kind":"unknown","timestamp":1}]'), []);
});
