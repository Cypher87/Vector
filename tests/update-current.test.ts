import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentReader } from '../scripts/update-service.mjs';

const official = 'https://github.com/Cypher87/Vector.git';
const previous = { version: '0.9.0', revision: 'a'.repeat(40) };
const next = { version: '0.9.1', revision: 'b'.repeat(40) };
const unavailable = { version: '', revision: '' };

test('status polls share one origin check, with bounded caching and explicit revalidation', async () => {
  let now = 1000;
  let calls = 0;
  const current = createCurrentReader({
    resolveApp: async () => '/opt/vector/releases/previous',
    readBuild: async () => JSON.stringify(previous),
    readOrigin: async () => { calls++; await new Promise((resolve) => setImmediate(resolve)); return official; },
    now: () => now,
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => current()));
  for (const result of results) assert.deepEqual(result, previous);
  assert.equal(calls, 1, 'simultaneous status polls must not each start runuser');
  now += 59_999;
  assert.deepEqual(await current(), previous);
  assert.equal(calls, 1);
  now++;
  await current();
  assert.equal(calls, 2, 'origin validation expires after one minute');
  await current({ refresh: true });
  assert.equal(calls, 3, 'manual checks and installation verification bypass the cache');
});

test('release switches and rollback invalidate the origin cache, while build metadata is always read fresh', async () => {
  let directory = '/opt/vector/releases/previous';
  let build = previous;
  const origins: string[] = [];
  const current = createCurrentReader({
    resolveApp: async () => directory,
    readBuild: async (path: string) => { assert.equal(path, directory); return JSON.stringify(build); },
    readOrigin: async (path: string) => { origins.push(path); return official; },
  });
  assert.deepEqual(await current(), previous);
  directory = '/opt/vector/releases/next'; build = next;
  assert.deepEqual(await current(), next);
  directory = '/opt/vector/releases/previous'; build = previous;
  assert.deepEqual(await current(), previous);
  assert.equal(origins.length, 3);
  build = { ...previous, revision: 'invalid' };
  assert.deepEqual(await current(), unavailable);
  build = { ...previous, version: 'invalid' };
  assert.deepEqual(await current(), unavailable);
  directory = '/tmp/custom-checkout';
  assert.deepEqual(await current(), unavailable);
  assert.equal(origins.length, 3, 'unmanaged paths never reach Git');
});

test('origin errors and custom repositories fail closed without flooding logs; explicit checks can retry', async () => {
  let origin = 'https://example.invalid/custom.git';
  let calls = 0;
  let fails = false;
  let build = JSON.stringify(previous);
  const current = createCurrentReader({
    resolveApp: async () => '/opt/vector/releases/previous',
    readBuild: async () => build,
    readOrigin: async () => { calls++; if (fails) throw new Error('git failed'); return origin; },
  });
  assert.deepEqual(await current(), unavailable);
  assert.deepEqual(await current(), unavailable);
  assert.equal(calls, 1);
  origin = official; fails = true;
  assert.deepEqual(await current({ refresh: true }), unavailable);
  assert.deepEqual(await current(), unavailable);
  assert.equal(calls, 2);
  fails = false;
  assert.deepEqual(await current({ refresh: true }), previous);
  build = '{invalid json';
  assert.deepEqual(await current(), unavailable);
});

test('a pending old-release origin check cannot overwrite validation of a newly activated release', async () => {
  let directory = '/opt/vector/releases/previous';
  let complete: (origin: string) => void = () => {};
  const calls: string[] = [];
  const current = createCurrentReader({
    resolveApp: async () => directory,
    readBuild: async (path: string) => JSON.stringify(path.endsWith('/previous') ? previous : next),
    readOrigin: async (path: string) => {
      calls.push(path);
      return path.endsWith('/previous') ? new Promise<string>((resolve) => { complete = resolve; }) : official;
    },
  });
  const pending = current();
  await new Promise((resolve) => setImmediate(resolve));
  directory = '/opt/vector/releases/next';
  assert.deepEqual(await current(), next);
  complete(official);
  assert.deepEqual(await pending, previous);
  assert.deepEqual(await current(), next);
  assert.equal(calls.length, 2);
});
