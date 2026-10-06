import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { AircraftTracePoint } from '../src/domain/aircraft.ts';
import { mergeWakeTrace, recentWakeTrace } from '../src/domain/wake-trace.ts';
import { createWakeTraceCache } from '../src/data/wake-trace-cache.ts';
import { loadAircraftRecentTrace } from '../src/data/readsb.ts';
import { aircraftWakeRoute } from '../src/map/aircraft-wake-route.ts';

const now = 2_000;
const point = (timestamp: number, patch: Partial<AircraftTracePoint> = {}): AircraftTracePoint => ({
  timestamp, longitude: 5 + (timestamp - now) * .0001, latitude: 52,
  onGround: false, stale: false, startsLeg: false, ...patch,
});
const project = ([lon, lat]: [number, number]) => ({ x: lon * 10_000, y: -lat * 10_000 });
const local = [point(now, { startsLeg: true }), point(now + 2)];
const receiver = recentWakeTrace([point(now - 120), point(now - 60), point(now - 25)], now);

test('recent receiver positions join the initial live buffer without mutating either source', () => {
  const result = mergeWakeTrace(receiver, local);
  assert.equal(result.length, 5);
  assert.equal(result[3].startsLeg, false);
  assert.equal(result[3].receiverInterval, true);
  assert.equal(local[0].startsLeg, true);
  assert.equal(result[4], local[1], 'preserve point identity and local gap rules');
  const route = aircraftWakeRoute(result, now + 2, [local[1].longitude, 52], project, 90, 1_000);
  assert.equal(route.length, 5, '25–60 second receiver intervals must not break the route');
  assert.equal(mergeWakeTrace([], local), local);
  assert.equal(mergeWakeTrace(receiver, []), receiver);
});

test('overlap favors local data; gaps, stale points and real new legs remain boundaries', () => {
  const result = mergeWakeTrace([...receiver, ...recentWakeTrace([point(now), point(now + 1)], now)], local);
  assert.equal(result.length, 5);
  assert.equal(result[3].timestamp, now);
  assert.equal(mergeWakeTrace(recentWakeTrace([point(now - 181)], now), local), local);
  for (const patch of [{ stale: true }, { onGround: true }, { startsLeg: true }]) {
    const points = mergeWakeTrace(receiver, [local[0], { ...local[1], ...patch }]);
    assert.equal(aircraftWakeRoute(points, now + 2, [local[1].longitude, 52], project, 0, 1_000).length, 1);
  }
  const longGap = recentWakeTrace([point(now - 400), point(now - 25)], now);
  assert.equal(aircraftWakeRoute(mergeWakeTrace(longGap, local), now + 2, [local[1].longitude, 52], project, 0, 1_000).length, 3);
  const jump = recentWakeTrace([point(now - 25, { longitude: 15 })], now);
  assert.equal(aircraftWakeRoute(mergeWakeTrace(jump, local), now + 2, [local[1].longitude, 52], project, 0, 1_000).length, 2);
});

test('receiver seed is limited to twenty minutes, 600 points, and no future samples', () => {
  const points = recentWakeTrace(Array.from({ length: 2_002 }, (_, i) => point(i)), now);
  assert.equal(points.length, 600);
  assert.equal(points.at(-1)?.timestamp, now + 1);
  assert.equal(recentWakeTrace([point(799), point(800), point(NaN), point(now + 2)], now).length, 1);
});

test('cache spaces requests, limits concurrency, aborts offscreen work and ignores late results', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: now * 1_000 });
  const calls: { id: string; signal: AbortSignal; finish: (points: AircraftTracePoint[]) => void }[] = [];
  let changed = 0;
  const cache = createWakeTraceCache({ load: (id, signal) => new Promise((finish) => calls.push({ id, signal, finish })), onChange: () => changed++ });
  t.after(() => cache.dispose());
  const ids = ['000001', '000002', '000003', '000004', '000005'];
  cache.setWanted(ids);
  await setImmediate();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(150); await setImmediate();
  t.mock.timers.tick(150); await setImmediate();
  t.mock.timers.tick(1_000); await setImmediate();
  assert.equal(calls.length, 3);
  cache.setWanted(['000005']); await setImmediate();
  assert.ok(calls.slice(0, 3).every(({ signal }) => signal.aborted));
  calls[0].finish([point(now)]); await setImmediate();
  assert.equal(changed, 0);
  assert.deepEqual(cache.get(ids[0]), []);
  assert.equal(calls.at(-1)?.id, '000005');
  cache.setWanted([]);
  assert.ok(calls.every(({ signal }) => signal.aborted));
  t.mock.timers.tick(300_000); await setImmediate();
  assert.equal(calls.length, 4);
});

test('cache memoizes merges, reuses successful seeds, backs off missing traces and releases timed-out slots', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: now * 1_000 });
  let calls = 0;
  const cache = createWakeTraceCache({ load: async (id) => { calls++; return id === '000001' ? [point(now - 60)] : []; }, onChange: () => {} });
  t.after(() => cache.dispose());
  cache.setWanted(['000001']); await setImmediate();
  const merged = cache.get('000001', local);
  assert.equal(cache.get('000001', local), merged);
  cache.setWanted([]); cache.setWanted(['000001']); await setImmediate();
  assert.equal(calls, 1);
  cache.setWanted(['000002']); t.mock.timers.tick(150); await setImmediate();
  assert.equal(calls, 2);
  t.mock.timers.tick(59_000); await setImmediate();
  assert.equal(calls, 2);
  t.mock.timers.tick(1_000); await setImmediate();
  assert.equal(calls, 3);
  cache.dispose();
  const signals: AbortSignal[] = [];
  const hanging = createWakeTraceCache({ load: (_id, signal) => { signals.push(signal); return new Promise(() => {}); }, onChange: () => {} });
  t.after(() => hanging.dispose());
  hanging.setWanted(['000001']); await setImmediate();
  t.mock.timers.tick(8_000); await setImmediate();
  assert.equal(signals[0].aborted, true);
  hanging.setWanted(['000002']); await setImmediate();
  assert.equal(signals.length, 2);
  hanging.dispose();
  assert.ok(signals.every((signal) => signal.aborted));
});

test('viewport cache evicts least recently used traces instead of growing indefinitely', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: now * 1_000 });
  const cache = createWakeTraceCache({ load: async () => [point(now)], onChange: () => {} });
  t.after(() => cache.dispose());
  for (let index = 0; index < 256; index++) {
    cache.setWanted([index.toString(16).padStart(6, '0')]);
    t.mock.timers.tick(150); await setImmediate();
  }
  assert.equal(cache.get('000000').length, 1); // Touch the oldest entry.
  cache.setWanted(['000100']); t.mock.timers.tick(150); await setImmediate();
  assert.equal(cache.get('000001').length, 0);
  assert.equal(cache.get('000000').length, 1);
  assert.equal(cache.get('000100').length, 1);
});

test('recent loader requests only a validated recent file and handles missing traces and aborts', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ timestamp: now - 60, trace: [[0, 52, 5, 20000, 200, 90, 0]] }));
  });
  assert.equal((await loadAircraftRecentTrace('/api/readsb?source=live', 'ABC123')).length, 1);
  assert.match(calls[0], /path=traces%2F23%2Ftrace_recent_abc123.json/);
  assert.deepEqual(await loadAircraftRecentTrace('/api/readsb', '../bad'), []);
  assert.equal(calls.length, 1);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unavailable'); });
  assert.deepEqual(await loadAircraftRecentTrace('/api/readsb', 'abc123'), []);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(loadAircraftRecentTrace('/api/readsb', 'abc123', abort.signal));
});
