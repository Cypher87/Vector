import assert from 'node:assert/strict';
import test from 'node:test';
import type { Aircraft, AircraftHistorySnapshot } from '../src/domain/aircraft.ts';
import { logbookReplayWindow, selectLogbookReplay, type LogbookReplayRequest } from '../src/domain/logbook-replay.ts';
import { traceFromHistory } from '../src/domain/flight-profile.ts';
import { loadAircraftReplayChunk } from '../src/data/readsb.ts';

const start = Date.UTC(2026, 9, 8, 23, 50);
const request: LogbookReplayRequest = { hex: 'abc123', firstSeen: start, lastSeen: start + 25 * 60_000,
  registration: 'PH-TEST', aircraftType: 'A320', description: 'Airbus' };
const plane: Aircraft = { id: 'abc123', flight: 'OLD123', latitude: 52, longitude: 5, altitudeFt: 10000,
  seenSeconds: 0, onGround: false, source: 'adsb_icao', messages: 10, dbFlags: 0 };
const snapshot = (seconds: number, aircraft: Aircraft[] = [plane]): AircraftHistorySnapshot => ({ timestamp: start / 1000 + seconds, aircraft });

test('logbook replay requests only the matching half-hours, across UTC midnight', () => {
  assert.deepEqual(logbookReplayWindow(request), { start: start / 1000, end: start / 1000 + 1500,
    chunks: [Date.UTC(2026, 9, 8, 23, 30), Date.UTC(2026, 9, 9, 0, 0)] });
  assert.deepEqual(logbookReplayWindow({ ...request, lastSeen: start + 9 * 60_000 })?.chunks, [Date.UTC(2026, 9, 8, 23, 30)]);
});

test('even multi-day sightings load at most the final half-hour from two files', () => {
  const window = logbookReplayWindow({ ...request, firstSeen: start - 4 * 86400_000 });
  assert.ok(window);
  assert.equal(window.end - window.start, 1800);
  assert.equal(window.chunks.length, 2);
  for (let offset = 0; offset < 3600_000; offset += 31_337) {
    assert.ok(logbookReplayWindow({ ...request, lastSeen: start + offset })!.chunks.length <= 2);
  }
});

test('invalid identities or timestamps cannot load arbitrary history paths', () => {
  for (const hex of ['', '../abc123', 'ABC123', 'abcdef0']) assert.equal(logbookReplayWindow({ ...request, hex }), undefined);
  for (const [firstSeen, lastSeen] of [[NaN, start], [start, Infinity], [-1, start], [start, start - 1], [start, 9e15]]) {
    assert.equal(logbookReplayWindow({ ...request, firstSeen, lastSeen }), undefined);
  }
});

test('selection opens the last measured position, keeps gaps and trims outside the sighting', () => {
  const selected = selectLogbookReplay(request, [[snapshot(-30), snapshot(0), snapshot(30), snapshot(60, []),
    snapshot(90), snapshot(1800)], [snapshot(1510), snapshot(120, []), snapshot(150, [{ ...plane, latitude: undefined }])]]);
  assert.deepEqual(selected?.snapshots.map((s) => s.timestamp - start / 1000), [0, 30, 60, 90]);
  assert.equal(selected?.index, 3);
  assert.equal(selected?.aircraft.flight, 'OLD123');
  assert.deepEqual(traceFromHistory(selected!.snapshots, plane.id).map((point) => point.startsLeg), [true, false, true]);
});

test('missing, stale and invalid positions cannot borrow another aircraft or live moment', () => {
  for (const item of [{ ...plane, id: 'def456' }, { ...plane, latitude: undefined }, { ...plane, longitude: NaN },
    { ...plane, longitude: 181 }, { ...plane, latitude: -91 }, { ...plane, positionSeenSeconds: 21 }]) {
    assert.equal(selectLogbookReplay(request, [[snapshot(30, [item])], [snapshot(3600)]]), undefined);
  }
  assert.equal(selectLogbookReplay(request, [[snapshot(NaN)], []]), undefined);
  assert.equal(selectLogbookReplay(request, [[snapshot(0, [{ ...plane, positionSeenSeconds: 10 }])]]), undefined);
});

test('duplicate receiver/session timestamps merge deterministically without losing other aircraft', () => {
  const selected = selectLogbookReplay(request, [[snapshot(30), snapshot(0, [plane, { ...plane, id: 'def456' }])],
    [snapshot(0, [{ ...plane, altitudeFt: 1234 }])]]);
  assert.equal(selected?.snapshots.length, 2);
  assert.equal(selected?.snapshots[0].aircraft.length, 2);
  assert.equal(selected?.snapshots[0].aircraft[0].altitudeFt, 1234);
});

test('sub-second logbook timestamps accept second-resolution replay and exact session samples', () => {
  const instant = { ...request, firstSeen: start + 530, lastSeen: start + 530 };
  assert.equal(selectLogbookReplay(instant, [[snapshot(0)]])?.index, 0);
  assert.equal(selectLogbookReplay(instant, [[snapshot(.53)]])?.index, 0);
  assert.equal(selectLogbookReplay(instant, [[snapshot(1)]]), undefined);
});

test('binary replay timestamps preserve exact millisecond boundaries at modern epoch dates', async (t) => {
  const times = [Date.parse('2026-01-15T23:40:00Z'), Date.parse('2026-01-16T00:10:00Z'), start + 530];
  const buffer = new ArrayBuffer(times.length * 16);
  const view = new DataView(buffer);
  times.forEach((time, index) => {
    view.setUint32(index * 16, 0x0e7f7c9d, true);
    view.setUint32(index * 16 + 4, Math.floor(time / 2 ** 32), true);
    view.setUint32(index * 16 + 8, time % 2 ** 32, true);
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(buffer));
  const snapshots = await loadAircraftReplayChunk('/api/readsb?source=history', new Date(start));
  assert.deepEqual(snapshots.map((snapshot) => snapshot.timestamp), times.map((time) => time / 1000));
});
