import assert from 'node:assert/strict';
import test from 'node:test';
import { altitudeShadowProjection, solarPosition, type SolarPosition } from '../src/map/altitude-shadow.ts';

const daylight: SolarPosition = { azimuthDeg: 225, elevationDeg: 45 };

const distance = (altitudeFt: number, onGround = false) => {
  const projection = altitudeShadowProjection(altitudeFt, onGround, daylight);
  return Math.hypot(projection.offsetXpx, projection.offsetYpx);
};

test('aircraft shadow distance increases clearly with altitude', () => {
  const low = distance(1_000);
  const medium = distance(10_000);
  const high = distance(40_000);
  assert.ok(low < medium);
  assert.ok(medium < high);
  assert.ok(high > low * 7);
  assert.ok(high <= 19);
});

test('high aircraft shadows become softer and fall directly away from the sun', () => {
  const low = altitudeShadowProjection(1_000, false, daylight);
  const high = altitudeShadowProjection(40_000, false, daylight);

  assert.ok(high.blurPx > low.blurPx);
  assert.ok(high.opacity < low.opacity);
  assert.ok(high.scale < low.scale);
  assert.ok(high.opacity > 0.24);
  assert.ok(high.opacity < 0.28);
  assert.ok(high.offsetXpx > 0);
  assert.ok(high.offsetYpx < 0);
});

test('ground shadows remain close and extreme altitudes are clamped', () => {
  assert.ok(distance(40_000, true) < distance(1_000));
  assert.deepEqual(
    altitudeShadowProjection(100_000, false, daylight),
    altitudeShadowProjection(45_000, false, daylight),
  );
});

test('aircraft without a known altitude do not imply a false height', () => {
  assert.equal(altitudeShadowProjection(undefined, false, daylight).opacity, 0);
  assert.ok(altitudeShadowProjection(undefined, true, daylight).opacity > 0);
});

test('sun shadows disappear below the horizon', () => {
  assert.equal(altitudeShadowProjection(20_000, false, { azimuthDeg: 20, elevationDeg: -5 }).opacity, 0);
});

test('map rotation keeps the shadow direction geographically aligned', () => {
  const southSun = { azimuthDeg: 180, elevationDeg: 45 };
  const northShadow = altitudeShadowProjection(20_000, false, southSun, 0);
  const rotatedShadow = altitudeShadowProjection(20_000, false, southSun, 90);

  assert.ok(Math.abs(northShadow.offsetXpx) < 0.001);
  assert.ok(northShadow.offsetYpx < 0);
  assert.ok(rotatedShadow.offsetXpx < 0);
  assert.ok(Math.abs(rotatedShadow.offsetYpx) < 0.001);
});

test('solar position is plausible for a summer noon in Groningen', () => {
  const position = solarPosition(Date.parse('2026-06-21T12:00:00Z') / 1_000, 53.2194, 6.5665);
  assert.ok(position.elevationDeg > 55 && position.elevationDeg < 65);
  assert.ok(position.azimuthDeg > 175 && position.azimuthDeg < 215);
});
