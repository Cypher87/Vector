import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AccountStore } from '../src/server/account-store.ts';

test('local accounts use password hashes and persistent server sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-account-'));
  const file = join(directory, 'accounts.json');
  try {
    const store = new AccountStore(file);
    const account = await store.createLocalUser({
      email: ' Pilot@Example.test ',
      name: ' Test  Pilot ',
      password: 'a sufficiently long passphrase',
    });
    assert.equal(account.email, 'pilot@example.test');
    assert.equal(account.name, 'Test Pilot');
    assert.deepEqual(account.providers, ['local']);
    assert.equal(await store.authenticateLocal('pilot@example.test', 'incorrect password'), undefined);
    assert.equal((await store.authenticateLocal('PILOT@example.test', 'a sufficiently long passphrase'))?.id, account.id);

    const raw = await readFile(file, 'utf8');
    assert.doesNotMatch(raw, /a sufficiently long passphrase/);
    assert.match(raw, /"digest"/);

    const token = await store.createSession(account.id);
    assert.equal((await store.session(token))?.account.id, account.id);
    assert.equal(await store.session('not-a-session'), undefined);

    await store.savePreferences(account.id, {
      favoriteAircraft: ['ABC123'],
      language: 'en',
      unitSystem: 'metric',
    });
    assert.deepEqual((await store.session(token))?.preferences, {
      favoriteAircraft: ['abc123'],
      language: 'en',
      unitSystem: 'metric',
    });

    await store.deleteSession(token);
    assert.equal(await store.session(token), undefined);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('first-user mode cannot create a second local account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vector-account-'));
  try {
    const store = new AccountStore(join(directory, 'accounts.json'));
    await store.createLocalUser({ email: 'first@example.test', name: 'First', onlyFirst: true, password: 'first secure password' });
    await assert.rejects(
      () => store.createLocalUser({ email: 'second@example.test', name: 'Second', onlyFirst: true, password: 'second secure password' }),
      /REGISTRATION_DISABLED/,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
