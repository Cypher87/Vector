import assert from 'node:assert/strict';
import test from 'node:test';

import { signalStrengthLevel } from '../src/domain/signal-strength.ts';

test('maps readsb RSSI values to four signal levels', () => {
  assert.equal(signalStrengthLevel(-40), 1);
  assert.equal(signalStrengthLevel(-27), 2);
  assert.equal(signalStrengthLevel(-18), 3);
  assert.equal(signalStrengthLevel(-9), 4);
  assert.equal(signalStrengthLevel(0), 4);
});

test('returns no active bars when RSSI is unavailable or invalid', () => {
  assert.equal(signalStrengthLevel(), 0);
  assert.equal(signalStrengthLevel(Number.NaN), 0);
  assert.equal(signalStrengthLevel(Number.POSITIVE_INFINITY), 0);
});
