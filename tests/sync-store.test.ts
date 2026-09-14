import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { formatPairingCode, normalizePairingCode, SyncStore } from '../src/server/sync-store.ts';

test('a one-time pairing code connects a second device without exposing tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-sync-'));
  const file = join(directory, 'sync.json');
  try {
    const store = new SyncStore(file);
    const first = await store.createProfile({ favoriteAircraft: ['ABC123'], language: 'en' });
    assert.deepEqual(await store.session(first.token), {
      preferences: { favoriteAircraft: ['abc123'], language: 'en' },
      profileId: first.profileId,
    });

    const raw = await readFile(file, 'utf8');
    assert.doesNotMatch(raw, new RegExp(first.token));
    assert.doesNotMatch(raw, /ABC123/);

    const pairing = await store.createPairingCode(first.profileId);
    assert.match(pairing.code, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    assert.doesNotMatch(await readFile(file, 'utf8'), new RegExp(pairing.code.replace('-', '')));

    const second = await store.pair(pairing.code.toLowerCase());
    assert.equal(second.profileId, first.profileId);
    assert.deepEqual((await store.session(second.token))?.preferences, first.preferences);
    await assert.rejects(() => store.pair(pairing.code), /PAIRING_CODE_INVALID/);

    await store.savePreferences(first.profileId, { distanceRings: true, unitSystem: 'imperial' });
    assert.deepEqual((await store.session(second.token))?.preferences, { distanceRings: true, unitSystem: 'imperial' });

    await store.disconnect(first.token);
    assert.equal(await store.session(first.token), undefined);
    assert.equal((await store.session(second.token))?.profileId, first.profileId);

    await store.deleteProfile(first.profileId);
    assert.equal(await store.session(second.token), undefined);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('pairing code normalization is strict and rejects invalid values', async () => {
  assert.equal(normalizePairingCode('ab3-de4'), 'AB3DE4');
  assert.equal(formatPairingCode('AB3DE4'), 'AB3-DE4');

  const directory = await mkdtemp(join(tmpdir(), 'vector-sync-'));
  try {
    const store = new SyncStore(join(directory, 'sync.json'));
    await assert.rejects(() => store.pair('../ABC123'), /PAIRING_CODE_INVALID/);
    await assert.rejects(() => store.pair('O0I1L2'), /PAIRING_CODE_INVALID/);
    await assert.rejects(() => store.pair('ABC12'), /PAIRING_CODE_INVALID/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
