'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { darkColorSchemeQuery, resolveTheme, themeStorageKey, type ThemeMode } from './theme';

const prefersDark = () => typeof window.matchMedia !== 'function' || window.matchMedia(darkColorSchemeQuery).matches;
const serverPrefersDark = () => true;
const subscribe = (onChange: () => void) => {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(darkColorSchemeQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

export function useResolvedTheme(mode: ThemeMode, preferencesReady: boolean) {
  const systemDark = useSyncExternalStore(subscribe, prefersDark, serverPrefersDark);
  const theme = resolveTheme(mode, systemDark);
  useEffect(() => {
    if (!preferencesReady) return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = mode;
    try {
      // Store the selected mode, never this device's resolved system color scheme.
      window.localStorage.setItem(themeStorageKey, mode);
      window.localStorage.removeItem('vector.mapTheme');
    } catch { /* Appearance still works when browser storage is unavailable. */ }
  }, [mode, preferencesReady, theme]);
  return theme;
}
