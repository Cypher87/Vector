import { activeAircraftFilterKeys, normalizeAircraftFilters, filterValueEqual, type AircraftFilters } from './aircraft-filters.ts';
import { isAircraftSort, type AircraftSort } from './aircraft-sort.ts';
export { emptyAircraftFilters, normalizeAircraftFilters, type AircraftFilterKey, type AircraftFilters } from './aircraft-filters.ts';

export { isAircraftSort, type AircraftSort } from './aircraft-sort.ts';

export type AircraftFilterPreset = {
  id: string;
  name: string;
  filters: AircraftFilters;
  sort: AircraftSort;
  favoritesFirst?: boolean;
  notifyOnMatch?: boolean;
};

export const aircraftFilterPresetStorageKey = 'vector.aircraftFilterPresets';
export const maxAircraftFilterPresets = 20;
export const maxAircraftFilterPresetNameLength = 40;

const presetIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export function normalizeAircraftFilterPresetName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, maxAircraftFilterPresetNameLength)
    : '';
}

export function aircraftFilterPresetNameExists(presets: readonly AircraftFilterPreset[], name: string, exceptId?: string): boolean {
  const normalized = normalizeAircraftFilterPresetName(name).toLowerCase();
  return presets.some((preset) => preset.id !== exceptId && normalizeAircraftFilterPresetName(preset.name).toLowerCase() === normalized);
}

/** Update criteria in place: notification rules and paired devices keep the same identity. */
export function updateAircraftFilterPreset(preset: AircraftFilterPreset, filters: AircraftFilters, sort: AircraftSort, favoritesFirst: boolean): AircraftFilterPreset {
  const normalized = normalizeAircraftFilters(filters);
  return {
    ...preset, filters: normalized, sort, favoritesFirst,
    ...(preset.notifyOnMatch && activeAircraftFilterKeys(normalized).length === 0 ? { notifyOnMatch: false } : {}),
  };
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
      ...(typeof item.favoritesFirst === 'boolean' ? { favoritesFirst: item.favoritesFirst } : {}),
      ...(typeof item.notifyOnMatch === 'boolean' ? { notifyOnMatch: item.notifyOnMatch } : {}),
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
  favoritesFirst = false,
) => preset.sort === sort && (preset.favoritesFirst ?? false) === favoritesFirst
  && filterValueEqual(normalizeAircraftFilters(preset.filters), normalizeAircraftFilters(filters));

export const canNotifyForPreset = (preset: AircraftFilterPreset) => activeAircraftFilterKeys(preset.filters).length > 0;
