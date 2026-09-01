import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadReadsbTraceAircraftMetadata,
  loadTar1090AircraftMetadata,
  parseAircraftMetadataRequest,
  parseTar1090AircraftRecord,
  parseTar1090TraceMetadata,
  Tar1090DatabaseError,
} from '../src/server/tar1090-database.ts';

test('accepts only a bounded list of ICAO hex identifiers', () => {
  assert.deepEqual(
    parseAircraftMetadataRequest('http://vector.local/api/aircraft-metadata?ids=ABC123,def456,abc123'),
    ['abc123', 'def456'],
  );
  for (const url of [
    'http://vector.local/api/aircraft-metadata',
    'http://vector.local/api/aircraft-metadata?ids=~abc123',
    'http://vector.local/api/aircraft-metadata?ids=https://example.net',
    'http://vector.local/api/aircraft-metadata?ids=abc123&url=http://example.net',
  ]) {
    assert.throws(() => parseAircraftMetadataRequest(url), Tar1090DatabaseError);
  }
});

test('maps tar1090 database fields and bit flags to readable metadata', () => {
  assert.deepEqual(
    parseTar1090AircraftRecord(['PH-BAL', 'BALL', '1001', 'CAMERON BALLOONS Z-105']),
    {
      registration: 'PH-BAL',
      aircraftType: 'BALL',
      description: 'CAMERON BALLOONS Z-105',
      dbFlags: 9,
    },
  );
  assert.equal(parseTar1090AircraftRecord({}), undefined);
});

test('reads an emitter category from readsb trace state', () => {
  assert.deepEqual(parseTar1090TraceMetadata({
    timestamp: 1_788_000_000,
    trace: [
      [0, 53.1, 6.4, 500, 10, null, 0, 0, { category: 'A1' }],
      [10, 53.2, 6.5, 525, 12, null, 0, 0, {
        category: 'B2',
        r: 'PH-ECK',
      }],
    ],
  }), {
    category: 'B2',
    registration: 'PH-ECK',
    aircraftType: undefined,
    description: undefined,
    ownerOperator: undefined,
    year: undefined,
    dbFlags: undefined,
  });
});

test('loads missing classification metadata from fixed readsb trace paths', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.redirect, 'manual');
    if (url.endsWith('/traces/24/trace_recent_486924.json')) {
      return Response.json({ trace: [[0, 53.1, 6.4, 100, 9, null, 0, 0, { category: 'B2' }]] });
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    assert.deepEqual(
      await loadReadsbTraceAircraftMetadata(new URL('https://receiver.example/tar1090/data/'), ['486924']),
      {
        '486924': {
          category: 'B2',
          registration: undefined,
          aircraftType: undefined,
          description: undefined,
          ownerOperator: undefined,
          year: undefined,
          dbFlags: undefined,
        },
      },
    );
    assert.deepEqual(requests, [
      'https://receiver.example/tar1090/data/traces/24/trace_recent_486924.json',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loads metadata through the versioned tar1090 shard tree on the configured origin', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/version.json')) {
      return Response.json({ databaseVersion: 'deadbee' });
    }
    if (url.endsWith('/db-deadbee/A.js')) {
      return Response.json({ children: ['AB'] });
    }
    if (url.endsWith('/db-deadbee/AB.js')) {
      return Response.json({ C123: ['PH-BAL', 'BALL', '0000', 'CAMERON BALLOONS Z-105'] });
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    assert.deepEqual(
      await loadTar1090AircraftMetadata(new URL('https://receiver.example/tar1090/'), ['abc123', 'abffff']),
      {
        abc123: {
          registration: 'PH-BAL',
          aircraftType: 'BALL',
          description: 'CAMERON BALLOONS Z-105',
          dbFlags: 0,
        },
      },
    );
    assert.deepEqual(requests, [
      'https://receiver.example/tar1090/version.json',
      'https://receiver.example/tar1090/db-deadbee/A.js',
      'https://receiver.example/tar1090/db-deadbee/AB.js',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects redirects from the tar1090 database origin', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, {
    headers: { location: 'https://other.example/version.json' },
    status: 302,
  })) as typeof fetch;
  try {
    await assert.rejects(
      () => loadTar1090AircraftMetadata(new URL('https://redirect.example/tar1090/'), ['abc123']),
      /redirects are not allowed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
