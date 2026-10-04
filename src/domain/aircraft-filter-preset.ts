import { normalizeAircraftFilters, filterValueEqual, type AircraftFilters } from './aircraft-filters.ts';
export { emptyAircraftFilters, normalizeAircraftFilters, type AircraftFilterKey, type AircraftFilters } from './aircraft-filters.ts';

export type AircraftSort = 'altitude-desc' | 'callsign-asc' | 'distance-asc' | 'seen-asc';

export type AircraftFilterPreset = {
  id: string;
  name: string;
  filters: AircraftFilters;
  sort: AircraftSort;
};

export const aircraftFilterPresetStorageKey = 'vector.aircraftFilterPresets';
export const maxAircraftFilterPresets = 20;
export const maxAircraftFilterPresetNameLength = 40;

const presetIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const aircraftSorts: AircraftSort[] = ['altitude-desc', 'callsign-asc', 'distance-asc', 'seen-asc'];

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const isAircraftSort = (value: unknown): value is AircraftSort => aircraftSorts.includes(value as AircraftSort);

export function normalizeAircraftFilterPresetName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, maxAircraftFilterPresetNameLength)
    : '';
}

export function normalizeAircraftFilterPresetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && presetIdPattern.test(id)))];
}

export function normalizeAircraftFilterPresets(value: unknown): AircraftFilterPreset[] {
  if (!Array.isArray(value)) return [];
  const presets: AircraftFilterPreset[] = [];
  const ids = new Set<string>();

  for (const item of value) {
    if (!isObject(item) || typeof item.id !== 'string' || !presetIdPattern.test(item.id) || ids.has(item.id)) continue;
    const name = normalizeAircraftFilterPresetName(item.name);
    if (!name || !isAircraftSort(item.sort)) continue;
    ids.add(item.id);
    presets.push({
      id: item.id,
      name,
      filters: normalizeAircraftFilters(item.filters),
      sort: item.sort,
    });
    if (presets.length === maxAircraftFilterPresets) break;
  }

  return presets;
}

export function parseAircraftFilterPresets(value: string | null): AircraftFilterPreset[] {
  try {
    return normalizeAircraftFilterPresets(value ? JSON.parse(value) : []);
  } catch {
    return [];
  }
}

export const aircraftFilterPresetMatches = (
  preset: AircraftFilterPreset,
  filters: AircraftFilters,
  sort: AircraftSort,
) => preset.sort === sort && filterValueEqual(normalizeAircraftFilters(preset.filters), normalizeAircraftFilters(filters));
