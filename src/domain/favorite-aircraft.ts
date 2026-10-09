import type { Aircraft } from './aircraft.ts';

const aircraftIdPattern = /^~?[0-9a-f]{6}$/;

export const favoriteAircraftStorageKey = 'vector.favoriteAircraft';
export const favoriteCallsignStorageKey = 'vector.favoriteCallsigns';

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

/** Resolve callsign rules against this snapshot, never save the current aircraft as a permanent match. */
export function matchingFavoriteAircraftIds(ids: ReadonlySet<string>, callsigns: ReadonlySet<string>, aircraft: readonly Aircraft[]): ReadonlySet<string> {
  if (!callsigns.size) return ids;
  const matches = new Set(ids);
  for (const item of aircraft) {
    if (callsigns.has(normalizeFavoriteCallsign(item.flight) ?? '')) matches.add(item.id);
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
