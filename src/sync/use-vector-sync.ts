'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SyncPreferences } from './preferences';

type SyncSessionResponse = {
  connected: boolean;
  preferences: SyncPreferences;
  profileId?: string;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'SYNC_FAILED');
  return body;
}

export function useVectorSync() {
  const [connected, setConnected] = useState(false);
  const [profileId, setProfileId] = useState<string>();
  const [preferences, setPreferences] = useState<SyncPreferences>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const applySession = useCallback((session: SyncSessionResponse) => {
    setConnected(session.connected);
    setProfileId(session.profileId);
    setPreferences(session.preferences || {});
    return session;
  }, []);

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

  const savePreferences = useCallback(async (next: SyncPreferences) => {
    if (!connected) return;
    const response = await fetch('/api/sync/preferences', {
      body: JSON.stringify({ preferences: next }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    });
    if (response.status === 401) {
      applySession({ connected: false, preferences: {} });
      return;
    }
    const result = await responseJson<{ preferences: SyncPreferences }>(response);
    setPreferences(result.preferences);
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
    disconnect: () => sessionRequest('/api/sync/disconnect', 'POST'),
    error,
    loading,
    pair: (code: string) => sessionRequest('/api/sync/pair', 'POST', { code }),
    preferences,
    profileId,
    savePreferences,
    start: (initialPreferences: SyncPreferences) => sessionRequest('/api/sync/profile', 'POST', { preferences: initialPreferences }),
  };
}
