import type { Aircraft, AircraftKind, UnitSystem } from './aircraft.ts';
import { aircraftKind } from './aircraft-kind.ts';

export const filterCategories = ['light', 'airliner', 'heavy', 'turboprop', 'helicopter', 'glider', 'balloon', 'other'] as const;
export type FilterCategory = typeof filterCategories[number];
export const filterFlightStatuses = ['all', 'airborne', 'ground', 'climbing', 'descending'] as const;
export const filterSources = ['all', 'adsb', 'mlat', 'other'] as const;
export const filterPositions = ['all', 'with', 'without'] as const;
export const filterAlerts = ['all', 'emergency', '7500', '7600', '7700'] as const;
export type FilterRange = { min: number | null; max: number | null };

// Persist physical values, never their formatted display units.
export type AircraftFilters = {
  favoritesOnly: boolean;
  categories: FilterCategory[];
  altitude: FilterRange; // feet, reported altitude (not above terrain)
  distance: number | null; // kilometres from the configured/reported receiver
  speed: FilterRange; // knots, ground speed
  flightStatus: typeof filterFlightStatuses[number];
  source: typeof filterSources[number];
  position: typeof filterPositions[number];
  typeCodes: string[];
  alert: typeof filterAlerts[number];
};
export type AircraftFilterKey = keyof AircraftFilters;
export const emptyAircraftFilters: AircraftFilters = {
  favoritesOnly: false, categories: [], altitude: { min: null, max: null }, distance: null,
  speed: { min: null, max: null }, flightStatus: 'all', source: 'all', position: 'all', typeCodes: [], alert: 'all',
};
export const aircraftFilterKeys = Object.keys(emptyAircraftFilters) as AircraftFilterKey[];
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finiteIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const validRange = (value: unknown, min: number, max: number): value is FilterRange => isObject(value)
  && (value.min === null || finiteIn(value.min, min, max))
  && (value.max === null || finiteIn(value.max, min, max))
  && (value.min === null || value.max === null || Number(value.min) <= Number(value.max));

export function normalizeTypeCodes(value: string[]): string[] {
  return [...new Set(value.filter((code): code is string => typeof code === 'string')
    .map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z0-9]{1,4}$/.test(code)))].sort().slice(0, 20);
}

// Also accepts legacy boolean patches, so older devices can still update those groups.
export function normalizeAircraftFilterPatch(value: unknown): Partial<AircraftFilters> {
  if (!isObject(value)) return {};
  const result: Partial<AircraftFilters> = {};
  if (typeof value.favoritesOnly === 'boolean') result.favoritesOnly = value.favoritesOnly;
  if (Array.isArray(value.categories)) result.categories = filterCategories.filter((key) => value.categories instanceof Array && value.categories.includes(key));
  if (validRange(value.altitude, -2_000, 200_000)) result.altitude = { min: value.altitude.min, max: value.altitude.max };
  if (validRange(value.speed, 0, 3_000)) result.speed = { min: value.speed.min, max: value.speed.max };
  if (value.distance === null || finiteIn(value.distance, 0, 20_000)) result.distance = value.distance;
  if (Array.isArray(value.typeCodes)) result.typeCodes = normalizeTypeCodes(value.typeCodes);
  if (typeof value.airborneOnly === 'boolean') result.flightStatus = value.airborneOnly ? 'airborne' : 'all';
  if (typeof value.adsbOnly === 'boolean') result.source = value.adsbOnly ? 'adsb' : 'all';
  if (typeof value.positionOnly === 'boolean') result.position = value.positionOnly ? 'with' : 'all';
  for (const [key, choices] of [
    ['flightStatus', filterFlightStatuses], ['source', filterSources], ['position', filterPositions], ['alert', filterAlerts],
  ] as const) {
    if ((choices as readonly unknown[]).includes(value[key])) Object.assign(result, { [key]: value[key] });
  }
  return result;
}

export function normalizeAircraftFilters(value: unknown): AircraftFilters {
  return { ...emptyAircraftFilters, ...normalizeAircraftFilterPatch(value) };
}

export const filterValueEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export const activeAircraftFilterKeys = (filters: AircraftFilters) => aircraftFilterKeys.filter(
  (key) => !filterValueEqual(filters[key], emptyAircraftFilters[key]),
);

export function aircraftFilterCategory(kind: AircraftKind): FilterCategory {
  if (kind === 'small' || kind === 'ultralight') return 'light';
  return filterCategories.includes(kind as FilterCategory) ? kind as FilterCategory : 'other';
}

const inRange = (value: number | undefined, range: FilterRange) => {
  if (range.min === null && range.max === null) return true;
  return value !== undefined && Number.isFinite(value)
    && (range.min === null || value >= range.min - 1e-8)
    && (range.max === null || value <= range.max + 1e-8);
};

export function matchesAircraftFilters(aircraft: Aircraft, filters: AircraftFilters, context: {
  favoriteIds: ReadonlySet<string>;
  distanceKm?: number;
}): boolean {
  if (filters.favoritesOnly && !context.favoriteIds.has(aircraft.id)) return false;
  if (filters.categories.length && !filters.categories.includes(aircraftFilterCategory(aircraftKind(aircraft)))) return false;
  if (!inRange(aircraft.altitudeFt, filters.altitude) || !inRange(aircraft.groundSpeedKts, filters.speed)) return false;
  if (filters.distance !== null && (!Number.isFinite(context.distanceKm) || context.distanceKm! > filters.distance + 1e-8)) return false;
  const hasPosition = Number.isFinite(aircraft.latitude) && Number.isFinite(aircraft.longitude);
  if (filters.position === 'with' && !hasPosition || filters.position === 'without' && hasPosition) return false;
  const source = aircraft.source.startsWith('adsb') ? 'adsb' : aircraft.source === 'mlat' ? 'mlat' : 'other';
  if (filters.source !== 'all' && source !== filters.source) return false;
  if (filters.flightStatus === 'ground' && !aircraft.onGround) return false;
  if (filters.flightStatus !== 'all' && filters.flightStatus !== 'ground' && aircraft.onGround) return false;
  if (filters.flightStatus === 'climbing' && !(Number.isFinite(aircraft.verticalRateFpm) && aircraft.verticalRateFpm! >= 128)) return false;
  if (filters.flightStatus === 'descending' && !(Number.isFinite(aircraft.verticalRateFpm) && aircraft.verticalRateFpm! <= -128)) return false;
  if (filters.typeCodes.length && !filters.typeCodes.includes(aircraft.aircraftType?.trim().toUpperCase() ?? '')) return false;
  if (filters.alert === 'emergency') {
    const emergency = aircraft.emergency?.trim().toLowerCase();
    if (!['7500', '7600', '7700'].includes(aircraft.squawk ?? '') && (!emergency || emergency === 'none')) return false;
  } else if (filters.alert !== 'all' && aircraft.squawk !== filters.alert) return false;
  return true;
}

export type NumericFilterKind = 'altitude' | 'distance' | 'speed';
export function filterMeasurement(kind: NumericFilterKind, units: UnitSystem) {
  if (kind === 'altitude') return { unit: units === 'metric' ? 'm' : 'ft', factor: units === 'metric' ? 0.3048 : 1, min: -2_000, max: 200_000 };
  if (kind === 'speed') return { unit: units === 'metric' ? 'km/h' : units === 'imperial' ? 'mph' : 'kt', factor: units === 'metric' ? 1.852 : units === 'imperial' ? 1.150779 : 1, min: 0, max: 3_000 };
  return { unit: units === 'metric' ? 'km' : units === 'imperial' ? 'mi' : 'NM', factor: units === 'metric' ? 1 : units === 'imperial' ? 0.621371 : 1 / 1.852, min: 0, max: 20_000 };
}
