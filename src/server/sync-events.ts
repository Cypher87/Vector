export type SyncEvent = {
  actorDeviceId?: string;
  revision?: number;
  type: 'deleted' | 'devices' | 'preferences';
};

type SyncListener = (event: SyncEvent) => void;

const listeners = new Map<string, Set<SyncListener>>();
const onlineConnections = new Map<string, Map<string, number>>();

export function publishSyncEvent(profileId: string, event: SyncEvent, excludedListener?: SyncListener) {
  for (const listener of listeners.get(profileId) ?? []) {
    if (listener !== excludedListener) listener(event);
  }
}

export function isSyncDeviceOnline(profileId: string, deviceId: string) {
  return (onlineConnections.get(profileId)?.get(deviceId) ?? 0) > 0;
}

export function subscribeToSyncEvents(profileId: string, deviceId: string, listener: SyncListener) {
  let profileListeners = listeners.get(profileId);
  if (!profileListeners) {
    profileListeners = new Set();
    listeners.set(profileId, profileListeners);
  }
  profileListeners.add(listener);

  let profileConnections = onlineConnections.get(profileId);
  if (!profileConnections) {
    profileConnections = new Map();
    onlineConnections.set(profileId, profileConnections);
  }
  const connectionCount = profileConnections.get(deviceId) ?? 0;
  profileConnections.set(deviceId, connectionCount + 1);
  let subscribed = true;

  return {
    becameOnline: connectionCount === 0,
    unsubscribe() {
      if (!subscribed) return false;
      subscribed = false;
      const currentCount = profileConnections?.get(deviceId) ?? 0;
      const becameOffline = currentCount <= 1;
      if (becameOffline) profileConnections?.delete(deviceId);
      else profileConnections?.set(deviceId, currentCount - 1);
      if (profileConnections?.size === 0) onlineConnections.delete(profileId);

      profileListeners?.delete(listener);
      if (profileListeners?.size === 0) listeners.delete(profileId);
      return becameOffline;
    },
  };
}
