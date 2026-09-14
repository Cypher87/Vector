import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSyncDeviceOnline,
  publishSyncEvent,
  subscribeToSyncEvents,
} from '../src/server/sync-events.ts';

test('live synchronization events are isolated by profile and can be unsubscribed', () => {
  const received: unknown[] = [];
  const subscription = subscribeToSyncEvents('profile-a', 'device-a', (event) => received.push(event));
  publishSyncEvent('profile-b', { type: 'devices' });
  publishSyncEvent('profile-a', { actorDeviceId: 'device-a', revision: 3, type: 'preferences' });
  subscription.unsubscribe();
  publishSyncEvent('profile-a', { type: 'deleted' });
  assert.deepEqual(received, [{ actorDeviceId: 'device-a', revision: 3, type: 'preferences' }]);
});

test('device presence remains online until its final live connection closes', () => {
  const first = subscribeToSyncEvents('profile-presence', 'device-a', () => undefined);
  const second = subscribeToSyncEvents('profile-presence', 'device-a', () => undefined);
  assert.equal(first.becameOnline, true);
  assert.equal(second.becameOnline, false);
  assert.equal(isSyncDeviceOnline('profile-presence', 'device-a'), true);
  assert.equal(first.unsubscribe(), false);
  assert.equal(isSyncDeviceOnline('profile-presence', 'device-a'), true);
  assert.equal(second.unsubscribe(), true);
  assert.equal(isSyncDeviceOnline('profile-presence', 'device-a'), false);
  assert.equal(second.unsubscribe(), false);
});
