import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readVectorServerConfig } from '../src/server/vector-config.ts';
import { loadReadsbResource, rejectProxyLoop, vectorProxyHeader } from '../src/server/readsb-source.ts';
import { readBoundedFile, readBoundedResponse, decompressResource } from '../src/server/bounded-resource.ts';
import { loadVectorAircraftMetadata } from '../src/server/aircraft-metadata-source.ts';
import { GET as readsbGet } from '../app/api/readsb/route.ts';

test('source selection is standalone by default, preserves URL installs and hides private paths', () => {
  const standalone = readVectorServerConfig({});
  assert.equal(standalone.source, 'local');
  assert.equal(readVectorServerConfig({ READSB_LIVE_URL: 'http://receiver.example/data/' }).source, 'http');
  assert.equal(readVectorServerConfig({ READSB_SOURCE: 'local', READSB_LIVE_URL: 'http://receiver.example/data/' }).source, 'local');
  assert.equal(readVectorServerConfig({ READSB_SOURCE: 'vector', READSB_REMOTE_URL: 'https://receiver.example/vector' }).remoteBaseUrl?.pathname, '/vector/');
  assert.equal('databaseFile' in standalone.publicConfig, false);
  assert.equal('liveDirectory' in standalone.publicConfig, false);
  for (const env of [{ READSB_SOURCE: 'ftp' }, { READSB_LIVE_DIR: '../data' }, { READSB_HISTORY_DIR: './history' },
    { VECTOR_AIRCRAFT_DATABASE: 'db.csv' }, { READSB_SOURCE: 'vector' }, { READSB_SOURCE: 'vector', READSB_REMOTE_URL: 'http://a:b@receiver.example/' }]) {
    assert.throws(() => readVectorServerConfig(env));
  }
});

test('local source reads live, receiver, outline, full/recent traces and replay without HTTP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-local-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Local mode must never fetch tar1090'); };
  try {
    const live = join(directory, 'live');
    const history = join(directory, 'history');
    await mkdir(join(live, 'traces/23'), { recursive: true });
    await mkdir(join(history, '2026/10/04/heatmap'), { recursive: true });
    const dbFile = join(directory, 'aircraft.csv.gz');
    await writeFile(dbFile, gzipSync('ABC123;TEST-B;BALL;1001;Test balloon;2020;Test operator;\n'));
    await writeFile(join(live, 'aircraft.json'), JSON.stringify({ now: 123, aircraft: [{ hex: 'abc123', lat: 52, lon: 5, alt_baro: 2000, r: 'KEEP-ME' }] }));
    await writeFile(join(live, 'receiver.json'), '{"haveReplay":true}');
    await writeFile(join(live, 'outline.json'), '{"points":[[52,5],[53,6]]}');
    for (const kind of ['full', 'recent']) await writeFile(join(live, `traces/23/trace_${kind}_abc123.json`), gzipSync('{"icao":"abc123","trace":[]}'));
    const replay = Buffer.alloc(64, 7);
    await writeFile(join(history, '2026/10/04/heatmap/00.bin.ttf'), gzipSync(replay));
    const config = readVectorServerConfig({ READSB_LIVE_DIR: live, READSB_HISTORY_DIR: history, VECTOR_AIRCRAFT_DATABASE: dbFile });
    const snapshot = JSON.parse((await loadReadsbResource(config, 'live', 'aircraft.json')).toString());
    assert.deepEqual(snapshot.aircraft[0], { hex: 'abc123', lat: 52, lon: 5, alt_baro: 2000, r: 'KEEP-ME', t: 'BALL', desc: 'Test balloon', ownOp: 'Test operator', year: '2020', dbFlags: 9 });
    assert.equal(JSON.parse((await loadReadsbResource(config, 'live', 'receiver.json')).toString()).haveReplay, true);
    assert.equal(JSON.parse((await loadReadsbResource(config, 'live', 'outline.json')).toString()).points.length, 2);
    for (const kind of ['full', 'recent']) assert.equal(JSON.parse((await loadReadsbResource(config, 'live', `traces/23/trace_${kind}_abc123.json`)).toString()).icao, 'abc123');
    assert.deepEqual(await loadReadsbResource(config, 'history', '2026/10/04/heatmap/00.bin.ttf'), replay);
    assert.equal((await loadVectorAircraftMetadata(config, ['abc123']))['abc123'].aircraftType, 'BALL');
    await assert.rejects(() => loadReadsbResource(config, 'live', '../aircraft.json'));
    await assert.rejects(() => loadReadsbResource(config, 'live', 'https://evil.example/aircraft.json'));
    await assert.rejects(() => loadReadsbResource(config, 'live', 'traces/23/trace_recent_ffff00.json'));
  } finally { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); }
});

test('missing database does not disable trace classification or live aircraft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-fallback-'));
  try {
    await mkdir(join(root, 'traces/24'), { recursive: true });
    await writeFile(join(root, 'traces/24/trace_recent_486924.json'), gzipSync(JSON.stringify({ trace: [[0, 53, 6, 100, 0, null, 0, 0, { category: 'B2' }]] })));
    await writeFile(join(root, 'aircraft.json'), '{"now":123,"aircraft":[{"hex":"486924"}]}');
    const config = readVectorServerConfig({ READSB_LIVE_DIR: root, VECTOR_AIRCRAFT_DATABASE: join(root, 'missing.csv.gz') });
    assert.equal((await loadVectorAircraftMetadata(config, ['486924']))['486924'].category, 'B2');
    assert.equal(JSON.parse((await loadReadsbResource(config, 'live', 'aircraft.json')).toString()).aircraft.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local reads reject missing, oversized, directory and symlink resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-safe-file-'));
  try {
    await mkdir(join(root, 'allowed'));
    await writeFile(join(root, 'secret.json'), 'secret');
    await writeFile(join(root, 'allowed/large.json'), '123456');
    await symlink(root, join(root, 'allowed/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => readBoundedFile(join(root, 'allowed'), 'escape/secret.json', 100), /symlinks/);
    await assert.rejects(() => readBoundedFile(root, 'allowed', 100), /regular file/);
    await assert.rejects(() => readBoundedFile(root, 'allowed/large.json', 2), /too large/);
    await assert.rejects(() => readBoundedFile(root, 'absent', 100), /not available/);
    await assert.rejects(() => readBoundedFile(root, '../secret.json', 100), /Invalid/);
    await assert.rejects(() => readBoundedFile(root, 'secret.json', 100, AbortSignal.abort()), /abort/i);
    await assert.rejects(() => decompressResource(gzipSync(Buffer.alloc(10000)), 100), /oversized/);
    await assert.rejects(() => decompressResource(Buffer.from([0x1f, 0x8b, 0]), 100), /Invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('HTTP responses are bounded even without content-length and redirects are blocked', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(10)); }, cancel() { cancelled = true; } });
  await assert.rejects(() => readBoundedResponse(new Response(stream), 15), /too large/);
  assert.equal(cancelled, true);
  await assert.rejects(() => readBoundedResponse(new Response('abc', { headers: { 'content-length': '999' } }), 10), /too large/);
  await assert.rejects(() => readBoundedResponse(new Response(null, { status: 302, headers: { location: 'http://elsewhere.example' } }), 100), /redirects/);
});

test('Linux local reads reject named pipes and inaccessible files without blocking', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-special-file-'));
  try {
    execFileSync('mkfifo', [join(root, 'pipe.json')]);
    await assert.rejects(() => readBoundedFile(root, 'pipe.json', 100), /regular file/);
    await writeFile(join(root, 'private.json'), 'private');
    await chmod(join(root, 'private.json'), 0);
    // Root bypasses Unix file permissions; CI/normal deployments run as an ordinary user.
    if (process.getuid?.() !== 0) await assert.rejects(() => readBoundedFile(root, 'private.json', 100), /not readable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('remote Vector mode uses only fixed API paths; legacy HTTP directories still work', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.href);
    assert.equal(init?.redirect, 'manual');
    assert.equal((init?.headers as Record<string, string>)[vectorProxyHeader], '1');
    return url.pathname.endsWith('/api/aircraft-metadata') ? Response.json({ aircraft: { abc123: { aircraftType: 'BALL' } } }) : Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const remote = readVectorServerConfig({ READSB_SOURCE: 'vector', READSB_REMOTE_URL: 'http://receiver.example/vector/' });
    await loadReadsbResource(remote, 'live', 'aircraft.json');
    await loadReadsbResource(remote, 'history', '2026/10/04/heatmap/00.bin.ttf');
    assert.equal((await loadVectorAircraftMetadata(remote, ['abc123']))['abc123'].aircraftType, 'BALL');
    assert.equal(new URL(calls[0]).pathname, '/vector/api/readsb');
    assert.equal(new URL(calls[1]).searchParams.get('source'), 'history');
    assert.equal(new URL(calls[2]).pathname, '/vector/api/aircraft-metadata');
    assert.throws(() => rejectProxyLoop(new Request('http://local/api/readsb', { headers: { [vectorProxyHeader]: '1' } }), remote), /Chained/);
    const legacy = readVectorServerConfig({ READSB_LIVE_URL: 'http://legacy.example/data/' });
    await loadReadsbResource(legacy, 'live', 'receiver.json');
    assert.equal(calls.at(-1), 'http://legacy.example/data/receiver.json');
  } finally { globalThis.fetch = originalFetch; }
});

test('the API retains source/path parameters and gives bounded errors without filesystem paths', async () => {
  const response = await readsbGet(new Request('http://vector.example/api/readsb?source=live&path=../secret'));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /invalid/i);
});
