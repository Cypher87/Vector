import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  createPairingCodeResponse,
  createProfileResponse,
  disconnectDeviceResponse,
  eventsResponse,
  identifySyncDevice,
  pairResponse,
  readSyncStorePath,
  renameDeviceResponse,
  savePreferencesResponse,
  sessionResponse,
  expiredSyncCookie,
  syncCookie,
  verifySameOrigin,
} from '../src/server/sync-http.ts';

test('synchronization storage has an external configurable path', () => {
  assert.equal(readSyncStorePath({ VECTOR_SYNC_STORE: '/srv/vector-state/sync.json' }, '/app'), resolve('/srv/vector-state/sync.json'));
  assert.match(readSyncStorePath({}, '/app'), process.platform === 'win32' ? /\.vector\\sync\.json$/ : /^\/var\/lib\/vector\/sync\.json$/);
});

test('state-changing synchronization requests reject another origin', () => {
  assert.doesNotThrow(() => verifySameOrigin(new Request('http://radar.test/api/sync/profile', {
    headers: { origin: 'http://radar.test' },
  })));
  assert.throws(() => verifySameOrigin(new Request('http://radar.test/api/sync/profile', {
    headers: { origin: 'https://attacker.test' },
  })), /INVALID_ORIGIN/);
});

test('device cookies are HTTP-only, same-site and secure only over HTTPS', () => {
  const httpCookie = syncCookie(new Request('http://radar.test/api/sync/profile'), 'secret-token');
  assert.match(httpCookie, /HttpOnly/);
  assert.match(httpCookie, /SameSite=Lax/);
  assert.doesNotMatch(httpCookie, /; Secure/);
  assert.match(syncCookie(new Request('https://radar.test/api/sync/profile'), 'secret-token'), /; Secure/);
  assert.match(expiredSyncCookie(new Request('http://radar.test/api/sync/disconnect')), /Max-Age=0/);
});

test('device metadata is reduced to a browser, operating system and device type', () => {
  const chromeWindows = identifySyncDevice(new Request('http://radar.test', {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' },
  }));
  assert.deepEqual(chromeWindows, { browser: 'Chrome', operatingSystem: 'Windows', type: 'desktop' });

  const safariIPhone = identifySyncDevice(new Request('http://radar.test', {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' },
  }));
  assert.deepEqual(safariIPhone, { browser: 'Safari', operatingSystem: 'iOS', type: 'mobile' });
});

test('a preference update is delivered live to another paired device', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-sync-http-'));
  const previousStore = process.env.VECTOR_SYNC_STORE;
  process.env.VECTOR_SYNC_STORE = join(directory, 'sync.json');
  const origin = 'http://radar.test';
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    return new Request(`${origin}${path}`, { ...init, headers });
  };
  try {
    const created = await createProfileResponse(request('/api/sync/profile', {
      body: JSON.stringify({ preferences: { favoriteAircraft: ['4840d6'], language: 'nl' } }),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36',
      },
      method: 'POST',
    }));
    assert.equal(created.status, 201);
    const firstCookie = created.headers.get('set-cookie')?.split(';')[0];
    assert.ok(firstCookie);

    const codeResponse = await createPairingCodeResponse(request('/api/sync/pairing-code', {
      headers: { cookie: firstCookie },
      method: 'POST',
    }));
    const { code } = await codeResponse.json() as { code: string };
    const paired = await pairResponse(request('/api/sync/pair', {
      body: JSON.stringify({ code }),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1',
      },
      method: 'POST',
    }));
    const secondCookie = paired.headers.get('set-cookie')?.split(';')[0];
    assert.ok(secondCookie);
    const pairedBody = await paired.json() as {
      deviceId: string;
      devices: { browser?: string; current: boolean; id: string; operatingSystem?: string }[];
    };
    assert.equal(pairedBody.devices.length, 2);
    assert.equal(pairedBody.devices.find((device) => device.current)?.browser, 'Safari');
    assert.equal(pairedBody.devices.find((device) => device.current)?.operatingSystem, 'iOS');

    const controller = new AbortController();
    const eventResponse = await eventsResponse(request('/api/sync/events', {
      headers: { cookie: secondCookie },
      signal: controller.signal,
    }));
    const reader = eventResponse.body?.getReader();
    assert.ok(reader);
    await reader.read();

    const saved = await savePreferencesResponse(request('/api/sync/preferences', {
      body: JSON.stringify({ patch: { favoriteAircraft: { add: ['abc123'] }, settings: { language: 'en' } } }),
      headers: { 'content-type': 'application/json', cookie: firstCookie },
      method: 'PUT',
    }));
    assert.equal(saved.status, 200);
    const eventChunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Live synchronization event timed out')), 1_000)),
    ]);
    const eventText = new TextDecoder().decode(eventChunk.value);
    assert.match(eventText, /"type":"preferences"/);

    const secondSession = await sessionResponse(request('/api/sync/session', { headers: { cookie: secondCookie } }));
    const sessionBody = await secondSession.json() as {
      devices: { current: boolean; id: string }[];
      preferences: { favoriteAircraft: string[]; language: string };
    };
    assert.equal(sessionBody.devices.length, 2);
    assert.deepEqual(sessionBody.preferences, { favoriteAircraft: ['4840d6', 'abc123'], language: 'en' });

    const firstDeviceId = sessionBody.devices.find((device) => !device.current)?.id;
    assert.ok(firstDeviceId);
    const renamed = await renameDeviceResponse(request('/api/sync/device', {
      body: JSON.stringify({ deviceId: firstDeviceId, name: 'Woonkamer' }),
      headers: { 'content-type': 'application/json', cookie: secondCookie },
      method: 'PATCH',
    }));
    assert.equal(renamed.status, 200);
    const renamedBody = await renamed.json() as { devices: { id: string; name?: string }[] };
    assert.equal(renamedBody.devices.find((device) => device.id === firstDeviceId)?.name, 'Woonkamer');

    const disconnected = await disconnectDeviceResponse(request('/api/sync/device', {
      body: JSON.stringify({ deviceId: firstDeviceId }),
      headers: { 'content-type': 'application/json', cookie: secondCookie },
      method: 'DELETE',
    }));
    assert.equal(disconnected.status, 200);
    const disconnectedBody = await disconnected.json() as { devices: { id: string }[] };
    assert.deepEqual(disconnectedBody.devices.map((device) => device.id), [pairedBody.deviceId]);
    const removedSession = await sessionResponse(request('/api/sync/session', { headers: { cookie: firstCookie } }));
    assert.equal((await removedSession.json() as { connected: boolean }).connected, false);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  } finally {
    if (previousStore === undefined) delete process.env.VECTOR_SYNC_STORE;
    else process.env.VECTOR_SYNC_STORE = previousStore;
    await rm(directory, { force: true, recursive: true });
  }
});
