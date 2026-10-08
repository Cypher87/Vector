import type { Language } from '../i18n.ts';

/** Use recorded endpoints, never extend a sighting to the current browser time. */
export function formatLogbookDuration(firstSeen: number, lastSeen: number, language: Language): string {
  if (!Number.isFinite(firstSeen) || !Number.isFinite(lastSeen) || lastSeen < firstSeen) return '—';
  const minutes = Math.floor((lastSeen - firstSeen) / 60_000);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} ${language === 'nl' ? 'u' : 'h'}${remainder ? ` ${remainder} min` : ''}`;
}
