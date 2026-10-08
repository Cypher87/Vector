import assert from 'node:assert/strict';
import test from 'node:test';
import { completedUpdateNeedsReload, readUpdateReloadMarker, type UpdateStatus } from '../src/domain/update-progress.ts';

const oldRevision = 'a'.repeat(40);
const newRevision = 'b'.repeat(40);
const complete: UpdateStatus = { enabled: true, ready: true, phase: 'complete', current: { version: '0.9.1', revision: newRevision } };

test('a completed same-version update refreshes an old browser, not a browser already on the current revision', () => {
  assert.equal(completedUpdateNeedsReload(complete, oldRevision, true, null), true);
  assert.equal(completedUpdateNeedsReload(complete, newRevision, true, null), false);
  assert.equal(completedUpdateNeedsReload(complete, newRevision, false, null), false);
  assert.equal(completedUpdateNeedsReload(complete, oldRevision, false, null), true);
});

test('development builds only refresh a witnessed update; a per-tab marker prevents reload loops', () => {
  assert.equal(completedUpdateNeedsReload(complete, '', false, null), false);
  assert.equal(completedUpdateNeedsReload(complete, '', true, null), true);
  assert.equal(completedUpdateNeedsReload(complete, oldRevision, true, newRevision), false);
  assert.equal(completedUpdateNeedsReload(complete, oldRevision, true, oldRevision), true);
});

test('failed, in-progress and invalid builds never request a success refresh', () => {
  for (const phase of ['building', 'restoring', 'failed', 'idle']) {
    assert.equal(completedUpdateNeedsReload({ ...complete, phase }, oldRevision, true, null), false);
  }
  assert.equal(completedUpdateNeedsReload({ ...complete, error: 'update_failed' }, oldRevision, true, null), false);
  assert.equal(completedUpdateNeedsReload({ ...complete, current: { version: '0.9.1', revision: '' } }, oldRevision, true, null), false);
});

test('reload markers expire and ignore corrupt or future-dated storage', () => {
  const now = 4_000_000;
  assert.equal(readUpdateReloadMarker(JSON.stringify({ revision: newRevision, at: now - 1_000 }), now), newRevision);
  assert.equal(readUpdateReloadMarker(JSON.stringify({ revision: newRevision, at: now - 3_600_000 }), now), null);
  assert.equal(readUpdateReloadMarker(JSON.stringify({ revision: newRevision, at: now + 1 }), now), null);
  for (const value of [null, '{broken', 'null', '{}', '[]', '{"revision":"invalid","at":4000000}']) {
    assert.equal(readUpdateReloadMarker(value, now), null);
  }
});
