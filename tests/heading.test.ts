import assert from 'node:assert/strict';
import test from 'node:test';

import { aircraftIconRotation } from '../src/map/heading.ts';

test('keeps balloon icons upright regardless of track or map bearing', () => {
  assert.equal(aircraftIconRotation('balloon', 137), 0);
  assert.equal(aircraftIconRotation('balloon', 248, 35), 0);
});

test('continues rotating other aircraft with their track and the map bearing', () => {
  assert.equal(aircraftIconRotation('light', 137), 137);
  assert.equal(aircraftIconRotation('airliner', 248, 35), 213);
});
