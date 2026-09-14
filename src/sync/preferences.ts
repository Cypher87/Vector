import type { UnitSystem } from '../domain/aircraft.ts';
import { legTracePeriods, type LegTracePeriod } from '../domain/aircraft-trace.ts';
import { normalizeFavoriteAircraftIds } from '../domain/favorite-aircraft.ts';
import type { Language } from '../i18n.ts';

export type SyncedAircraftFilters = {
  adsbOnly: boolean;
  airborneOnly: boolean;
  favoritesOnly: boolean;
  positionOnly: boolean;
};

export type SyncedAircraftSort = 'altitude-desc' | 'callsign-asc' | 'distance-asc' | 'seen-asc';

export type SyncPreferences = {
  actualRangeOutline?: boolean;
  aircraftFilters?: SyncedAircraftFilters;
  aircraftSort?: SyncedAircraftSort;
  autoHideDetails?: boolean;
  distanceRings?: boolean;
  favoriteAircraft?: string[];
  language?: Language;
  legTrace?: boolean;
  legTracePeriod?: LegTracePeriod;
  mapLabels?: boolean;
  unitSystem?: UnitSystem;
};

type ScalarSyncPreferences = Omit<SyncPreferences, 'aircraftFilters' | 'favoriteAircraft'>;

export type SyncPreferencePatch = {
  aircraftFilters?: Partial<SyncedAircraftFilters>;
  favoriteAircraft?: {
    add?: string[];
    remove?: string[];
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

  for (const key of ['actualRangeOutline', 'autoHideDetails', 'distanceRings', 'legTrace', 'mapLabels'] as const) {
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
    preferences.aircraftFilters = {
      adsbOnly: value.aircraftFilters.adsbOnly === true,
      airborneOnly: value.aircraftFilters.airborneOnly === true,
      favoritesOnly: value.aircraftFilters.favoritesOnly === true,
      positionOnly: value.aircraftFilters.positionOnly === true,
    };
  }

  if (Array.isArray(value.favoriteAircraft)) {
    preferences.favoriteAircraft = normalizeFavoriteAircraftIds(value.favoriteAircraft).slice(0, 2_000);
  }

  return preferences;
}

export const hasSyncPreferences = (preferences: SyncPreferences) => Object.keys(preferences).length > 0;

const scalarPreferenceKeys = [
  'actualRangeOutline',
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

  return patch;
}

export const hasSyncPreferencePatch = (patch: SyncPreferencePatch) => Object.keys(patch).length > 0;
