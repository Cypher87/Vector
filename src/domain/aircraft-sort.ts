import type { Aircraft } from './aircraft.ts';

export const aircraftSortFields = ['altitude', 'distance', 'speed', 'callsign', 'seen'] as const;
export type AircraftSortField = typeof aircraftSortFields[number];
export type AircraftSortDirection = 'asc' | 'desc';
// Keep the existing serialized values compatible with saved views and paired devices.
export type AircraftSort = `${AircraftSortField}-${AircraftSortDirection}`;
export const aircraftFavoritesFirstStorageKey = 'vector.aircraftFavoritesFirst';

export const isAircraftSort = (value: unknown): value is AircraftSort => typeof value === 'string'
  && aircraftSortFields.some((field) => value === `${field}-asc` || value === `${field}-desc`);
export const aircraftSortField = (sort: AircraftSort) => sort.split('-')[0] as AircraftSortField;
export const aircraftSortDirection = (sort: AircraftSort): AircraftSortDirection => sort.endsWith('-asc') ? 'asc' : 'desc';
export const defaultAircraftSort = (field: AircraftSortField): AircraftSort =>
  `${field}-${field === 'altitude' || field === 'speed' ? 'desc' : 'asc'}`;
export const reverseAircraftSort = (sort: AircraftSort): AircraftSort =>
  `${aircraftSortField(sort)}-${aircraftSortDirection(sort) === 'asc' ? 'desc' : 'asc'}`;

type Options = {
  language?: string;
  favoritesFirst?: boolean;
  favoriteIds?: ReadonlySet<string>;
  distanceKm?: (aircraft: Aircraft) => number | undefined;
};

/** Unknown values stay last in either direction; ties never depend on feed order. */
export function sortAircraft(aircraft: readonly Aircraft[], sort: AircraftSort, options: Options = {}): Aircraft[] {
  const field = aircraftSortField(sort);
  const direction = aircraftSortDirection(sort) === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(options.language, { numeric: true, sensitivity: 'base' });
  const finite = (value: number | undefined) => Number.isFinite(value) ? value : undefined;
  const entries = aircraft.map((item) => {
    const callsign = item.flight.trim();
    const value = field === 'callsign' ? (callsign && callsign.toLowerCase() !== item.id.toLowerCase() ? callsign : undefined)
      : field === 'altitude' ? finite(item.onGround ? 0 : item.altitudeFt)
      : field === 'speed' ? finite(item.groundSpeedKts)
      : field === 'seen' ? finite(item.seenSeconds)
      : finite(options.distanceKm?.(item));
    return { item, callsign, value, favorite: !!options.favoritesFirst && !!options.favoriteIds?.has(item.id) };
  });
  entries.sort((left, right) => {
    const missing = Number(left.value === undefined) - Number(right.value === undefined);
    if (missing) return missing;
    const favorite = Number(right.favorite) - Number(left.favorite);
    if (favorite) return favorite;
    if (left.value !== undefined && right.value !== undefined) {
      const comparison = typeof left.value === 'string' && typeof right.value === 'string'
        ? collator.compare(left.value, right.value) : Number(left.value) - Number(right.value);
      if (comparison) return comparison * direction;
    }
    return collator.compare(left.callsign, right.callsign)
      || (left.item.id < right.item.id ? -1 : left.item.id > right.item.id ? 1 : 0);
  });
  return entries.map(({ item }) => item);
}
