'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSyncPreferencePatch,
  hasSyncPreferencePatch,
  type SyncPreferences,
} from './preferences';
import type { SyncDeviceSummary } from './devices';

type SyncSessionResponse = {
  connected: boolean;
  deviceId?: string;
  devices?: SyncDeviceSummary[];
  preferences: SyncPreferences;
  profileId?: string;
  revision?: number;
};

type ClientSyncEvent = {
  actorDeviceId?: string;
  type?: 'deleted' | 'devices' | 'preferences' | 'ready';
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'SYNC_FAILED');
  return body;
}

export function useVectorSync() {
  const [connected, setConnected] = useState(false);
  const [deviceId, setDeviceId] = useState<string>();
  const [devices, setDevices] = useState<SyncDeviceSummary[]>([]);
  const [profileId, setProfileId] = useState<string>();
  const [preferences, setPreferences] = useState<SyncPreferences>({});
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const preferencesRef = useRef<SyncPreferences>({});
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const applySession = useCallback((session: SyncSessionResponse) => {
    setConnected(session.connected);
    setDeviceId(session.deviceId);
    setDevices(session.devices ?? []);
    setProfileId(session.profileId);
    const nextPreferences = session.preferences || {};
    preferencesRef.current = nextPreferences;
    setPreferences(nextPreferences);
    setRevision(session.revision ?? 0);
    return session;
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/sync/session', { cache: 'no-store', signal });
    return applySession(await responseJson<SyncSessionResponse>(response));
  }, [applySession]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/sync/session', { cache: 'no-store', signal: controller.signal })
      .then((response) => responseJson<SyncSessionResponse>(response))
      .then(applySession)
      .catch((requestError) => {
        if ((requestError as Error).name !== 'AbortError') setError('SYNC_UNAVAILABLE');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [applySession]);

  useEffect(() => {
    if (!connected || !deviceId) return;
    const events = new EventSource('/api/sync/events');
    events.onmessage = (message) => {
      let event: ClientSyncEvent;
      try {
        event = JSON.parse(message.data) as ClientSyncEvent;
      } catch {
        return;
      }
      if (event.type === 'ready' || (event.type === 'preferences' && event.actorDeviceId === deviceId)) return;
      void refresh().catch(() => setError('SYNC_UNAVAILABLE'));
    };
    return () => events.close();
  }, [connected, deviceId, refresh]);

  const sessionRequest = useCallback(async (url: string, method: string, body?: unknown) => {
    setError(undefined);
    try {
      const response = await fetch(url, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        method,
      });
      return applySession(await responseJson<SyncSessionResponse>(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'SYNC_FAILED');
      throw requestError;
    }
  }, [applySession]);

  const savePreferences = useCallback((next: SyncPreferences) => {
    if (!connected) return Promise.resolve();
    const queued = saveQueueRef.current.then(async () => {
      const patch = createSyncPreferencePatch(preferencesRef.current, next);
      if (!hasSyncPreferencePatch(patch)) return;
      const response = await fetch('/api/sync/preferences', {
        body: JSON.stringify({ patch }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      });
      if (response.status === 401) {
        applySession({ connected: false, preferences: {} });
        return;
      }
      const result = await responseJson<{ preferences: SyncPreferences; revision: number }>(response);
      preferencesRef.current = result.preferences;
      setPreferences(result.preferences);
      setRevision(result.revision);
    });
    saveQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [applySession, connected]);

  const createPairingCode = useCallback(async () => {
    setError(undefined);
    try {
      const response = await fetch('/api/sync/pairing-code', { method: 'POST' });
      return await responseJson<{ code: string; expiresAt: number }>(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'SYNC_FAILED');
      throw requestError;
    }
  }, []);

  return {
    clearError: () => setError(undefined),
    connected,
    createPairingCode,
    deleteProfile: () => sessionRequest('/api/sync/profile', 'DELETE'),
    devices,
    disconnect: () => sessionRequest('/api/sync/disconnect', 'POST'),
    disconnectDevice: (targetDeviceId: string) => sessionRequest('/api/sync/device', 'DELETE', { deviceId: targetDeviceId }),
    error,
    loading,
    pair: (code: string) => sessionRequest('/api/sync/pair', 'POST', { code }),
    preferences,
    profileId,
    revision,
    renameDevice: (targetDeviceId: string, name: string) => sessionRequest('/api/sync/device', 'PATCH', {
      deviceId: targetDeviceId,
      name,
    }),
    savePreferences,
    start: (initialPreferences: SyncPreferences) => sessionRequest('/api/sync/profile', 'POST', { preferences: initialPreferences }),
  };
}
