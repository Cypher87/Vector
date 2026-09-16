import type { UnitSystem } from '../domain/aircraft.ts';
import {
  normalizeAircraftFilterPresetIds,
  normalizeAircraftFilterPresets,
  normalizeAircraftFilters,
  type AircraftFilterPreset,
  type AircraftFilters,
  type AircraftSort,
} from '../domain/aircraft-filter-preset.ts';
import { legTracePeriods, type LegTracePeriod } from '../domain/aircraft-trace.ts';
import { normalizeFavoriteAircraftIds } from '../domain/favorite-aircraft.ts';
import type { Language } from '../i18n.ts';

export type SyncedAircraftFilters = AircraftFilters;
export type SyncedAircraftSort = AircraftSort;

export type SyncPreferences = {
  actualRangeOutline?: boolean;
  aircraftShadows?: boolean;
  aircraftFilters?: SyncedAircraftFilters;
  aircraftSort?: SyncedAircraftSort;
  autoHideDetails?: boolean;
  distanceRings?: boolean;
  favoriteAircraft?: string[];
  filterPresets?: AircraftFilterPreset[];
  language?: Language;
  legTrace?: boolean;
  legTracePeriod?: LegTracePeriod;
  mapLabels?: boolean;
  unitSystem?: UnitSystem;
};

type ScalarSyncPreferences = Omit<SyncPreferences, 'aircraftFilters' | 'favoriteAircraft' | 'filterPresets'>;

export type SyncPreferencePatch = {
  aircraftFilters?: Partial<SyncedAircraftFilters>;
  favoriteAircraft?: {
    add?: string[];
    remove?: string[];
  };
  filterPresets?: {
    remove?: string[];
    upsert?: AircraftFilterPreset[];
  };
  settings?: Partial<ScalarSyncPreferences>;
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export function normalizeSyncPreferences(value: unknown): SyncPreferences {
  if (!isObject(value)) return {};
  const preferences: SyncPreferences = {};

  if (value.unitSystem === 'metric' || value.unitSystem === 'aeronautical' || value.unitSystem === 'imperial') {
    preferences.unitSystem = value.unitSystem;
  }
  if (value.language === 'nl' || value.language === 'en') preferences.language = value.language;

  for (const key of ['actualRangeOutline', 'aircraftShadows', 'autoHideDetails', 'distanceRings', 'legTrace', 'mapLabels'] as const) {
    if (typeof value[key] === 'boolean') preferences[key] = value[key];
  }

  if (legTracePeriods.includes(value.legTracePeriod as LegTracePeriod)) {
    preferences.legTracePeriod = value.legTracePeriod as LegTracePeriod;
  }

  if (
    value.aircraftSort === 'altitude-desc'
    || value.aircraftSort === 'callsign-asc'
    || value.aircraftSort === 'distance-asc'
    || value.aircraftSort === 'seen-asc'
  ) {
    preferences.aircraftSort = value.aircraftSort;
  }

  if (isObject(value.aircraftFilters)) {
    preferences.aircraftFilters = normalizeAircraftFilters(value.aircraftFilters);
  }

  if (Array.isArray(value.favoriteAircraft)) {
    preferences.favoriteAircraft = normalizeFavoriteAircraftIds(value.favoriteAircraft).slice(0, 2_000);
  }

  if (Array.isArray(value.filterPresets)) {
    preferences.filterPresets = normalizeAircraftFilterPresets(value.filterPresets);
  }

  return preferences;
}

export const hasSyncPreferences = (preferences: SyncPreferences) => Object.keys(preferences).length > 0;

const scalarPreferenceKeys = [
  'actualRangeOutline',
  'aircraftShadows',
  'aircraftSort',
  'autoHideDetails',
  'distanceRings',
  'language',
  'legTrace',
  'legTracePeriod',
  'mapLabels',
  'unitSystem',
] as const satisfies readonly (keyof ScalarSyncPreferences)[];

const aircraftFilterKeys = [
  'adsbOnly',
  'airborneOnly',
  'favoritesOnly',
  'positionOnly',
] as const satisfies readonly (keyof SyncedAircraftFilters)[];

export function normalizeSyncPreferencePatch(value: unknown): SyncPreferencePatch {
  if (!isObject(value)) return {};
  const patch: SyncPreferencePatch = {};

  if (isObject(value.settings)) {
    const normalized = normalizeSyncPreferences(value.settings);
    const settings: Partial<ScalarSyncPreferences> = {};
    for (const key of scalarPreferenceKeys) {
      if (key in normalized) Object.assign(settings, { [key]: normalized[key] });
    }
    if (Object.keys(settings).length > 0) patch.settings = settings;
  }

  if (isObject(value.aircraftFilters)) {
    const filters: Partial<SyncedAircraftFilters> = {};
    for (const key of aircraftFilterKeys) {
      if (typeof value.aircraftFilters[key] === 'boolean') filters[key] = value.aircraftFilters[key];
    }
    if (Object.keys(filters).length > 0) patch.aircraftFilters = filters;
  }

  if (isObject(value.favoriteAircraft)) {
    const add = normalizeFavoriteAircraftIds(value.favoriteAircraft.add).slice(0, 2_000);
    const remove = normalizeFavoriteAircraftIds(value.favoriteAircraft.remove).slice(0, 2_000);
    if (add.length > 0 || remove.length > 0) patch.favoriteAircraft = { add, remove };
  }

  if (isObject(value.filterPresets)) {
    const remove = normalizeAircraftFilterPresetIds(value.filterPresets.remove);
    const upsert = normalizeAircraftFilterPresets(value.filterPresets.upsert);
    if (remove.length > 0 || upsert.length > 0) patch.filterPresets = { remove, upsert };
  }

  return patch;
}

export function applySyncPreferencePatch(currentValue: unknown, patchValue: unknown): SyncPreferences {
  const current = normalizeSyncPreferences(currentValue);
  const patch = normalizeSyncPreferencePatch(patchValue);
  const next: SyncPreferences = { ...current, ...patch.settings };

  if (patch.aircraftFilters) {
    next.aircraftFilters = {
      adsbOnly: current.aircraftFilters?.adsbOnly ?? false,
      airborneOnly: current.aircraftFilters?.airborneOnly ?? false,
      favoritesOnly: current.aircraftFilters?.favoritesOnly ?? false,
      positionOnly: current.aircraftFilters?.positionOnly ?? false,
      ...patch.aircraftFilters,
    };
  }

  if (patch.favoriteAircraft) {
    const favorites = new Set(current.favoriteAircraft ?? []);
    for (const aircraftId of patch.favoriteAircraft.remove ?? []) favorites.delete(aircraftId);
    for (const aircraftId of patch.favoriteAircraft.add ?? []) favorites.add(aircraftId);
    next.favoriteAircraft = normalizeFavoriteAircraftIds([...favorites]).slice(0, 2_000);
  }

  if (patch.filterPresets) {
    const removed = new Set(patch.filterPresets.remove ?? []);
    const presets = (current.filterPresets ?? []).filter((preset) => !removed.has(preset.id));
    for (const preset of patch.filterPresets.upsert ?? []) {
      const index = presets.findIndex((candidate) => candidate.id === preset.id);
      if (index === -1) presets.push(preset);
      else presets[index] = preset;
    }
    next.filterPresets = normalizeAircraftFilterPresets(presets);
  }

  return normalizeSyncPreferences(next);
}

const equalPreferenceValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function createSyncPreferencePatch(previousValue: unknown, nextValue: unknown): SyncPreferencePatch {
  const previous = normalizeSyncPreferences(previousValue);
  const next = normalizeSyncPreferences(nextValue);
  const patch: SyncPreferencePatch = {};
  const settings: Partial<ScalarSyncPreferences> = {};

  for (const key of scalarPreferenceKeys) {
    if (!equalPreferenceValue(previous[key], next[key]) && next[key] !== undefined) {
      Object.assign(settings, { [key]: next[key] });
    }
  }
  if (Object.keys(settings).length > 0) patch.settings = settings;

  const filters: Partial<SyncedAircraftFilters> = {};
  for (const key of aircraftFilterKeys) {
    const previousValueForKey = previous.aircraftFilters?.[key] ?? false;
    const nextValueForKey = next.aircraftFilters?.[key] ?? false;
    if (previousValueForKey !== nextValueForKey) filters[key] = nextValueForKey;
  }
  if (Object.keys(filters).length > 0) patch.aircraftFilters = filters;

  const previousFavorites = new Set(previous.favoriteAircraft ?? []);
  const nextFavorites = new Set(next.favoriteAircraft ?? []);
  const add = [...nextFavorites].filter((aircraftId) => !previousFavorites.has(aircraftId));
  const remove = [...previousFavorites].filter((aircraftId) => !nextFavorites.has(aircraftId));
  if (add.length > 0 || remove.length > 0) patch.favoriteAircraft = { add, remove };

  const previousPresets = new Map((previous.filterPresets ?? []).map((preset) => [preset.id, preset]));
  const nextPresets = new Map((next.filterPresets ?? []).map((preset) => [preset.id, preset]));
  const upsert = [...nextPresets.values()].filter((preset) => !equalPreferenceValue(previousPresets.get(preset.id), preset));
  const removePresets = [...previousPresets.keys()].filter((presetId) => !nextPresets.has(presetId));
  if (upsert.length > 0 || removePresets.length > 0) patch.filterPresets = { remove: removePresets, upsert };

  return patch;
}

export const hasSyncPreferencePatch = (patch: SyncPreferencePatch) => Object.keys(patch).length > 0;
