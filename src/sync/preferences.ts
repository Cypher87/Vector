import type { UnitSystem } from '../domain/aircraft.ts';
import { isAircraftSort } from '../domain/aircraft-sort.ts';
import { aircraftFilterKeys, emptyAircraftFilters, normalizeAircraftFilterPatch } from '../domain/aircraft-filters.ts';
import {
  normalizeAircraftFilterPresetIds,
  normalizeAircraftFilterPresets,
  normalizeAircraftFilters,
  type AircraftFilterPreset,
  type AircraftFilters,
  type AircraftSort,
} from '../domain/aircraft-filter-preset.ts';
import { legTracePeriods, type LegTracePeriod } from '../domain/aircraft-trace.ts';
import { normalizeFavoriteAircraftIds, normalizeFavoriteCallsigns, normalizeFavoriteRegistrations } from '../domain/favorite-aircraft.ts';
import { normalizeRadarEventPreferences, type RadarEventPreferences } from '../domain/radar-event.ts';
import type { Language } from '../i18n.ts';
import { normalizeThemeMode, type ThemeMode } from '../theme.ts';

export type SyncedAircraftFilters = AircraftFilters;
export type SyncedAircraftSort = AircraftSort;

export type SyncPreferences = {
  actualRangeOutline?: boolean;
  aircraftMotion?: boolean;
  aircraftShadows?: boolean;
  aircraftWakes?: boolean;
  aircraftFilters?: SyncedAircraftFilters;
  aircraftSort?: SyncedAircraftSort;
  aircraftFavoritesFirst?: boolean;
  autoHideDetails?: boolean;
  distanceRings?: boolean;
  favoriteAircraft?: string[];
  favoriteCallsigns?: string[];
  favoriteRegistrations?: string[];
  filterPresets?: AircraftFilterPreset[];
  language?: Language;
  legTrace?: boolean;
  legTracePeriod?: LegTracePeriod;
  mapLabels?: boolean;
  radarEventPreferences?: RadarEventPreferences;
  theme?: ThemeMode;
  unitSystem?: UnitSystem;
};

type ScalarSyncPreferences = Omit<SyncPreferences, 'aircraftFilters' | 'favoriteAircraft' | 'favoriteCallsigns' | 'favoriteRegistrations' | 'filterPresets'>;

export type SyncPreferencePatch = {
  aircraftFilters?: Partial<SyncedAircraftFilters>;
  favoriteAircraft?: {
    add?: string[];
    remove?: string[];
  };
  favoriteCallsigns?: { add?: string[]; remove?: string[] };
  favoriteRegistrations?: { add?: string[]; remove?: string[] };
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
  const theme = normalizeThemeMode(value.theme);
  if (theme !== undefined) preferences.theme = theme;
  if (isObject(value.radarEventPreferences)) {
    preferences.radarEventPreferences = normalizeRadarEventPreferences(value.radarEventPreferences);
  }

  for (const key of ['actualRangeOutline', 'aircraftMotion', 'aircraftShadows', 'aircraftWakes', 'aircraftFavoritesFirst', 'autoHideDetails', 'distanceRings', 'legTrace', 'mapLabels'] as const) {
    if (typeof value[key] === 'boolean') preferences[key] = value[key];
  }

  if (legTracePeriods.includes(value.legTracePeriod as LegTracePeriod)) {
    preferences.legTracePeriod = value.legTracePeriod as LegTracePeriod;
  }

  if (isAircraftSort(value.aircraftSort)) {
    preferences.aircraftSort = value.aircraftSort;
  }

  if (isObject(value.aircraftFilters)) {
    preferences.aircraftFilters = normalizeAircraftFilters(value.aircraftFilters);
  }

  if (Array.isArray(value.favoriteAircraft)) {
    preferences.favoriteAircraft = normalizeFavoriteAircraftIds(value.favoriteAircraft).slice(0, 2_000);
  }
  if (Array.isArray(value.favoriteCallsigns)) preferences.favoriteCallsigns = normalizeFavoriteCallsigns(value.favoriteCallsigns);
  if (Array.isArray(value.favoriteRegistrations)) preferences.favoriteRegistrations = normalizeFavoriteRegistrations(value.favoriteRegistrations);

  if (Array.isArray(value.filterPresets)) {
    preferences.filterPresets = normalizeAircraftFilterPresets(value.filterPresets);
  }

  return preferences;
}

export const hasSyncPreferences = (preferences: SyncPreferences) => Object.keys(preferences).length > 0;

const scalarPreferenceKeys = [
  'actualRangeOutline',
  'aircraftMotion',
  'aircraftShadows',
  'aircraftWakes',
  'aircraftSort',
  'aircraftFavoritesFirst',
  'autoHideDetails',
  'distanceRings',
  'language',
  'legTrace',
  'legTracePeriod',
  'mapLabels',
  'radarEventPreferences',
  'theme',
  'unitSystem',
] as const satisfies readonly (keyof ScalarSyncPreferences)[];

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
    const filters = normalizeAircraftFilterPatch(value.aircraftFilters);
    if (Object.keys(filters).length > 0) patch.aircraftFilters = filters;
  }

  if (isObject(value.favoriteAircraft)) {
    const add = normalizeFavoriteAircraftIds(value.favoriteAircraft.add).slice(0, 2_000);
    const remove = normalizeFavoriteAircraftIds(value.favoriteAircraft.remove).slice(0, 2_000);
    if (add.length > 0 || remove.length > 0) patch.favoriteAircraft = { add, remove };
  }
  if (isObject(value.favoriteCallsigns)) {
    const add = normalizeFavoriteCallsigns(value.favoriteCallsigns.add);
    const remove = normalizeFavoriteCallsigns(value.favoriteCallsigns.remove);
    if (add.length || remove.length) patch.favoriteCallsigns = { add, remove };
  }
  if (isObject(value.favoriteRegistrations)) {
    const add = normalizeFavoriteRegistrations(value.favoriteRegistrations.add);
    const remove = normalizeFavoriteRegistrations(value.favoriteRegistrations.remove);
    if (add.length || remove.length) patch.favoriteRegistrations = { add, remove };
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
      ...emptyAircraftFilters,
      ...current.aircraftFilters,
      ...patch.aircraftFilters,
    };
  }

  if (patch.favoriteAircraft) {
    const favorites = new Set(current.favoriteAircraft ?? []);
    for (const aircraftId of patch.favoriteAircraft.remove ?? []) favorites.delete(aircraftId);
    for (const aircraftId of patch.favoriteAircraft.add ?? []) favorites.add(aircraftId);
    next.favoriteAircraft = normalizeFavoriteAircraftIds([...favorites]).slice(0, 2_000);
  }
  if (patch.favoriteCallsigns) {
    const callsigns = new Set(current.favoriteCallsigns ?? []);
    for (const callsign of patch.favoriteCallsigns.remove ?? []) callsigns.delete(callsign);
    for (const callsign of patch.favoriteCallsigns.add ?? []) callsigns.add(callsign);
    next.favoriteCallsigns = normalizeFavoriteCallsigns([...callsigns]);
  }
  if (patch.favoriteRegistrations) {
    const registrations = new Set(current.favoriteRegistrations ?? []);
    for (const registration of patch.favoriteRegistrations.remove ?? []) registrations.delete(registration);
    for (const registration of patch.favoriteRegistrations.add ?? []) registrations.add(registration);
    next.favoriteRegistrations = normalizeFavoriteRegistrations([...registrations]);
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
    const previousValueForKey = previous.aircraftFilters?.[key] ?? emptyAircraftFilters[key];
    const nextValueForKey = next.aircraftFilters?.[key] ?? emptyAircraftFilters[key];
    if (!equalPreferenceValue(previousValueForKey, nextValueForKey)) Object.assign(filters, { [key]: nextValueForKey });
  }
  if (Object.keys(filters).length > 0) patch.aircraftFilters = filters;

  const previousFavorites = new Set(previous.favoriteAircraft ?? []);
  const nextFavorites = new Set(next.favoriteAircraft ?? []);
  const add = [...nextFavorites].filter((aircraftId) => !previousFavorites.has(aircraftId));
  const remove = [...previousFavorites].filter((aircraftId) => !nextFavorites.has(aircraftId));
  if (add.length > 0 || remove.length > 0) patch.favoriteAircraft = { add, remove };

  const previousCallsigns = new Set(previous.favoriteCallsigns ?? []);
  const nextCallsigns = new Set(next.favoriteCallsigns ?? []);
  const addCallsigns = [...nextCallsigns].filter((callsign) => !previousCallsigns.has(callsign));
  const removeCallsigns = [...previousCallsigns].filter((callsign) => !nextCallsigns.has(callsign));
  if (addCallsigns.length || removeCallsigns.length) patch.favoriteCallsigns = { add: addCallsigns, remove: removeCallsigns };

  const previousRegistrations = new Set(previous.favoriteRegistrations ?? []);
  const nextRegistrations = new Set(next.favoriteRegistrations ?? []);
  const addRegistrations = [...nextRegistrations].filter((registration) => !previousRegistrations.has(registration));
  const removeRegistrations = [...previousRegistrations].filter((registration) => !nextRegistrations.has(registration));
  if (addRegistrations.length || removeRegistrations.length) patch.favoriteRegistrations = { add: addRegistrations, remove: removeRegistrations };

  const previousPresets = new Map((previous.filterPresets ?? []).map((preset) => [preset.id, preset]));
  const nextPresets = new Map((next.filterPresets ?? []).map((preset) => [preset.id, preset]));
  const upsert = [...nextPresets.values()].filter((preset) => !equalPreferenceValue(previousPresets.get(preset.id), preset));
  const removePresets = [...previousPresets.keys()].filter((presetId) => !nextPresets.has(presetId));
  if (upsert.length > 0 || removePresets.length > 0) patch.filterPresets = { remove: removePresets, upsert };

  return patch;
}

export const hasSyncPreferencePatch = (patch: SyncPreferencePatch) => Object.keys(patch).length > 0;
