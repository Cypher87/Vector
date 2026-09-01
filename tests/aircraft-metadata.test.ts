import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft } from '../src/domain/aircraft.ts';
import { aircraftKind } from '../src/domain/aircraft-kind.ts';
import { mergeAircraftMetadata } from '../src/domain/aircraft-metadata.ts';

const aircraft = (overrides: Partial<Aircraft> = {}): Aircraft => ({
  id: 'abc123',
  flight: 'TEST1',
  onGround: false,
  source: 'adsb_icao',
  seenSeconds: 0,
  messages: 1,
  dbFlags: 0,
  ...overrides,
});

test('history keeps its own aircraft type when live metadata is incomplete', () => {
  const historicalBalloon = aircraft({
    category: 'B2',
    aircraftType: 'BALL',
    description: 'Balloon',
  });
  const incompleteLiveAircraft = aircraft({ flight: 'TEST2' });

  const merged = mergeAircraftMetadata(historicalBalloon, incompleteLiveAircraft);

  assert.equal(merged.category, 'B2');
  assert.equal(merged.aircraftType, 'BALL');
  assert.equal(merged.description, 'Balloon');
  assert.equal(merged.flight, 'TEST1');
  assert.equal(aircraftKind(merged), 'balloon');
});

test('live or cached metadata enriches replay aircraft without changing its position data', () => {
  const replayAircraft = aircraft({ latitude: 52.1, longitude: 5.1 });
  const cachedBalloon = aircraft({
    registration: 'PH-ABC',
    aircraftType: 'BALL',
    description: 'CAMERON BALLOONS Z-105',
    latitude: 53,
    longitude: 6,
  });

  const merged = mergeAircraftMetadata(replayAircraft, cachedBalloon);

  assert.equal(merged.category, undefined);
  assert.equal(merged.registration, 'PH-ABC');
  assert.equal(merged.aircraftType, 'BALL');
  assert.equal(merged.latitude, 52.1);
  assert.equal(merged.longitude, 5.1);
  assert.equal(aircraftKind(merged), 'balloon');
});

test('trace emitter category classifies a database-unknown replay aircraft', () => {
  const replayAircraft = aircraft({ id: '486924', flight: 'PHECK' });
  const merged = mergeAircraftMetadata(replayAircraft, { category: 'B2' });

  assert.equal(merged.category, 'B2');
  assert.equal(merged.aircraftType, undefined);
  assert.equal(aircraftKind(merged), 'balloon');
});
