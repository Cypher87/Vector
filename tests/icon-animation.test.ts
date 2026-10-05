import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import { aircraftIconMotionActive, aircraftIconMotionPhase } from '../src/map/icon-animation.ts';
import { vectorAircraftShapes } from '../src/map/vector-aircraft-shapes.ts';
import { aircraftIconPartProjection } from '../src/map/aircraft-icon-definition.ts';

const aircraft: Aircraft = {
  id: 'abc123', flight: 'TEST', onGround: false, source: 'adsb_icao',
  seenSeconds: 0, messages: 1, dbFlags: 0, latitude: 52, longitude: 5, groundSpeedKts: 90,
};

test('icon motion needs a fresh, moving airborne contact with a position', () => {
  assert.equal(aircraftIconMotionActive(aircraft), true);
  assert.equal(aircraftIconMotionActive({ ...aircraft, positionSeenSeconds: 7.9 }), true);
  for (const patch of [
    { onGround: true }, { groundSpeedKts: 0 }, { groundSpeedKts: 2.9 },
    { groundSpeedKts: undefined }, { groundSpeedKts: Number.NaN },
    { latitude: undefined }, { longitude: Number.NaN },
    { positionSeenSeconds: 8 }, { seenSeconds: 9 }, { seenSeconds: -1 },
  ]) assert.equal(aircraftIconMotionActive({ ...aircraft, ...patch }), false, JSON.stringify(patch));
});

test('moving parts belong only to rotor/propeller families with pivots inside the icon', () => {
  assert.deepEqual(Object.keys(vectorAircraftShapes).filter((name) =>
    vectorAircraftShapes[name as keyof typeof vectorAircraftShapes].movingParts),
  ['light', 'turboprop', 'helicopter', 'gyrocopter']);
  for (const shape of Object.values(vectorAircraftShapes)) {
    for (const part of shape.movingParts ?? []) {
      assert.ok(part.path);
      assert.ok(part.origin[0] > 0 && part.origin[0] < shape.w);
      assert.ok(part.origin[1] > 0 && part.origin[1] < shape.h);
    }
  }
  assert.equal(vectorAircraftShapes.turboprop.movingParts?.length, 2);
  assert.equal(vectorAircraftShapes.helicopter.movingParts?.[0].kind, 'rotor');
});

test('propellers have three blades projected around a fixed hub ahead of each engine', () => {
  for (const [shape, origins] of [
    [vectorAircraftShapes.light, [[20, 4]]],
    [vectorAircraftShapes.turboprop, [[11.5, 13], [28.5, 13]]],
  ] as const) {
    assert.deepEqual(shape.movingParts?.map((part) => part.origin), origins);
    for (const part of shape.movingParts!) {
      assert.equal((part.path.match(/M/g) ?? []).length, 3);
      assert.doesNotMatch(part.path, /NaN|Infinity/);
      const [x, y] = part.origin;
      assert.equal(aircraftIconPartProjection(part), `translate(${x} ${y}) scale(1 .32) translate(${-x} ${-y})`);
    }
  }
  for (const shape of [vectorAircraftShapes.helicopter, vectorAircraftShapes.gyrocopter]) {
    assert.equal(aircraftIconPartProjection(shape.movingParts![0]), undefined, 'rotor projection stays unchanged');
  }
});

test('animation phase is stable per aircraft without synchronizing nearby contacts', () => {
  assert.equal(aircraftIconMotionPhase('ABC123'), aircraftIconMotionPhase('abc123'));
  assert.notEqual(aircraftIconMotionPhase('abc123'), aircraftIconMotionPhase('abc124'));
  for (const id of ['abc123', '000000', '~abc456', '']) {
    const phase = aircraftIconMotionPhase(id);
    assert.match(phase, /^-\d+ms$/);
    assert.ok(Number.parseInt(phase) <= 0 && Number.parseInt(phase) > -2400);
  }
});
