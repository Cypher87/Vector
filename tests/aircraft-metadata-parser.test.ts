import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAircraftMetadataRequest, parseReadsbTraceMetadata } from '../src/server/aircraft-metadata-parser.ts';
import { loadVectorAircraftMetadata } from '../src/server/aircraft-metadata-source.ts';
import { readVectorServerConfig } from '../src/server/vector-config.ts';
import { ResourceError } from '../src/server/bounded-resource.ts';

test('metadata requests accept only a bounded list of ICAO identifiers', () => {
  const url = 'http://vector.local/api/aircraft-metadata';
  assert.deepEqual(parseAircraftMetadataRequest(`${url}?ids=ABC123,def456,abc123`), ['abc123', 'def456']);
  for (const query of ['', '?ids=~abc123', '?ids=https://example.net', '?ids=abc123&url=http://example.net',
    '?ids=abc123&ids=def456', '?ids=', `?ids=${Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(6, '0')).join(',')}`]) {
    assert.throws(() => parseAircraftMetadataRequest(url + query), (error) => error instanceof ResourceError && error.status === 400);
  }
});

test('readsb trace metadata combines root and state snapshots without guessing missing fields', () => {
  const result = parseReadsbTraceMetadata({ t: 'BALL', year: 2021, trace: [
    [0, 53.1, 6.4, 500, 10, null, 0, 0, { category: 'A1' }],
    null, [10, 53.2, 6.5, 525, 12, null, 0, 0, { category: 'B2', r: 'TEST-B', dbFlags: 1 }],
  ] });
  assert.equal(result?.category, 'B2');
  assert.equal(result?.registration, 'TEST-B');
  assert.equal(result?.aircraftType, 'BALL');
  assert.equal(result?.year, '2021');
  assert.equal(result?.dbFlags, 1);
  for (const value of [null, [], {}, { trace: [null, [], 'broken'] }]) assert.equal(parseReadsbTraceMetadata(value), undefined);
});

test('missing database classification is recovered from local recent/full readsb traces without network access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-trace-metadata-'));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected network dependency'); };
  try {
    const config = readVectorServerConfig({ READSB_SOURCE: 'local', READSB_LIVE_DIR: root, VECTOR_AIRCRAFT_DATABASE: join(root, 'missing.csv.gz') });
    await mkdir(join(root, 'traces/23'), { recursive: true });
    await mkdir(join(root, 'traces/56'), { recursive: true });
    await writeFile(join(root, 'traces/23/trace_recent_abc123.json'), JSON.stringify({ trace: [[0, 53, 6, 100, 9, null, 0, 0, { category: 'B2' }]] }));
    await writeFile(join(root, 'traces/56/trace_full_def456.json'), JSON.stringify({ t: 'EC35', category: 'A7' }));
    const result = await loadVectorAircraftMetadata(config, ['abc123', 'def456', '000000']);
    assert.equal(result.abc123.category, 'B2');
    assert.equal(result.def456.aircraftType, 'EC35');
    assert.equal(result['000000'], undefined);
    assert.equal(calls, 0);
    await assert.rejects(() => loadVectorAircraftMetadata(config, ['https://other.example/']));
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});
