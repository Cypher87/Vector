import type { Aircraft } from './aircraft.ts';

const aircraftIdPattern = /^~?[0-9a-f]{6}$/;

export const favoriteAircraftStorageKey = 'vector.favoriteAircraft';
export const favoriteCallsignStorageKey = 'vector.favoriteCallsigns';
export const favoriteRegistrationStorageKey = 'vector.favoriteRegistrations';

export type FavoriteIdentifierKind = 'auto' | 'callsign' | 'registration';

export function normalizeFavoriteRegistration(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s/g, '').toUpperCase();
  return normalized.length >= 3 && normalized.length <= 12 && /^[A-Z0-9]+(?:-[A-Z0-9]+)?$/.test(normalized) ? normalized : undefined;
}

export function normalizeFavoriteRegistrations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const registration = normalizeFavoriteRegistration(item);
    return registration ? [registration] : [];
  }))].sort().slice(0, 2_000);
}

export function parseFavoriteRegistrations(value: string | null): string[] {
  try { return normalizeFavoriteRegistrations(JSON.parse(value ?? '[]')); } catch { return []; }
}

export function parseFavoriteIdentifier(value: string, kind: FavoriteIdentifierKind = 'auto') {
  const type = kind === 'auto' ? value.includes('-') ? 'registration' : 'callsign' : kind;
  const normalized = type === 'registration' ? normalizeFavoriteRegistration(value) : normalizeFavoriteCallsign(value);
  return normalized ? { type, value: normalized } : undefined;
}

export function normalizeFavoriteCallsign(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s/g, '').toUpperCase();
  return /^[A-Z0-9]{1,8}$/.test(normalized) ? normalized : undefined;
}

export function normalizeFavoriteCallsigns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const callsign = normalizeFavoriteCallsign(item);
    return callsign ? [callsign] : [];
  }))].sort().slice(0, 2_000);
}

export function parseFavoriteCallsigns(value: string | null): string[] {
  try { return normalizeFavoriteCallsigns(JSON.parse(value ?? '[]')); } catch { return []; }
}

/** Resolve identifier rules against this snapshot, without saving a match as a permanent ICAO favorite. */
export function matchingFavoriteAircraftIds(ids: ReadonlySet<string>, callsigns: ReadonlySet<string>, aircraft: readonly Aircraft[], registrations: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  if (!callsigns.size && !registrations.size) return ids;
  const matches = new Set(ids);
  for (const item of aircraft) {
    if (callsigns.has(normalizeFavoriteCallsign(item.flight) ?? '') || registrations.has(normalizeFavoriteRegistration(item.registration) ?? '')) matches.add(item.id);
  }
  return matches;
}

export function normalizeFavoriteAircraftIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.flatMap((candidate) => {
    if (typeof candidate !== 'string') return [];
    const normalized = candidate.trim().toLowerCase();
    return aircraftIdPattern.test(normalized) ? [normalized] : [];
  }))].sort();
}

export function parseFavoriteAircraftIds(value: string | null): string[] {
  if (!value) return [];
  try {
    return normalizeFavoriteAircraftIds(JSON.parse(value));
  } catch {
    return [];
  }
}

export function toggleFavoriteAircraftId(current: readonly string[], aircraftId: string): string[] {
  const normalizedId = aircraftId.trim().toLowerCase();
  if (!aircraftIdPattern.test(normalizedId)) return normalizeFavoriteAircraftIds(current);
  const normalized = new Set(normalizeFavoriteAircraftIds(current));
  if (normalized.has(normalizedId)) normalized.delete(normalizedId);
  else normalized.add(normalizedId);
  return [...normalized].sort();
}
