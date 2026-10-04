import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import { aircraftKind } from '../src/domain/aircraft-kind.ts';
import { aircraftIconDefinition, aircraftIconTransform } from '../src/map/aircraft-icon-definition.ts';

const aircraft = (patch: Partial<Aircraft> = {}): Aircraft => ({
  id: 'abc123', flight: 'TEST', onGround: false, source: 'adsb_icao',
  seenSeconds: 0, messages: 1, dbFlags: 0, ...patch,
});

test('missing type and non-informative categories use a neutral contact, not an airplane', () => {
  for (const category of [undefined, '', 'A0', 'B0']) {
    const icon = aircraftIconDefinition(aircraft({ category }));
    assert.equal(icon.name, 'unknown-contact-dot');
    assert.ok(icon.shape.path);
    assert.equal(icon.shape.accent, undefined); // No question mark or extra decoration.
    for (const rotation of [-45, 0, 90, 270, 360]) {
      assert.equal(aircraftIconTransform(icon, rotation), 'rotate(0deg) scale(1)');
    }
  }
});

test('placeholder types do not imply a light aircraft, but known categories still apply', () => {
  for (const aircraftType of ['ZZZZ', 'UNKN', 'UNKNOWN', 'N/A', '?', ' ']) {
    const item = aircraft({ aircraftType });
    assert.equal(aircraftKind(item), 'unknown');
    assert.equal(aircraftIconDefinition(item).name, 'unknown-contact-dot');
    assert.equal(aircraftIconDefinition({ ...item, category: 'A7' }).name, 'helicopter');
    assert.equal(aircraftIconDefinition({ ...item, category: 'B2' }).name, 'balloon');
  }
});

test('known categories and descriptions keep their silhouettes without an exact type code', () => {
  for (const [category, name] of [
    ['A1', 'cessna'], ['A3', 'airliner'], ['A5', 'heavy_2e'], ['A7', 'helicopter'],
    ['B1', 'glider'], ['B2', 'balloon'], ['B6', 'uav'],
  ]) assert.equal(aircraftIconDefinition(aircraft({ category })).name, name);
  for (const [description, name] of [['H2T', 'helicopter'], ['G1P', 'gyrocopter'], ['L1P', 'cessna']]) {
    const icon = aircraftIconDefinition(aircraft({ description }));
    assert.equal(icon.name, name);
    assert.match(aircraftIconTransform(icon, 90), /^rotate\(90deg\)/);
  }
});

test('known aircraft and ground vehicles never use the generic aircraft fallback', () => {
  assert.equal(aircraftIconDefinition(aircraft({ aircraftType: 'C172' })).name, 'cessna');
  assert.equal(aircraftIconDefinition(aircraft({ aircraftType: 'EC35' })).name, 'helicopter');
  assert.equal(aircraftIconDefinition(aircraft({ aircraftType: 'BALL' })).name, 'balloon');
  assert.equal(aircraftIconDefinition(aircraft({ aircraftType: 'GLID' })).name, 'glider');
  // Ground catalog entries have no supported path: do not fall back to an airplane.
  assert.equal(aircraftIconDefinition(aircraft({ aircraftType: 'SERV', onGround: true })).name, 'unknown-contact-dot');
  assert.equal(aircraftIconDefinition(aircraft({ category: 'C0', onGround: true })).name, 'unknown-contact-dot');
  const known = aircraftIconDefinition(aircraft({ aircraftType: 'A320' }));
  assert.notEqual(known.name, 'unknown-contact-dot');
  assert.match(aircraftIconTransform(known, 213), /^rotate\(213deg\)/);
});

test('a contact resolves to its specific icon when metadata becomes available', () => {
  const item = aircraft({ category: 'A0', trackDeg: 160 });
  assert.equal(aircraftIconDefinition(item).name, 'unknown-contact-dot');
  const known = aircraftIconDefinition({ ...item, aircraftType: 'EC35', category: 'A7' });
  assert.equal(known.name, 'helicopter');
  assert.match(aircraftIconTransform(known, 160), /^rotate\(160deg\)/);
});
