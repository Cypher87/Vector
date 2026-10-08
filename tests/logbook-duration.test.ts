import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLogbookDuration } from '../src/domain/logbook-duration.ts';

const start = Date.UTC(2026, 9, 8, 23, 50);

test('sighting durations use full minutes, with a compact label for single and sub-minute observations', () => {
  for (const language of ['nl', 'en'] as const) {
    for (const seconds of [0, 1, 59.999]) assert.equal(formatLogbookDuration(start, start + seconds * 1000, language), '< 1 min');
    assert.equal(formatLogbookDuration(start, start + 60_000, language), '1 min');
    assert.equal(formatLogbookDuration(start, start + 23 * 60_000, language), '23 min');
    assert.equal(formatLogbookDuration(start, start + 3600_000 - 1, language), '59 min');
  }
});

test('sighting durations localize hours and work across midnight without counting time since last seen', () => {
  assert.equal(formatLogbookDuration(start, start + 3600_000, 'nl'), '1 u');
  assert.equal(formatLogbookDuration(start, start + 3600_000, 'en'), '1 h');
  assert.equal(formatLogbookDuration(start, start + 72 * 60_000, 'nl'), '1 u 12 min');
  assert.equal(formatLogbookDuration(start, start + 72 * 60_000, 'en'), '1 h 12 min');
  assert.equal(formatLogbookDuration(start, start + 1501 * 60_000, 'nl'), '25 u 1 min');
});

test('invalid or reversed sighting endpoints never show a fabricated duration', () => {
  for (const [first, last] of [[NaN, start], [start, NaN], [-Infinity, start], [start, Infinity], [start, start - 1]]) {
    assert.equal(formatLogbookDuration(first, last, 'nl'), '—');
  }
});
