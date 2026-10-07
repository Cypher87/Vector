import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer(environment, signal, children) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['dist/standalone/server.js'], {
    cwd: resolve('.'), windowsHide: true,
    env: { ...process.env, ...environment, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let spawnError;
  const closed = new Promise((resolve) => {
    child.once('error', (error) => { spawnError = error; resolve(); });
    child.once('close', resolve);
  });
  children.push({ child, closed });
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
  for (let i = 0; i < 150; i++) {
    signal.throwIfAborted();
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Production server exited: ${output}`);
    try {
      if ((await fetch(`${origin}/api/config`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) })).ok) return origin;
    } catch { /* wait for bind */ }
    await delay(100);
  }
  throw new Error(`Production server failed to start: ${output}`);
}

test('local and remote production runtimes serve live, metadata, outline, traces and replay without tar1090', { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'vector-production-'));
  const live = join(root, 'live');
  const history = join(root, 'history');
  const database = join(root, 'aircraft.csv.gz');
  const children = [];
  try {
    await mkdir(join(live, 'traces/23'), { recursive: true });
    await mkdir(join(history, '2026/10/04/heatmap'), { recursive: true });
    await writeFile(database, gzipSync('ABC123;TEST-A;A320;0000;Test Airbus;2020;Test;\nDEF456;TEST-B;BALL;1000;Test balloon;;;\n'));
    await writeFile(join(live, 'receiver.json'), JSON.stringify({ version: 'test', refresh: 1000, lat: 52.3, lon: 4.8, haveReplay: true, outlineJson: true }));
    await writeFile(join(live, 'aircraft.json'), JSON.stringify({ now: Date.now() / 1000, aircraft: [{ hex: 'abc123', lat: 52.3, lon: 4.8, alt_baro: 10000, seen: 0 }] }));
    await writeFile(join(live, 'outline.json'), JSON.stringify({ actualRange: { last24h: { points: [[52, 4], [53, 5], [52, 6]] } } }));
    const trace = { icao: 'abc123', timestamp: 1_800_000_000, trace: [[0, 52, 4, 10000, 200, 90, 0], [30, 52.1, 4.1, 10025, 200, 90, 0]] };
    for (const kind of ['full', 'recent']) await writeFile(join(live, `traces/23/trace_${kind}_abc123.json`), gzipSync(JSON.stringify(trace)));
    const replay = Buffer.alloc(32);
    replay.writeUInt32LE(0x0e7f7c9d);
    const stamp = Date.UTC(2026, 9, 4);
    replay.writeUInt32LE(Math.floor(stamp / 2 ** 32), 4);
    replay.writeUInt32LE(stamp % 2 ** 32, 8);
    replay.writeUInt32LE(0xabc123, 16);
    await writeFile(join(history, '2026/10/04/heatmap/00.bin.ttf'), gzipSync(replay));
    const environment = {
      READSB_SOURCE: 'local',
      READSB_LIVE_DIR: live, READSB_HISTORY_DIR: history, VECTOR_AIRCRAFT_DATABASE: database,
      VECTOR_SYNC_STORE: join(root, 'sync.json'),
      VECTOR_UPDATES_ENABLED: 'false',
      // Deliberately unusable: a local installation must not need either legacy upstream.
      READSB_LIVE_URL: 'http://127.0.0.1:1/no-tar1090/', READSB_HISTORY_URL: 'http://127.0.0.1:1/no-tar1090/',
      READSB_TAR1090_URL: 'http://127.0.0.1:1/no-tar1090/',
    };
    const local = await startServer(environment, t.signal, children);
    const remote = await startServer({ ...environment, READSB_SOURCE: 'vector', READSB_REMOTE_URL: local,
      READSB_LIVE_DIR: join(root, 'unavailable'), READSB_HISTORY_DIR: join(root, 'unavailable'), VECTOR_AIRCRAFT_DATABASE: join(root, 'unavailable.csv.gz'),
    }, t.signal, children);
    const request = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.any([t.signal, AbortSignal.timeout(10_000)]) });
    for (const origin of [local, remote]) {
      const get = async (resource) => {
        const response = await request(`${origin}${resource}`);
        assert.equal(response.status, 200, await response.clone().text());
        return response;
      };
      const config = await (await get('/api/config')).json();
      assert.equal(config.dataBaseUrl, '/api/readsb?source=live');
      assert.equal(JSON.stringify(config).includes(root), false);
      assert.equal((await (await get('/api/updates')).json()).enabled, false);
      const databaseResponse = await get('/api/aircraft-database-status');
      assert.equal(databaseResponse.headers.get('cache-control'), 'no-store');
      const databaseStatus = await databaseResponse.json();
      assert.equal(databaseStatus.state, 'ready');
      assert.equal(databaseStatus.location, origin === local ? 'local' : 'receiver');
      assert.equal(databaseStatus.records, 2);
      assert.ok(Math.abs(databaseStatus.updatedAt - Date.now()) < 60_000);
      assert.equal(JSON.stringify(databaseStatus).includes(root), false);
      assert.equal((await request(`${origin}/api/aircraft-database-status?url=https://example.com`)).status, 400);
      const aircraft = await (await get('/api/readsb?source=live&path=aircraft.json')).json();
      assert.equal(aircraft.aircraft[0].t, 'A320');
      assert.equal(aircraft.aircraft[0].r, 'TEST-A');
      assert.equal(aircraft.aircraft[0].lat, 52.3);
      const metadata = await (await get('/api/aircraft-metadata?ids=def456')).json();
      assert.equal(metadata.aircraft.def456.aircraftType, 'BALL'); // absent from live feed
      assert.equal((await (await get('/api/readsb?source=live&path=receiver.json')).json()).haveReplay, true);
      assert.equal((await (await get('/api/readsb?source=live&path=outline.json')).json()).actualRange.last24h.points.length, 3);
      for (const kind of ['full', 'recent']) {
        assert.deepEqual(await (await get(`/api/readsb?source=live&path=traces/23/trace_${kind}_abc123.json`)).json(), trace);
      }
      assert.deepEqual(Buffer.from(await (await get('/api/readsb?source=history&path=2026/10/04/heatmap/00.bin.ttf')).arrayBuffer()), replay);
      assert.equal((await request(`${origin}/api/readsb?source=live&path=../aircraft.csv.gz`)).status, 400);
      const missing = await request(`${origin}/api/readsb?source=live&path=traces/00/trace_recent_000000.json`);
      assert.equal(missing.status, 404);
      assert.equal((await missing.text()).includes(root), false);
      assert.equal((await get('/')).status, 200);
      assert.equal((await get('/credits.html')).status, 200);
    }
    for (const path of ['/api/readsb?source=live&path=aircraft.json', '/api/aircraft-metadata?ids=abc123', '/api/aircraft-database-status']) {
      assert.equal((await request(`${remote}${path}`, { headers: { 'x-vector-data-proxy': '1' } })).status, 508);
    }
  } finally {
    for (const { child } of children.reverse()) child.kill();
    await Promise.all(children.map(({ closed }) => closed));
    await rm(root, { recursive: true, force: true });
  }
});
