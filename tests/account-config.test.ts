import assert from 'node:assert/strict';
import test from 'node:test';
import { readAccountServerConfig } from '../src/server/account-config.ts';

test('account providers are disabled safely by default', () => {
  const config = readAccountServerConfig({ VECTOR_ACCOUNT_STORE: '/tmp/vector-test.json' });
  assert.equal(config.apple, undefined);
  assert.equal(config.google, undefined);
  assert.equal(config.localRegistration, 'first-user');
  assert.equal(config.storePath, '/tmp/vector-test.json');
});

test('Google requires a complete client configuration', () => {
  assert.throws(
    () => readAccountServerConfig({ VECTOR_GOOGLE_CLIENT_ID: 'client' }),
    /must be configured together/,
  );
  const config = readAccountServerConfig({
    VECTOR_GOOGLE_CLIENT_ID: 'client',
    VECTOR_GOOGLE_CLIENT_SECRET: 'secret',
    VECTOR_PUBLIC_URL: 'https://radar.example.test',
  });
  assert.equal(config.google?.clientId, 'client');
  assert.throws(() => readAccountServerConfig({
    VECTOR_GOOGLE_CLIENT_ID: 'client',
    VECTOR_GOOGLE_CLIENT_SECRET: 'secret',
    VECTOR_PUBLIC_URL: 'http://192.0.2.20:3000',
  }), /requires an HTTPS/);
});

test('Apple requires all credentials and a public HTTPS URL', () => {
  const apple = {
    VECTOR_APPLE_CLIENT_ID: 'com.example.radar',
    VECTOR_APPLE_KEY_ID: 'KEY123',
    VECTOR_APPLE_PRIVATE_KEY_FILE: '/etc/vector/apple.p8',
    VECTOR_APPLE_TEAM_ID: 'TEAM123',
  };
  assert.throws(() => readAccountServerConfig(apple), /requires VECTOR_PUBLIC_URL to use HTTPS/);
  assert.equal(readAccountServerConfig({ ...apple, VECTOR_PUBLIC_URL: 'https://radar.example.test' }).apple?.teamId, 'TEAM123');
});

test('public URL rejects credentials and non-HTTP protocols', () => {
  assert.throws(() => readAccountServerConfig({ VECTOR_PUBLIC_URL: 'file:///tmp/vector' }), /HTTP\(S\)/);
  assert.throws(() => readAccountServerConfig({ VECTOR_PUBLIC_URL: 'https://user:pass@example.test' }), /without credentials/);
  assert.throws(() => readAccountServerConfig({ VECTOR_PUBLIC_URL: 'https://example.test/vector' }), /without credentials/);
});
