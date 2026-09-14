import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  formatPairingCode,
  normalizeDeviceName,
  normalizePairingCode,
  SyncStore,
} from '../src/server/sync-store.ts';

test('a one-time pairing code connects a second device without exposing tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-sync-'));
  const file = join(directory, 'sync.json');
  try {
    const store = new SyncStore(file);
    const first = await store.createProfile(
      { favoriteAircraft: ['ABC123'], language: 'en' },
      { browser: 'Chrome', operatingSystem: 'Windows', type: 'desktop' },
    );
    const firstSession = await store.session(first.token);
    assert.equal(firstSession?.deviceId, first.deviceId);
    assert.deepEqual(firstSession?.devices.map(({ browser, current, operatingSystem, type }) => ({
      browser, current, operatingSystem, type,
    })), [{ browser: 'Chrome', current: true, operatingSystem: 'Windows', type: 'desktop' }]);
    assert.deepEqual(firstSession?.preferences, { favoriteAircraft: ['abc123'], language: 'en' });
    assert.equal(firstSession?.profileId, first.profileId);
    assert.equal(firstSession?.revision, 1);

    const raw = await readFile(file, 'utf8');
    assert.doesNotMatch(raw, new RegExp(first.token));
    assert.doesNotMatch(raw, /ABC123/);

    const pairing = await store.createPairingCode(first.profileId);
    assert.match(pairing.code, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    assert.doesNotMatch(await readFile(file, 'utf8'), new RegExp(pairing.code.replace('-', '')));

    const second = await store.pair(
      pairing.code.toLowerCase(),
      { browser: 'Safari', operatingSystem: 'iOS', type: 'mobile' },
    );
    assert.equal(second.profileId, first.profileId);
    assert.equal(second.devices.length, 2);
    assert.equal(second.devices.find((device) => device.id === second.deviceId)?.current, true);
    assert.equal(second.devices.find((device) => device.id === first.deviceId)?.current, false);
    assert.deepEqual((await store.session(second.token))?.preferences, first.preferences);
    await assert.rejects(() => store.pair(pairing.code), /PAIRING_CODE_INVALID/);

    await store.savePreferencePatch(first.profileId, { settings: { distanceRings: true, unitSystem: 'imperial' } });
    assert.deepEqual((await store.session(second.token))?.preferences, {
      distanceRings: true,
      favoriteAircraft: ['abc123'],
      language: 'en',
      unitSystem: 'imperial',
    });

    await assert.rejects(
      () => store.disconnectDevice(first.profileId, second.token, second.deviceId),
      /CURRENT_DEVICE/,
    );
    const unrelated = await store.createProfile({}, { browser: 'Firefox', operatingSystem: 'Linux', type: 'desktop' });
    await assert.rejects(
      () => store.disconnectDevice(first.profileId, second.token, unrelated.deviceId),
      /DEVICE_NOT_FOUND/,
    );
    const renamed = await store.renameDevice(first.profileId, second.token, first.deviceId, '  Woonkamer\nradar  ');
    assert.equal(renamed.devices.find((device) => device.id === first.deviceId)?.name, 'Woonkamer radar');
    await assert.rejects(
      () => store.renameDevice(first.profileId, second.token, first.deviceId, 'x'.repeat(41)),
      /DEVICE_NAME_INVALID/,
    );
    await assert.rejects(
      () => store.renameDevice(first.profileId, second.token, unrelated.deviceId, 'Niet toegestaan'),
      /DEVICE_NOT_FOUND/,
    );
    const onlySecond = await store.disconnectDevice(first.profileId, second.token, first.deviceId);
    assert.equal(onlySecond.devices.length, 1);
    assert.equal(onlySecond.devices[0].id, second.deviceId);
    assert.equal(await store.session(first.token), undefined);

    await store.disconnect(first.token);
    assert.equal((await store.session(second.token))?.profileId, first.profileId);

    await store.deleteProfile(first.profileId);
    assert.equal(await store.session(second.token), undefined);
    await store.deleteProfile(unrelated.profileId);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('version 1 synchronization data migrates without losing preferences or sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-sync-'));
  const file = join(directory, 'sync.json');
  const token = 'legacy-device-token';
  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    await writeFile(file, JSON.stringify({
      devices: [{ createdAt: 1, expiresAt: Date.now() + 60_000, profileId: 'legacy-profile', tokenHash }],
      pairingCodes: [],
      profiles: [{ createdAt: 1, id: 'legacy-profile', preferences: { language: 'nl' }, updatedAt: Date.now() }],
      version: 1,
    }));
    const store = new SyncStore(file);
    const session = await store.session(token);
    assert.equal(session?.deviceId, `legacy-${tokenHash.slice(0, 16)}`);
    assert.equal(session?.revision, 1);
    assert.deepEqual(session?.devices.map(({ current, type }) => ({ current, type })), [
      { current: true, type: 'unknown' },
    ]);
    assert.deepEqual(session?.preferences, { language: 'nl' });

    const identified = await store.touchSession(token, {
      browser: 'Chrome',
      operatingSystem: 'Linux',
      type: 'desktop',
    });
    assert.equal(identified?.devices[0].browser, 'Chrome');
    assert.equal(identified?.devices[0].operatingSystem, 'Linux');
    assert.equal(identified?.devices[0].type, 'desktop');

    await store.savePreferencePatch('legacy-profile', { settings: { mapLabels: false } });
    const migrated = JSON.parse(await readFile(file, 'utf8')) as { profiles: { revision: number }[]; version: number };
    assert.equal(migrated.version, 3);
    assert.equal(migrated.profiles[0].revision, 2);
    assert.deepEqual((await store.session(token))?.preferences, { language: 'nl', mapLabels: false });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('version 2 device sessions migrate to the device overview', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-sync-'));
  const file = join(directory, 'sync.json');
  const token = 'version-two-device-token';
  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    await writeFile(file, JSON.stringify({
      devices: [{
        createdAt: 123,
        expiresAt: Date.now() + 60_000,
        id: 'version-two-device',
        profileId: 'version-two-profile',
        tokenHash,
      }],
      pairingCodes: [],
      profiles: [{
        createdAt: 123,
        id: 'version-two-profile',
        preferences: { unitSystem: 'metric' },
        revision: 4,
        updatedAt: Date.now(),
      }],
      version: 2,
    }));

    const store = new SyncStore(file);
    const session = await store.touchSession(token, {
      browser: 'Firefox',
      operatingSystem: 'Linux',
      type: 'desktop',
    });
    assert.equal(session?.deviceId, 'version-two-device');
    assert.equal(session?.revision, 4);
    assert.equal(session?.devices[0].browser, 'Firefox');
    assert.equal(session?.devices[0].lastSeenAt >= 123, true);
    assert.equal((JSON.parse(await readFile(file, 'utf8')) as { version: number }).version, 3);
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

test('device names are compact, optional and bounded', () => {
  assert.equal(normalizeDeviceName('  Mijn\n iPad  '), 'Mijn iPad');
  assert.equal(normalizeDeviceName('   '), undefined);
  assert.throws(() => normalizeDeviceName('x'.repeat(41)), /DEVICE_NAME_INVALID/);
  assert.throws(() => normalizeDeviceName(123), /DEVICE_NAME_INVALID/);
});
