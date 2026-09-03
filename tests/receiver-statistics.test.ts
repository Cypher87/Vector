import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft, AircraftSource } from '../src/domain/aircraft.ts';
import { receiverStatistics } from '../src/domain/receiver-statistics.ts';

const aircraft = (
  id: string,
  source: AircraftSource,
  options: { onGround?: boolean; positioned?: boolean } = {},
): Aircraft => ({
  dbFlags: 0,
  flight: id,
  id,
  messages: 1,
  onGround: options.onGround ?? false,
  seenSeconds: 0,
  source,
  ...(options.positioned ? { latitude: 52, longitude: 5 } : {}),
});

test('summarizes live aircraft and their receiver sources', () => {
  const statistics = receiverStatistics([
    aircraft('a', 'adsb_icao', { positioned: true }),
    aircraft('b', 'adsb_icao_nt', { onGround: true, positioned: true }),
    aircraft('c', 'mlat', { positioned: true }),
    aircraft('d', 'mode_s'),
    aircraft('e', 'tisb_icao'),
  ]);

  assert.deepEqual(statistics, {
    adsb: 2,
    airborne: 4,
    ground: 1,
    mlat: 1,
    modeS: 1,
    other: 1,
    positioned: 3,
    total: 5,
  });
});
