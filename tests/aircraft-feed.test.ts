import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Aircraft, Receiver, RuntimeConfig } from '../src/domain/aircraft.ts';
import { feedRequestTimeoutMs, initialFeedState, startAircraftFeed } from '../src/data/aircraft-feed.ts';

const config: RuntimeConfig = {
  dataBaseUrl: '/api/readsb?source=live', historyBaseUrl: '/api/readsb?source=history',
  mapStyleUrl: '/map-style.json', siteName: 'Vector test', receiverName: 'Test', unitSystem: 'metric',
};
const receiver: Receiver = { refreshMs: 1_000, haveReplay: true, historyCount: 0, outlineJson: false };
const aircraft: Aircraft = { id: 'abc123', flight: 'VECTOR', onGround: false, seenSeconds: 0, messages: 10, dbFlags: 0, source: 'adsb_icao' };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture(t: TestContext, initialFailure?: 'config' | 'receiver' | 'aircraft') {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_800_000_000_000 });
  const calls = { config: 0, receiver: 0, aircraft: 0 };
  const signals: AbortSignal[] = [];
  let fail = initialFailure;
  let hang = false;
  let snapshot = { now: Date.now() / 1_000, messages: 100, aircraft: [aircraft] };
  let state = initialFeedState(config);
  const updates: typeof state[] = [];
  const feed = startAircraftFeed({
    loadConfig: async (signal) => {
      signals.push(signal);
      calls.config++;
      if (fail === 'config') throw new Error('Unavailable');
      return config;
    },
    loadReceiver: async () => {
      calls.receiver++;
      if (fail === 'receiver') throw new Error('Unavailable');
      return receiver;
    },
    loadAircraft: async (_base, signal) => {
      signals.push(signal);
      calls.aircraft++;
      if (hang) return new Promise<never>(() => {});
      if (fail === 'aircraft') throw new Error('Unavailable');
      return snapshot;
    },
  }, state, (next) => { state = next; updates.push(next); });
  t.after(() => feed.stop());
  await flush();
  return {
    feed, calls, signals, updates,
    get state() { return state; },
    fail: (stage?: typeof fail) => { fail = stage; },
    hang: (value: boolean) => { hang = value; },
    sample: (now = Date.now() / 1_000, messages = 150) => { snapshot = { ...snapshot, now, messages }; },
    async tick(ms: number) { t.mock.timers.tick(ms); await flush(); },
  };
}

for (const stage of ['config', 'receiver', 'aircraft'] as const) {
  test(`automatically recovers when the initial ${stage} request fails`, async (t) => {
    const f = await fixture(t, stage);
    assert.equal(f.state.status, 'offline');
    f.fail();
    await f.tick(2_000);
    assert.equal(f.state.status, 'live');
    assert.equal(f.calls[stage], 2);
    assert.equal(f.state.aircraft[0].id, 'abc123');
  });
}

test('frozen JSON becomes stale without re-recording history or restarting motion', async (t) => {
  const f = await fixture(t);
  const original = f.state.aircraft;
  const timestamp = f.state.lastUpdate;
  for (let i = 0; i < 16; i++) await f.tick(1_000);
  assert.equal(f.state.status, 'stale');
  assert.equal(f.state.error, 'liveDataOutdated');
  assert.equal(f.state.aircraft, original);
  assert.equal(f.state.lastUpdate, timestamp);
  assert.equal(f.state.dataAgeSeconds, 16);
  assert.equal(f.state.messageRate, 0);
  f.sample();
  await f.tick(1_000);
  assert.equal(f.state.status, 'live');
  assert.equal(f.state.error, undefined);
});

test('old and far-future timestamps are not live; invalid timestamps preserve prior positions', async (t) => {
  const f = await fixture(t);
  for (const offset of [-60, 60]) {
    f.sample(Date.now() / 1_000 + offset);
    await f.tick(1_000);
    assert.equal(f.state.status, 'stale');
  }
  const original = f.state.aircraft;
  f.sample(NaN);
  await f.tick(1_000);
  assert.equal(f.state.error, 'liveDataUnavailable');
  assert.equal(f.state.aircraft, original);
});

test('outages retain aircraft and retry indefinitely with bounded backoff', async (t) => {
  const f = await fixture(t);
  const original = f.state.aircraft;
  f.fail('aircraft');
  await f.tick(1_000);
  assert.equal(f.state.status, 'stale');
  await f.tick(2_000);
  await f.tick(4_000);
  assert.equal(f.state.status, 'offline');
  for (let i = 0; i < 12; i++) await f.tick(15_000);
  assert.ok(f.calls.aircraft >= 16);
  assert.ok(f.calls.config > 1);
  assert.equal(f.state.aircraft, original);
  f.fail();
  f.sample();
  await f.tick(15_000);
  assert.equal(f.state.status, 'live');
});

test('request timeout cancels a hanging request and recovery resumes', async (t) => {
  const f = await fixture(t);
  f.hang(true);
  await f.tick(1_000);
  const pending = f.signals.at(-1)!;
  await f.tick(feedRequestTimeoutMs);
  assert.equal(pending.aborted, true);
  assert.equal(f.state.status, 'stale');
  f.hang(false);
  f.sample();
  await f.tick(2_000);
  assert.equal(f.state.status, 'live');
});

test('watchdog notices stale data even while a request is pending', async (t) => {
  const f = await fixture(t);
  await f.tick(10_000);
  f.hang(true);
  await f.tick(1_000);
  await f.tick(5_000);
  assert.equal(f.state.status, 'stale');
  assert.equal(f.state.error, 'liveDataOutdated');
});

test('resume retries immediately but never starts parallel requests; stop cancels everything', async (t) => {
  const f = await fixture(t, 'config');
  f.fail();
  f.hang(true);
  f.feed.resume();
  await flush();
  f.feed.resume();
  f.feed.resume();
  assert.equal(f.calls.aircraft, 1);
  const count = f.updates.length;
  f.feed.stop();
  await f.tick(60_000);
  f.feed.resume();
  assert.equal(f.signals.at(-1)?.aborted, true);
  assert.equal(f.updates.length, count);
  assert.equal(f.calls.aircraft, 1);
});

test('rates use receiver time and safely handle a receiver counter restart', async (t) => {
  const f = await fixture(t);
  f.sample(Date.now() / 1_000 + 1, 150);
  await f.tick(1_000);
  assert.equal(f.state.messageRate, 50);
  f.sample(Date.now() / 1_000 + 1, 10);
  await f.tick(1_000);
  assert.equal(f.state.messageRate, 0);
});
