import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { AircraftDatabase, decodeAircraftDatabase, parseAircraftDatabase } from '../src/server/aircraft-database.ts';
import { updateAircraftDatabase } from '../src/server/aircraft-database-update.ts';

const csv = 'ABC123;TEST-A;A320;1001;Test aircraft;2021;Test operator;\nDEF456;;BALL;0010;Test balloon;;;\n';
const responseFetch = (body: Buffer | string, status = 200) => (async () => new Response(typeof body === 'string' ? body : new Uint8Array(body), { status })) as typeof fetch;

test('imports the readsb CSV schema, flags, UTF-8 and partial records', async () => {
  const records = await decodeAircraftDatabase(gzipSync(csv));
  assert.equal(records.size, 2);
  assert.deepEqual(records.get('abc123'), { registration: 'TEST-A', aircraftType: 'A320', dbFlags: 9, description: 'Test aircraft', year: '2021', ownerOperator: 'Test operator' });
  assert.equal(records.get('def456')?.dbFlags, 4);
  assert.equal(records.get('ABC123')?.aircraftType, 'A320');
  assert.equal(records.get('def456garbage'), undefined);
  assert.equal(records.get('000000'), undefined);
  assert.equal(parseAircraftDatabase(csv.trimEnd()).get('def456')?.aircraftType, 'BALL');
  assert.equal(parseAircraftDatabase(csv.replaceAll('\n', '\r\n')).get('def456')?.aircraftType, 'BALL');
  assert.equal(parseAircraftDatabase(csv.replace('Test aircraft', 'Avión')).get('abc123')?.description, 'Avión');
  for (const value of ['', '<html>error</html>', csv + csv, 'not-hex;X;BALL;0000;Y;;;\n', csv.replace('1001', 'evil'), csv.replace('Test aircraft', 'bad\0value')]) {
    assert.throws(() => parseAircraftDatabase(value));
  }
});

test('atomic updates preserve existing data on errors, reload in the cache and leave no locks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-db-'));
  const file = join(root, 'aircraft.csv.gz');
  try {
    const store = new AircraftDatabase(file, 0);
    assert.deepEqual(await store.lookup(['abc123']), {});
    const result = await updateAircraftDatabase(file, { fetch: responseFetch(gzipSync(csv)), minimumRecords: 2 });
    assert.equal(result.records, 2);
    assert.equal((await store.lookup(['abc123']))['abc123'].aircraftType, 'A320');
    const original = await readFile(file);
    for (const fetch of [responseFetch('error', 503), responseFetch('<html>broken</html>'), responseFetch(gzipSync('ABC123;X;A320;0;;;;\n'))]) {
      await assert.rejects(() => updateAircraftDatabase(file, { fetch, minimumRecords: 2 }));
      assert.deepEqual(await readFile(file), original);
    }
    await writeFile(file, 'corrupt');
    assert.equal((await store.lookup(['abc123']))['abc123'].aircraftType, 'A320');
    await updateAircraftDatabase(file, { fetch: responseFetch(gzipSync(csv.replace('A320', 'H145'))), minimumRecords: 2 });
    assert.equal((await store.lookup(['abc123']))['abc123'].aircraftType, 'H145');
    assert.deepEqual(await readdir(root), ['aircraft.csv.gz']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the updater fetches only the fixed HTTPS source and rejects redirects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-db-origin-'));
  try {
    await assert.rejects(() => updateAircraftDatabase(join(root, 'db.gz'), { fetch: (async (input, init) => {
      assert.equal(String(input), 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/refs/heads/csv/aircraft.csv.gz');
      assert.equal(init?.redirect, 'error');
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/db' } });
    }) as typeof fetch }), /redirects/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
