const aircraftIdPattern = /^~?[0-9a-f]{6}$/;

export const favoriteAircraftStorageKey = 'vector.favoriteAircraft';

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
