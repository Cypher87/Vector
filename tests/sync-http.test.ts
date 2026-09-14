import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { expiredSyncCookie, readSyncStorePath, syncCookie, verifySameOrigin } from '../src/server/sync-http.ts';

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
