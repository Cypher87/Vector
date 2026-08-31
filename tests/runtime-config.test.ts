import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRuntimeConfig } from '../src/data/readsb.ts';

test('runtime configuration is loaded only from the server API', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let available = true;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input));
    if (!available) return new Response('Unavailable', { status: 503 });
    return Response.json({
      dataBaseUrl: '/api/readsb?source=live',
      historyBaseUrl: '/api/readsb?source=history',
      mapStyleUrl: '/map-style.json',
      siteName: 'Test Vector',
      receiverName: 'Test receiver',
      receiverLatitude: 52.1,
      receiverLongitude: 5.2,
      unitSystem: 'metric',
    });
  }) as typeof fetch;

  try {
    assert.deepEqual(await loadRuntimeConfig(), {
      dataBaseUrl: '/api/readsb?source=live',
      historyBaseUrl: '/api/readsb?source=history',
      mapStyleUrl: '/map-style.json',
      siteName: 'Test Vector',
      receiverName: 'Test receiver',
      receiverLatitude: 52.1,
      receiverLongitude: 5.2,
      unitSystem: 'metric',
    });
    available = false;
    await assert.rejects(() => loadRuntimeConfig(), /\/api\/config returned HTTP 503/);
    assert.deepEqual(requests, ['/api/config', '/api/config']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
