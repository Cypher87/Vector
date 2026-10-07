import assert from 'node:assert/strict';
import test from 'node:test';
import { handleUpdateRequest, readUpdateBody } from '../src/server/update-http.ts';

const enabled = { VECTOR_UPDATES_ENABLED: 'true' };
const url = 'https://radar.example/api/updates';
const post = (body: unknown, origin = 'https://radar.example') => new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('updates are off by default and reject cross-origin, missing-origin and unsupported actions before IPC', async () => {
  const never = async () => { throw new Error('Must not reach updater'); };
  assert.equal((await handleUpdateRequest(post({ action: 'apply' }), never, {})).status, 403);
  assert.equal((await handleUpdateRequest(post({ action: 'login' }, 'https://attacker.example'), never, enabled)).status, 403);
  assert.equal((await handleUpdateRequest(new Request(url, { method: 'POST' }), never, enabled)).status, 403);
  assert.equal((await handleUpdateRequest(post({ action: 'shell' }), never, enabled)).status, 400);
});

test('administrator tokens go only into scoped HTTP-only cookies; client command/source fields are discarded', async () => {
  const token = 'f'.repeat(64);
  const result = await handleUpdateRequest(post({ action: 'login', password: 'test', command: 'bad', repository: 'bad' }), async (action, body) => {
    assert.equal(action, 'login');
    assert.deepEqual(body, { password: 'test' });
    return { status: 200, body: { token } };
  }, enabled);
  assert.deepEqual(await result.json(), { authenticated: true });
  assert.match(result.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict; Path=\/api\/updates; Max-Age=900; Secure/);
  const request = post({ action: 'apply', revision: 'a'.repeat(40), confirm: true, url: 'bad', flags: ['--purge'] });
  request.headers.set('cookie', `vector_update_admin=${token}; vector_device=paired`);
  await handleUpdateRequest(request, async (action, body, cookie) => {
    assert.equal(action, 'apply'); assert.equal(cookie, token);
    assert.deepEqual(body, { revision: 'a'.repeat(40), confirm: true });
    return { status: 202, body: { phase: 'downloading' } };
  }, enabled);
});

test('JSON limits are measured in bytes even without a content-length header', async () => {
  const request = post({ action: 'login', password: 'é'.repeat(3000) });
  assert.equal(request.headers.has('content-length'), false);
  await assert.rejects(() => readUpdateBody(request), /invalid_request/);
});

test('missing update service fails closed with no private paths or raw errors', async () => {
  const result = await handleUpdateRequest(new Request(url), async () => { throw new Error('/etc/vector/private-path'); }, enabled);
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { enabled: true, ready: false, error: 'service_unavailable' });
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
