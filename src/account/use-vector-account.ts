'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserPreferences } from './preferences';

export type ClientAccount = {
  email: string;
  id: string;
  name: string;
  providers: ('apple' | 'google' | 'local')[];
};

export type ClientAuthProviders = {
  apple: boolean;
  google: boolean;
  local: boolean;
  localRegistration: boolean;
};

type SessionResponse = {
  account: ClientAccount | null;
  preferences: UserPreferences;
};

const defaultProviders: ClientAuthProviders = {
  apple: false,
  google: false,
  local: true,
  localRegistration: false,
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'AUTH_FAILED');
  return body;
}

export function useVectorAccount() {
  const [account, setAccount] = useState<ClientAccount | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [providers, setProviders] = useState(defaultProviders);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [providerResponse, sessionResponse] = await Promise.all([
        fetch('/api/auth/providers', { cache: 'no-store' }),
        fetch('/api/auth/session', { cache: 'no-store' }),
      ]);
      const providerData = await responseJson<ClientAuthProviders>(providerResponse);
      const sessionData = await responseJson<SessionResponse>(sessionResponse);
      setProviders(providerData);
      setAccount(sessionData.account);
      setPreferences(sessionData.preferences || {});
    } catch {
      setAuthError('AUTH_UNAVAILABLE');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const callbackError = url.searchParams.get('authError');
    const frame = window.requestAnimationFrame(() => {
      if (callbackError) {
        setAuthError(callbackError === 'provider_unavailable' ? 'PROVIDER_UNAVAILABLE' : 'OAUTH_FAILED');
        url.searchParams.delete('authError');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
      void refresh();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [refresh]);

  const localRequest = useCallback(async (
    endpoint: 'login' | 'register',
    input: { email: string; name?: string; password: string },
  ) => {
    setAuthError(undefined);
    const response = await fetch(`/api/auth/local/${endpoint}`, {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    try {
      const session = await responseJson<SessionResponse>(response);
      setAccount(session.account);
      setPreferences(session.preferences || {});
      void fetch('/api/auth/providers', { cache: 'no-store' })
        .then((providerResponse) => responseJson<ClientAuthProviders>(providerResponse))
        .then(setProviders)
        .catch(() => undefined);
      return session;
    } catch (error) {
      const code = error instanceof Error ? error.message : 'AUTH_FAILED';
      setAuthError(code);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAccount(null);
    setPreferences({});
    setAuthError(undefined);
  }, []);

  const savePreferences = useCallback(async (next: UserPreferences) => {
    if (!account) return;
    const response = await fetch('/api/account/preferences', {
      body: JSON.stringify({ preferences: next }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    });
    if (response.status === 401) {
      setAccount(null);
      return;
    }
    const body = await responseJson<{ preferences: UserPreferences }>(response);
    setPreferences(body.preferences);
  }, [account]);

  return {
    account,
    authError,
    clearAuthError: () => setAuthError(undefined),
    loading,
    preferences,
    providers,
    registerLocal: (input: { email: string; name: string; password: string }) => localRequest('register', input),
    savePreferences,
    signInLocal: (input: { email: string; password: string }) => localRequest('login', input),
    signOut,
  };
}
