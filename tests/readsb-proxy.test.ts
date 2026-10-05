import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRedirectStatus,
  parseReadsbProxyRequest,
  ReadsbRequestError,
  validateReadsbResourcePath,
} from '../src/server/readsb-proxy.ts';
import { parseUpstreamBaseUrl, readVectorServerConfig } from '../src/server/vector-config.ts';

test('allows only the required live snapshot files', () => {
  assert.equal(validateReadsbResourcePath('live', 'aircraft.json'), 'aircraft.json');
  assert.equal(validateReadsbResourcePath('live', 'outline.json'), 'outline.json');
  assert.equal(validateReadsbResourcePath('live', 'receiver.json'), 'receiver.json');
  assert.throws(() => validateReadsbResourcePath('live', 'multiOutline.json'), ReadsbRequestError);
  assert.throws(() => validateReadsbResourcePath('live', 'stats.json'), ReadsbRequestError);
  assert.throws(() => validateReadsbResourcePath('history', 'aircraft.json'), ReadsbRequestError);
});

test('accepts valid recent and full trace paths and rejects malformed trace paths', () => {
  assert.equal(
    validateReadsbResourcePath('live', 'traces/ef/trace_recent_abcdef.json'),
    'traces/ef/trace_recent_abcdef.json',
  );
  assert.equal(
    validateReadsbResourcePath('live', 'traces/ef/trace_recent_~abcdef.json'),
    'traces/ef/trace_recent_~abcdef.json',
  );
  assert.equal(
    validateReadsbResourcePath('live', 'traces/ef/trace_full_abcdef.json'),
    'traces/ef/trace_full_abcdef.json',
  );
  assert.throws(
    () => validateReadsbResourcePath('live', 'traces/ab/trace_recent_abcdef.json'),
    ReadsbRequestError,
  );
  assert.throws(
    () => validateReadsbResourcePath('live', 'traces/ef/trace_history_abcdef.json'),
    ReadsbRequestError,
  );
});

test('accepts valid replay paths and validates the date and half-hour chunk', () => {
  assert.equal(
    validateReadsbResourcePath('history', '2024/02/29/heatmap/47.bin.ttf'),
    '2024/02/29/heatmap/47.bin.ttf',
  );
  assert.throws(
    () => validateReadsbResourcePath('history', '2023/02/29/heatmap/12.bin.ttf'),
    ReadsbRequestError,
  );
  assert.throws(
    () => validateReadsbResourcePath('history', '2024/02/29/heatmap/48.bin.ttf'),
    ReadsbRequestError,
  );
  assert.throws(
    () => validateReadsbResourcePath('history', '2024/2/29/heatmap/12.bin.ttf'),
    ReadsbRequestError,
  );
});

test('blocks traversal, encoded traversal and absolute URLs', () => {
  for (const path of [
    '../aircraft.json',
    'traces/ef/../../aircraft.json',
    '%2e%2e/aircraft.json',
    'traces\\ef\\trace_recent_abcdef.json',
    'https://example.net/aircraft.json',
  ]) {
    assert.throws(() => validateReadsbResourcePath('live', path), ReadsbRequestError);
  }
});

test('the client request can name only a source and relative resource path', () => {
  assert.deepEqual(
    parseReadsbProxyRequest('http://vector.local/api/readsb?source=live&path=aircraft.json'),
    { source: 'live', path: 'aircraft.json' },
  );
  assert.throws(
    () => parseReadsbProxyRequest('http://vector.local/api/readsb?url=http://example.net/aircraft.json'),
    ReadsbRequestError,
  );
  assert.throws(
    () => parseReadsbProxyRequest('http://vector.local/api/readsb?source=live&path=https://example.net/aircraft.json'),
    ReadsbRequestError,
  );
  assert.throws(
    () => parseReadsbProxyRequest('http://vector.local/api/readsb?source=live&source=history&path=aircraft.json'),
    ReadsbRequestError,
  );
});

test('only the configured Vector base is available to the server, not the browser', () => {
  const config = readVectorServerConfig({
    READSB_SOURCE: 'vector', READSB_REMOTE_URL: 'https://receiver.example/vector/',
  });
  assert.equal(config.remoteBaseUrl?.href, 'https://receiver.example/vector/');
  assert.equal('remoteBaseUrl' in config.publicConfig, false);
  assert.equal(config.publicConfig.dataBaseUrl, '/api/readsb?source=live');
  assert.equal(config.publicConfig.historyBaseUrl, '/api/readsb?source=history');
  assert.equal(config.publicConfig.receiverLatitude, undefined);
  assert.equal(config.publicConfig.receiverLongitude, undefined);
});

test('obsolete metadata bases are never validated or used in standalone mode', () => {
  const config = readVectorServerConfig({
    READSB_SOURCE: 'local', READSB_TAR1090_URL: 'file:///obsolete/',
  });
  assert.equal('tar1090BaseUrl' in config, false);
});

test('receiver coordinates are read as a validated environment pair', () => {
  const config = readVectorServerConfig({
    VECTOR_RECEIVER_LATITUDE: '52.123456',
    VECTOR_RECEIVER_LONGITUDE: '5.654321',
  });
  assert.equal(config.publicConfig.receiverLatitude, 52.123456);
  assert.equal(config.publicConfig.receiverLongitude, 5.654321);

  assert.throws(
    () => readVectorServerConfig({ VECTOR_RECEIVER_LATITUDE: '52.1' }),
    /must be configured together/,
  );
  assert.throws(
    () => readVectorServerConfig({
      VECTOR_RECEIVER_LATITUDE: '91',
      VECTOR_RECEIVER_LONGITUDE: '5',
    }),
    /between -90 and 90/,
  );
  assert.throws(
    () => readVectorServerConfig({
      VECTOR_RECEIVER_LATITUDE: '52',
      VECTOR_RECEIVER_LONGITUDE: '-181',
    }),
    /between -180 and 180/,
  );
});

test('server base URLs reject credentials, unexpected protocols, queries and fragments', () => {
  assert.equal(
    parseUpstreamBaseUrl('https://receiver.example/vector', 'READSB_REMOTE_URL').toString(),
    'https://receiver.example/vector/',
  );
  for (const url of [
    'file:///var/run/readsb/aircraft.json',
    'ftp://readsb.local/data/',
    'http://user:secret@readsb.local/data/',
    'http://readsb.local/data/?file=aircraft.json',
    'http://readsb.local/data/#aircraft',
  ]) {
    assert.throws(() => parseUpstreamBaseUrl(url, 'READSB_LIVE_URL'));
  }
});

test('redirect statuses are detected so the proxy can reject redirects', () => {
  assert.equal(isRedirectStatus(301), true);
  assert.equal(isRedirectStatus(307), true);
  assert.equal(isRedirectStatus(200), false);
  assert.equal(isRedirectStatus(404), false);
});
