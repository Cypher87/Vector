import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { hashUpdatePassword, verifyUpdatePassword, UpdateAuth } from '../scripts/lib/update-auth.mjs';
import { UpdateControl } from '../scripts/lib/update-control.mjs';
import { boundedJson, trustedDownload, phaseFromLine, findLatest, createUpdateServer } from '../scripts/update-service.mjs';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

const password = 'a long test password';
const hash = await hashUpdatePassword(password);
const previous = { version: '0.9.0', revision: 'a'.repeat(40) };
const next = { version: '0.9.0', revision: 'b'.repeat(40) };

test('administrator passwords are salted, bounded and separate from device codes; sessions expire and rotate', async () => {
  assert.notEqual(hash, await hashUpdatePassword(password));
  assert.equal(await verifyUpdatePassword(password, hash), true);
  assert.equal(await verifyUpdatePassword('ABC123', hash), false);
  assert.equal(await verifyUpdatePassword(hash, hash), false);
  await assert.rejects(() => hashUpdatePassword('short'));
  let now = 1000;
  const auth = new UpdateAuth(() => now);
  auth.configure(hash);
  const session = await auth.login(password, hash);
  assert.equal(auth.authenticated(session.token), true);
  now += 15 * 60_000;
  assert.equal(auth.authenticated(session.token), false);
  const fresh = await auth.login(password, hash);
  auth.configure('disabled');
  assert.equal(auth.authenticated(fresh.token), false);
});

test('administrator login has a bounded global attempt limit, including concurrent guesses', async () => {
  const auth = new UpdateAuth(); auth.configure(hash);
  const pending = auth.login('wrong', hash);
  assert.equal((await auth.login(password, hash)).status, 429);
  await pending;
  for (let i = 0; i < 4; i++) assert.equal((await auth.login('wrong', hash)).status, 401);
  assert.equal((await auth.login(password, hash)).status, 429);
});

async function fixture() {
  let now = 100_000;
  let enabled = true;
  let calls = 0;
  let complete: (() => void) | undefined;
  const writes: Record<string, unknown>[] = [];
  const control = new UpdateControl({
    now: () => now,
    config: async () => ({ VECTOR_UPDATES_ENABLED: enabled ? 'true' : 'false', VECTOR_UPDATE_PASSWORD_HASH: hash }),
    current: async () => previous,
    latest: async () => { calls++; return next; },
    persist: async (state: Record<string, unknown>) => { writes.push(state); },
    install: async (revision: string, phase: (value: string) => Promise<void>) => {
      assert.equal(revision, next.revision);
      await phase('building');
      await new Promise<void>((resolve) => { complete = resolve; });
    },
  });
  const login = await control.handle('login', { password });
  assert.ok('token' in login.body && typeof login.body.token === 'string');
  const token = login.body.token;
  return { control, token, writes, calls: () => calls, disable: () => { enabled = false; }, advance: () => { now += 16 * 60_000; }, complete: async () => { await new Promise((resolve) => setImmediate(resolve)); complete?.(); await control.job; } };
}

test('disabled updates and unauthenticated actions are enforced by the privileged controller', async () => {
  const f = await fixture();
  assert.equal((await f.control.handle('check', {}, 'pairing-code')).status, 401);
  assert.equal(f.calls(), 0);
  f.disable();
  assert.equal((await f.control.handle('status')).body.enabled, false);
  assert.equal((await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token)).status, 403);
  assert.equal(f.writes.length, 0);
});

test('same-version new builds are detected; only the freshly approved revision can start one independent job', async () => {
  const f = await fixture();
  const refreshes: boolean[] = [];
  f.control.io.current = async ({ refresh = false } = {}) => { refreshes.push(refresh); return previous; };
  assert.equal((await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token)).status, 409);
  const check = await f.control.handle('check', {}, f.token);
  assert.deepEqual(refreshes, [true, false], 'manual update checks revalidate the installation before reading status');
  assert.ok('available' in check.body);
  assert.equal(check.body.available?.revision, next.revision);
  assert.equal((await f.control.handle('check', {}, f.token)).status, 429);
  assert.equal((await f.control.handle('apply', { confirm: true, revision: '$(bad)' }, f.token)).status, 409);
  assert.equal((await f.control.handle('apply', { revision: next.revision }, f.token)).status, 409);
  assert.equal((await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token)).status, 202);
  assert.equal((await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token)).status, 409);
  await f.complete();
  assert.equal(f.writes.at(-1)?.phase, 'complete');
  assert.equal((await f.control.handle('status')).body.phase, 'complete', 'completion survives losing the browser session');
  assert.equal('available' in (await f.control.handle('status')).body, false);
});

test('old update approvals and expired administrator sessions cannot start a job', async () => {
  const f = await fixture();
  await f.control.handle('check', {}, f.token);
  f.advance();
  assert.equal((await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token)).status, 401);
  const login = await f.control.handle('login', { password });
  assert.ok('token' in login.body && typeof login.body.token === 'string');
  assert.equal((await f.control.handle('apply', { confirm: true, revision: next.revision }, login.body.token)).status, 409);
});

test('completion reports the pending worker restart and the approved target even after authentication expires', async () => {
  const f = await fixture();
  let finished = false;
  f.control.io.finished = () => { finished = true; };
  await f.control.handle('check', {}, f.token);
  await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token);
  const running = await f.control.handle('status');
  assert.ok('targetRevision' in running.body && 'restarting' in running.body);
  assert.equal(running.body.targetRevision, next.revision);
  assert.equal(running.body.restarting, false);
  await f.complete();
  assert.equal(finished, true);
  const completed = await f.control.handle('status');
  assert.ok('restarting' in completed.body);
  assert.equal(completed.body.restarting, true);
  assert.equal(f.writes.at(-1)?.phase, 'complete');
  assert.equal((await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token)).status, 409);
});

test('failure is persisted without leaking installer output and recovery failures remain explicit', async () => {
  const f = await fixture();
  f.control.io.install = async () => { throw new Error('recovery_required'); };
  await f.control.handle('check', {}, f.token);
  await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token);
  await f.control.job;
  assert.equal(f.writes.at(-1)?.phase, 'failed');
  assert.equal(f.writes.at(-1)?.error, 'recovery_required');
});

test('an unavailable status journal prevents installation and reports a failure, never success', async () => {
  const f = await fixture();
  let installs = 0;
  f.control.io.persist = async () => { throw new Error('private disk error'); };
  f.control.io.install = async () => { installs++; };
  await f.control.handle('check', {}, f.token);
  await f.control.handle('apply', { confirm: true, revision: next.revision }, f.token);
  await f.control.job;
  assert.equal(installs, 0);
  const result = await f.control.handle('status');
  assert.equal(result.body.phase, 'failed');
  assert.equal(result.body.error, 'recovery_required');
});

test('update transport rejects oversized streaming bodies and downloads, including absent content lengths', async () => {
  await assert.rejects(() => boundedJson(Readable.from([Buffer.from('{"x":"'), Buffer.alloc(4096, 65), Buffer.from('"}')])), /request_too_large/);
  let cancelled = false;
  await assert.rejects(() => trustedDownload('https://raw.githubusercontent.com/Cypher87/Vector/test', 1024, async (_url, options) => {
    assert.equal(options?.redirect, 'error');
    return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(2048)); }, cancel() { cancelled = true; } }));
  }), /download_too_large/);
  assert.equal(cancelled, true);
  await assert.rejects(() => trustedDownload('http://localhost/private', 1024), /untrusted_source/);
  await assert.rejects(() => trustedDownload('https://attacker.example/install.sh', 1024), /untrusted_source/);
  assert.equal(phaseFromLine('Installing locked dependencies and creating the production build.'), 'building');
  assert.equal(phaseFromLine('arbitrary output /etc/vector/secret'), null);
});

test('only forward commits on the official branch are offered, never downgrades or divergent histories', async () => {
  let status = 'ahead';
  const download = async (url: string) => {
    if (url.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { type: 'commit', sha: next.revision } });
    if (url.endsWith('/package.json')) return '{"version":"0.9.0"}';
    assert.equal(url, `https://api.github.com/repos/Cypher87/Vector/compare/${previous.revision}...${next.revision}?per_page=1`);
    return JSON.stringify({ status });
  };
  assert.equal((await findLatest(previous.revision, download)).revision, next.revision);
  status = 'behind';
  assert.equal((await findLatest(previous.revision, download)).revision, previous.revision);
  status = 'diverged';
  await assert.rejects(() => findLatest(previous.revision, download), /not_a_forward_update/);
  await assert.rejects(() => findLatest('../bad', download), /invalid_revision/);
});

test('worker HTTP transport accepts only fixed actions and remains available after malformed/oversized requests', async () => {
  let calls = 0;
  const server = createUpdateServer({ handle: async (action: string) => { calls++; return { status: 200, body: { action } }; } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${origin}/shell`)).status, 404);
    assert.equal((await fetch(`${origin}/apply?command=bad`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${origin}/login`, { method: 'POST', body: '{}' , headers: { authorization: 'Bearer invalid' } })).status, 401);
    assert.equal(calls, 0);
    await fetch(`${origin}/login`, { method: 'POST', body: JSON.stringify({ password: 'x'.repeat(10_000) }) }).catch(() => null);
    assert.equal(calls, 0);
    assert.deepEqual(await (await fetch(`${origin}/status`)).json(), { action: 'status' });
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
