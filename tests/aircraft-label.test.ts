import assert from 'node:assert/strict';
import test from 'node:test';
import { aircraftTypeSummary } from '../src/domain/aircraft-label.ts';

test('aircraft details display a type fallback only once', () => {
  assert.equal(aircraftTypeSummary('GLF6', 'GLF6'), 'GLF6');
  assert.equal(aircraftTypeSummary(' GLF6 ', 'glf6 '), 'GLF6');
  assert.equal(aircraftTypeSummary('B77L', ''), 'B77L');
});

test('aircraft details preserve a distinct model description', () => {
  assert.equal(aircraftTypeSummary('GLF6', 'Gulfstream G650'), 'GLF6 · Gulfstream G650');
});

test('aircraft details retain translated fallbacks without a type code', () => {
  assert.equal(aircraftTypeSummary(undefined, 'helikopter'), 'helikopter');
  assert.equal(aircraftTypeSummary(' ', 'Unknown type'), 'Unknown type');
});
