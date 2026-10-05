import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseAircraftDatabaseStatus, aircraftDatabaseHealth, databaseStaleAfterMs } from '../src/domain/aircraft-database-status.ts';
import { loadAircraftDatabaseStatus } from '../src/server/aircraft-database-status.ts';
import { readVectorServerConfig } from '../src/server/vector-config.ts';

test('database freshness uses the last verified update, with an explicit 48-hour warning', () => {
  const now = Date.now();
  const recent = parseAircraftDatabaseStatus({ state: 'ready', location: 'local', updatedAt: now, records: 123 });
  assert.equal(aircraftDatabaseHealth(recent, now), 'ready');
  assert.equal(aircraftDatabaseHealth(recent, now + databaseStaleAfterMs), 'ready');
  assert.equal(aircraftDatabaseHealth(recent, now + databaseStaleAfterMs + 1), 'stale');
  assert.equal(aircraftDatabaseHealth({ ...recent, state: 'unavailable' }, now), 'unavailable');
  for (const changes of [{ updatedAt: null }, { updatedAt: Infinity }, { updatedAt: now + 600_000 }, { records: -1 }, { records: 1.5 }, { state: 'external' }, { state: 'made-up' }]) {
    assert.throws(() => parseAircraftDatabaseStatus({ ...recent, ...changes }, now));
  }
  assert.deepEqual(parseAircraftDatabaseStatus({ ...recent, path: '/private/location' }), recent);
});

test('remote database status uses only the configured Vector, limits response size and rejects redirects', async () => {
  const config = readVectorServerConfig({ READSB_SOURCE: 'vector', READSB_REMOTE_URL: 'https://receiver.example/vector/' });
  const upstream = { state: 'ready', location: 'local', updatedAt: Date.now(), records: 123, secretPath: '/private/database.csv.gz' };
  const signal = new AbortController().signal;
  const result = await loadAircraftDatabaseStatus(config, signal, (async (input, init) => {
    assert.equal(String(input), 'https://receiver.example/vector/api/aircraft-database-status');
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('x-vector-data-proxy'), '1');
    assert.equal(init?.signal, signal);
    return Response.json(upstream);
  }) as typeof fetch);
  assert.deepEqual(result, { state: 'ready', location: 'receiver', updatedAt: upstream.updatedAt, records: 123 });
  for (const response of [
    new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } }),
    new Response('x'.repeat(4097)), Response.json({ state: 'ready' }), new Response(null, { status: 404 }),
  ]) await assert.rejects(() => loadAircraftDatabaseStatus(config, signal, (async () => response) as typeof fetch));
});

test('missing local metadata does not fabricate an update date', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-db-status-'));
  try {
    const config = readVectorServerConfig({ READSB_SOURCE: 'local', VECTOR_AIRCRAFT_DATABASE: join(root, 'missing.csv.gz') });
    assert.deepEqual(await loadAircraftDatabaseStatus(config), { state: 'missing', location: 'local', updatedAt: null, records: null });
  } finally { await rm(root, { recursive: true, force: true }); }
});
