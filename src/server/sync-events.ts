export type SyncEvent = {
  actorDeviceId?: string;
  revision?: number;
  type: 'deleted' | 'devices' | 'preferences';
};

type SyncListener = (event: SyncEvent) => void;

const listeners = new Map<string, Set<SyncListener>>();

export function publishSyncEvent(profileId: string, event: SyncEvent) {
  for (const listener of listeners.get(profileId) ?? []) listener(event);
}

export function subscribeToSyncEvents(profileId: string, listener: SyncListener) {
  let profileListeners = listeners.get(profileId);
  if (!profileListeners) {
    profileListeners = new Set();
    listeners.set(profileId, profileListeners);
  }
  profileListeners.add(listener);
  return () => {
    profileListeners?.delete(listener);
    if (profileListeners?.size === 0) listeners.delete(profileId);
  };
}
