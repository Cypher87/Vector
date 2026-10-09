import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft, AircraftMetadata } from '../src/domain/aircraft.ts';
import { favoriteAircraftOverview } from '../src/domain/favorite-aircraft-overview.ts';

const live: Aircraft = { id: 'abc123', flight: 'VECTOR01', registration: 'PH-LIVE', aircraftType: 'A320', onGround: false,
  source: 'adsb_icao', seenSeconds: 0, messages: 20, dbFlags: 0 };
const metadata = new Map<string, AircraftMetadata>([['def456', { registration: 'PH-OFF', aircraftType: 'C172', description: 'Cessna 172' }]]);

test('favorite overview includes every saved ID, regardless of live presence, metadata or position', () => {
  const entries = favoriteAircraftOverview(['ABC123', 'abc123', 'def456', 'ffffff', '~123456', 'bad'], [live], metadata, 'live');
  assert.deepEqual(entries.map((entry) => entry.id), ['abc123', 'def456', 'ffffff', '~123456']);
  assert.equal(entries[0].live, true); // Live but no position is still a selectable aircraft.
  assert.equal(entries[0].registration, 'PH-LIVE');
  assert.equal(entries[0].flight, 'VECTOR01');
  assert.equal(entries[1].registration, 'PH-OFF');
  assert.equal(entries[1].description, 'Cessna 172');
  assert.equal(entries[1].live, false);
  assert.equal(entries[2].registration, undefined);
  assert.equal(entries[3].live, false);
  assert.deepEqual(favoriteAircraftOverview([], [live], metadata, 'live'), []);
});

test('cached receiver snapshots and stale contacts never claim a favorite is live', () => {
  for (const status of ['connecting', 'stale', 'offline'] as const) {
    const [entry] = favoriteAircraftOverview(['abc123'], [live], metadata, status);
    assert.equal(entry.live, false);
    assert.equal(entry.flight, undefined);
    assert.equal(entry.registration, 'PH-LIVE');
  }
  for (const seenSeconds of [-1, 60.001, NaN, Infinity]) {
    assert.equal(favoriteAircraftOverview(['abc123'], [{ ...live, seenSeconds }], metadata, 'live')[0].live, false);
  }
  assert.equal(favoriteAircraftOverview(['abc123'], [{ ...live, seenSeconds: 60 }], metadata, 'live')[0].live, true);
});

test('metadata supplies absent live fields without replacing receiver identity or dropping unknown favorites', () => {
  const records = new Map<string, AircraftMetadata>([['abc123', { registration: 'OLD', aircraftType: 'B738', description: 'Airbus A320' }]]);
  const [entry] = favoriteAircraftOverview(['abc123'], [live], records, 'live');
  assert.equal(entry.registration, 'PH-LIVE');
  assert.equal(entry.aircraftType, 'A320');
  assert.equal(entry.description, 'Airbus A320');
  assert.equal(favoriteAircraftOverview(['ffffff'], [], new Map(), 'offline').length, 1);
});
