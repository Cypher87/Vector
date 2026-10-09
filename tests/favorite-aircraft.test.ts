import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeFavoriteAircraftIds,
  parseFavoriteAircraftIds,
  toggleFavoriteAircraftId,
  matchingFavoriteAircraftIds,
  normalizeFavoriteCallsign,
  normalizeFavoriteCallsigns,
  parseFavoriteCallsigns,
  normalizeFavoriteRegistration,
  normalizeFavoriteRegistrations,
  parseFavoriteRegistrations,
  parseFavoriteIdentifier,
} from '../src/domain/favorite-aircraft.ts';
import type { Aircraft } from '../src/domain/aircraft.ts';

test('normalizes stored favorite aircraft IDs and removes invalid entries', () => {
  assert.deepEqual(normalizeFavoriteAircraftIds([' 484FDE ', '484fde', '~ABC123', '', 42]), [
    '484fde',
    '~abc123',
  ]);
});

test('recovers safely from missing or malformed favorite aircraft storage', () => {
  assert.deepEqual(parseFavoriteAircraftIds(null), []);
  assert.deepEqual(parseFavoriteAircraftIds('{broken'), []);
  assert.deepEqual(parseFavoriteAircraftIds(JSON.stringify(['4CA56E'])), ['4ca56e']);
});

test('toggles one favorite without losing the other saved aircraft', () => {
  assert.deepEqual(toggleFavoriteAircraftId(['484fde'], '4CA56E'), ['484fde', '4ca56e']);
  assert.deepEqual(toggleFavoriteAircraftId(['484fde', '4ca56e'], '484FDE'), ['4ca56e']);
});

test('callsign favorites are canonical, bounded and separate from aircraft identities', () => {
  assert.equal(normalizeFavoriteCallsign(' klm 123 '), 'KLM123');
  assert.deepEqual(normalizeFavoriteCallsigns(['klm123', ' KLM123 ', 'abc123', 'ABC123', 'PHABC', '*', '<img>', '', null, '123456789']), ['ABC123', 'KLM123', 'PHABC']);
  assert.deepEqual(normalizeFavoriteAircraftIds(['callsign:KLM123']), []);
  for (const value of [null, '{broken', '42']) assert.deepEqual(parseFavoriteCallsigns(value), []);
  assert.deepEqual(parseFavoriteCallsigns('["klm123"]'), ['KLM123']);
  assert.equal(normalizeFavoriteCallsigns(Array.from({ length: 2100 }, (_, i) => `KLM${i}`)).length, 2000);
});

test('callsign matching is exact and follows the flight instead of retaining a past aircraft', () => {
  const ids = new Set(['abc123']);
  const callsigns = new Set(['KLM123']);
  const contacts = [
    { id: 'def456', flight: ' klm123 ' }, { id: '123abc', flight: 'KLM1234' },
    { id: '222222', flight: 'KLM123' }, { id: '333333', flight: 'OTHER' },
  ] as Aircraft[];
  assert.deepEqual([...matchingFavoriteAircraftIds(ids, callsigns, contacts)], ['abc123', 'def456', '222222']);
  assert.deepEqual([...matchingFavoriteAircraftIds(ids, callsigns, [{ ...contacts[0], flight: 'KLM999' }])], ['abc123']);
  assert.deepEqual([...ids], ['abc123']);
});

test('registration favorites retain hyphens and have a separate explicit type for unhyphenated registrations', () => {
  assert.equal(normalizeFavoriteRegistration(' ph - hlp '), 'PH-HLP');
  assert.deepEqual(parseFavoriteIdentifier('ph-hlp'), { type: 'registration', value: 'PH-HLP' });
  assert.deepEqual(parseFavoriteIdentifier('klm123'), { type: 'callsign', value: 'KLM123' });
  assert.deepEqual(parseFavoriteIdentifier('n123ab', 'registration'), { type: 'registration', value: 'N123AB' });
  assert.equal(parseFavoriteIdentifier('PH-HLP', 'callsign'), undefined);
  assert.deepEqual(normalizeFavoriteRegistrations(['PH-HLP', 'ph-hlp', ' N123AB ', 'ab', 'A--B', 'ABC-', '-ABC', '1234567890123', '<img>', null]), ['N123AB', 'PH-HLP']);
  for (const value of [null, '{broken', '42']) assert.deepEqual(parseFavoriteRegistrations(value), []);
  assert.deepEqual(parseFavoriteRegistrations('["ph-hlp"]'), ['PH-HLP']);
  assert.equal(normalizeFavoriteRegistrations(Array.from({ length: 2100 }, (_, i) => `N${1000 + i}`)).length, 2000);
});

test('registration matching follows the aircraft registration regardless of callsign, without confusing the two fields', () => {
  const ids = new Set(['abc123']);
  const contacts = [
    { id: 'def456', flight: 'OTHER', registration: ' ph-hlp ' },
    { id: '222222', flight: 'PHHLP', registration: 'PH-OTHER' },
    { id: '333333', flight: 'KLM123', registration: 'PH-HLPX' },
    { id: '444444', registration: 'PH-HLPX' },
  ] as Aircraft[];
  assert.deepEqual([...matchingFavoriteAircraftIds(ids, new Set(['KLM123']), contacts, new Set(['PH-HLP']))], ['abc123', 'def456', '333333']);
  assert.deepEqual([...matchingFavoriteAircraftIds(ids, new Set(), [{ ...contacts[0], flight: 'NEW' }], new Set(['PH-HLP']))], ['abc123', 'def456']);
  assert.deepEqual([...ids], ['abc123']);
});
