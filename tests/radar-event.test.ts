import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import {
  defaultRadarEventPreferences,
  detectRadarEvents,
  emptyRadarEventMonitorState,
  parseRadarEventPreferences,
  parseRadarEvents,
  receiverAlertDelayMs,
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

test('offline callsign favorites notify on arrival, not startup, brief gaps or adding an already-live flight', () => {
  const ids = new Set<string>();
  const callsigns = new Set(['KLM123']);
  const contact = aircraft('abc123', { flight: 'KLM123' });
  const observe = (state: ReturnType<typeof emptyRadarEventMonitorState>, items: Aircraft[], timestamp: number, saved = callsigns) =>
    detectRadarEvents(state, items, ids, 'live', defaultRadarEventPreferences, timestamp, true, undefined, saved);
  const absent = observe(emptyRadarEventMonitorState(), [], 0);
  const entered = observe(absent.state, [contact], 1000);
  assert.deepEqual(entered.events.map((event) => [event.kind, event.aircraftId]), [['favorite-entered', 'abc123']]);
  assert.equal(observe(emptyRadarEventMonitorState(), [contact], 0).events.length, 0);
  const removed = observe(entered.state, [], 2000);
  assert.equal(observe(removed.state, [{ ...contact, id: 'def456' }], 3000).events.length, 0);
  const notSaved = observe(emptyRadarEventMonitorState(), [contact], 0, new Set());
  assert.equal(observe(notSaved.state, [contact], 1000).events.length, 0);
  assert.equal(observe(absent.state, [{ ...contact, flight: 'KLM1234' }], 1000).events.length, 0);
});

test('initial feed and short reception gaps create no favorite arrival flood', () => {
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
  assert.deepEqual(returned.events, []);
});

test('registration favorite arrivals are exact, deduplicated with callsigns and not repeated by callsign changes', () => {
  const registrations = new Set(['PH-HLP']);
  const contact = aircraft('abc123', { flight: 'KLM123', registration: 'ph-hlp' });
  const observe = (state: ReturnType<typeof emptyRadarEventMonitorState>, items: Aircraft[], time: number, callsigns = new Set<string>()) =>
    detectRadarEvents(state, items, new Set(), 'live', defaultRadarEventPreferences, time, true, undefined, callsigns, registrations);
  const absent = observe(emptyRadarEventMonitorState(), [], 0, new Set(['KLM123']));
  const entered = observe(absent.state, [contact], 1000, new Set(['KLM123']));
  assert.deepEqual(entered.events.map((event) => [event.kind, event.aircraftId]), [['favorite-entered', 'abc123']]);
  assert.equal(observe(entered.state, [{ ...contact, flight: 'NEW' }], 2000).events.length, 0);
  assert.equal(observe(emptyRadarEventMonitorState(), [contact], 0).events.length, 0);
  assert.equal(observe(absent.state, [{ ...contact, flight: 'PHHLP', registration: 'PH-HLPX' }], 1000).events.length, 0);
  const gap = observe(entered.state, [], 2000);
  assert.equal(observe(gap.state, [contact], 3000).events.length, 0);
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
  assert.deepEqual(offline.events, []);
  const sustained = detectRadarEvents(offline.state, [], new Set(), 'offline', defaultRadarEventPreferences, 3 + receiverAlertDelayMs);
  assert.deepEqual(sustained.events.map((event) => event.kind), ['receiver-offline']);
  const online = detectRadarEvents(sustained.state, [], new Set(), 'live', defaultRadarEventPreferences, 4 + receiverAlertDelayMs);
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
