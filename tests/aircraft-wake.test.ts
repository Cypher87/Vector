import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import { aircraftIconDefinition } from '../src/map/aircraft-icon-definition.ts';
import { aircraftWake, aircraftWakeZoomOpacity, aircraftWakeZoomProfile, maximumAircraftWakeScreenLength } from '../src/map/aircraft-wake.ts';

test('wake opacity fades smoothly over the zoom band and stays bounded', () => {
  for (const zoom of [-1, 0, 6.5, 6.6, NaN, Infinity, -Infinity]) assert.equal(aircraftWakeZoomOpacity(zoom), 0);
  for (const zoom of [7.2, 8, 24]) assert.equal(aircraftWakeZoomOpacity(zoom), 1);
  assert.ok(Math.abs(aircraftWakeZoomOpacity(6.9) - 0.5) < 1e-10);
  let previous = 0;
  for (let step = 1; step <= 60; step++) {
    const opacity = aircraftWakeZoomOpacity(6.6 + step / 100);
    assert.ok(opacity >= previous && opacity <= 1);
    assert.ok(opacity - previous < 0.026, 'no abrupt opacity jumps');
    previous = opacity;
  }
  assert.ok(aircraftWakeZoomOpacity(6.61) < 0.001);
  assert.ok(aircraftWakeZoomOpacity(7.19) > 0.999);
});

test('overview trails are short and fade earlier, with a smooth transition to local detail', () => {
  const overview = { lengthScale: .16, middleOpacity: .12, tailOpacity: .025 };
  for (const zoom of [NaN, Infinity, -Infinity, -1, 6, 6.5]) {
    assert.deepEqual(aircraftWakeZoomProfile(zoom), overview);
  }
  const full = aircraftWakeZoomProfile(11.5);
  assert.equal(full.lengthScale, 1);
  assert.ok(Math.abs(full.middleOpacity - .28) < 1e-10);
  assert.equal(full.tailOpacity, .12);
  assert.deepEqual(aircraftWakeZoomProfile(24), full);
  assert.ok(maximumAircraftWakeScreenLength * overview.lengthScale < 62);
  let previous = overview;
  for (let step = 1; step <= 500; step++) {
    const profile = aircraftWakeZoomProfile(6.5 + step / 100);
    for (const key of ['lengthScale', 'middleOpacity', 'tailOpacity'] as const) {
      assert.ok(profile[key] >= previous[key] && profile[key] <= full[key]);
      assert.ok(profile[key] - previous[key] < .005, 'no threshold jumps');
    }
    previous = profile;
  }
  assert.ok(Math.abs(aircraftWakeZoomProfile(8).lengthScale - .58) < 1e-10);
  assert.ok(Math.abs(aircraftWakeZoomProfile(7.2).lengthScale - .2758577777777778) < 1e-10);
  assert.ok(aircraftWakeZoomProfile(8.2).lengthScale > overview.lengthScale);
  assert.equal(aircraftWakeZoomProfile(8.2).middleOpacity, overview.middleOpacity);
  assert.equal(aircraftWakeZoomProfile(8.2).tailOpacity, overview.tailOpacity);
  assert.equal(aircraftWakeZoomProfile(9.5).lengthScale, 1);
  assert.ok(aircraftWakeZoomProfile(9.5).middleOpacity < full.middleOpacity, 'fade curve stays unchanged');
});

const aircraft = (patch: Partial<Aircraft> = {}): Aircraft => ({
  id: 'abc123', flight: 'TEST', onGround: false, source: 'adsb_icao', seenSeconds: 0,
  messages: 1, dbFlags: 0, latitude: 52, longitude: 5, groundSpeedKts: 200,
  trackDeg: 90, aircraftType: 'A320', ...patch,
});
const wake = (patch: Partial<Aircraft> = {}) => {
  const item = aircraft(patch);
  return aircraftWake(item, aircraftIconDefinition(item).name);
};

test('powered families have appropriate airflow cues', () => {
  for (const [aircraftType, description, category, style, engines] of [
    ['A320', 'L2J', 'A3', 'jet', 2], ['B744', 'L4J', 'A5', 'jet', 4],
    ['MD11', 'L3J', 'A5', 'jet', 3], ['A225', 'L6J', 'A5', 'jet', 6],
    ['C25A', 'L2J', 'A2', 'jet', 2], ['F16', 'L1J', 'A6', 'jet', 1],
    ['C172', 'L1P', 'A1', 'propeller', 1], ['PA34', 'L2P', 'A1', 'propeller', 2],
    ['AT76', 'L2T', 'A3', 'turboprop', 2], ['PC12', 'L1T', 'A1', 'turboprop', 1],
    ['C130', 'L4T', 'A3', 'turboprop', 4], ['ZZZZ', 'L1P', 'B4', 'propeller', 1],
    ['ZZZZ', 'L1E', 'B6', 'propeller', 1], ['ZZZZ', 'L1J', 'B6', 'jet', 1],
  ] as const) {
    const result = wake({ aircraftType, description, category })!;
    assert.equal(result.style, style, aircraftType);
    assert.equal(result.origins.length, engines, aircraftType);
    assert.ok(result.origins.every(([x, y]) => x >= 0 && x <= 40 && y >= 20 && y <= 40));
  }
});

test('known engine metadata overrides a broad family fallback', () => {
  assert.equal(wake({ aircraftType: 'ZZZZ', category: 'A3', description: 'L2P' })?.style, 'propeller');
  assert.equal(wake({ aircraftType: 'PC12', description: 'L1T' })?.origins.length, 1);
  assert.equal(wake({ aircraftType: 'C25A', description: 'L3J' })?.origins.length, 3);
  assert.equal(wake({ aircraftType: 'B744' })?.origins.length, 4);
  assert.equal(wake({ aircraftType: 'C172' })?.style, 'propeller');
});

test('gliders, balloons, rotorcraft, ground contacts and ambiguous types have no wake', () => {
  for (const patch of [
    { aircraftType: 'GLID', description: 'L1J' }, // A motor glider is not necessarily using its motor.
    { aircraftType: 'BALL' }, { aircraftType: 'SHIP' }, { aircraftType: 'H145', description: 'H2T' },
    { aircraftType: 'ZZZZ', description: 'G1P' }, { aircraftType: 'ZZZZ', category: 'B3' },
    { aircraftType: 'SERV', category: 'C2' }, { aircraftType: 'ZZZZ', category: 'A0' },
    { aircraftType: 'ZZZZ', category: 'B4' }, { aircraftType: 'ZZZZ', category: 'B6' },
    { aircraftType: 'ZZZZ', category: 'B6', description: 'H4E' },
  ]) assert.equal(wake(patch), undefined, JSON.stringify(patch));
});

test('wake requires a fresh airborne position, known direction and enough speed', () => {
  for (const patch of [
    { onGround: true }, { groundSpeedKts: 0 }, { groundSpeedKts: 29.9 },
    { groundSpeedKts: undefined }, { groundSpeedKts: Infinity },
    { trackDeg: undefined }, { trackDeg: NaN }, { latitude: undefined },
    { seenSeconds: 9 }, { positionSeenSeconds: 8 },
  ]) assert.equal(wake(patch), undefined, JSON.stringify(patch));
  assert.ok(wake({ groundSpeedKts: 30, trackDeg: 0 }));
});

test('higher speed lengthens and speeds up trails, with bounded lengths', () => {
  for (const [aircraftType, description, maximum] of [
    ['A320', 'L2J', 475], ['AT76', 'L2T', 300], ['C172', 'L1P', 200],
  ] as const) {
    const slow = wake({ aircraftType, description, groundSpeedKts: 40 })!;
    const fast = wake({ aircraftType, description, groundSpeedKts: 160 })!;
    const extreme = wake({ aircraftType, description, groundSpeedKts: 10_000 })!;
    assert.ok(fast.length > slow.length);
    assert.ok(fast.duration < slow.duration);
    assert.equal(extreme.length, maximum);
    assert.ok(extreme.length * 32.4 / 40 <= maximumAircraftWakeScreenLength);
    assert.ok(slow.width * 32.4 / 40 >= 2, 'the stroke covers at least two CSS pixels before rotation');
    assert.ok(extreme.duration >= 1.4);
  }
});

test('all powered trail lengths are halved while retaining family-specific width and flow speed', () => {
  for (const [aircraftType, description, groundSpeedKts, length, width, duration] of [
    ['A320', 'L2J', 400, 405, 2.5, 1.6],
    ['AT76', 'L2T', 200, 229.2, 2.7, 1.73],
    ['C172', 'L1P', 90, 131.3, 2.9, 1.9],
  ] as const) {
    const result = wake({ aircraftType, description, groundSpeedKts })!;
    assert.equal(result.length, length);
    assert.equal(result.width, width);
    assert.equal(result.duration, duration);
  }
});
