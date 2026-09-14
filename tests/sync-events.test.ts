import assert from 'node:assert/strict';
import test from 'node:test';
import { publishSyncEvent, subscribeToSyncEvents } from '../src/server/sync-events.ts';

test('live synchronization events are isolated by profile and can be unsubscribed', () => {
  const received: unknown[] = [];
  const unsubscribe = subscribeToSyncEvents('profile-a', (event) => received.push(event));
  publishSyncEvent('profile-b', { type: 'devices' });
  publishSyncEvent('profile-a', { actorDeviceId: 'device-a', revision: 3, type: 'preferences' });
  unsubscribe();
  publishSyncEvent('profile-a', { type: 'deleted' });
  assert.deepEqual(received, [{ actorDeviceId: 'device-a', revision: 3, type: 'preferences' }]);
});
