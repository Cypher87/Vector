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
