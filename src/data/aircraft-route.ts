import type { Aircraft } from '../domain/aircraft';

type UnknownRecord = Record<string, unknown>;

export type RouteAirport = {
  countryCode?: string;
  iata?: string;
  icao?: string;
  latitude?: number;
  location?: string;
  longitude?: number;
  name: string;
};

export type AircraftRoute = {
  airports: RouteAirport[];
  callsign: string;
  plausible: boolean;
};

type CachedRoute = {
  expiresAt: number;
  route: AircraftRoute | null;
};

const ROUTE_API = 'https://adsb.im/api/0/routeset';
const ROUTE_CACHE_MS = 6 * 60 * 60 * 1_000;
const EMPTY_ROUTE_CACHE_MS = 5 * 60 * 1_000;
const routeCache = new Map<string, CachedRoute>();
const pendingRoutes = new Map<string, Promise<AircraftRoute | null>>();
type AircraftRouteLookup = Pick<Aircraft, 'flight' | 'latitude' | 'longitude' | 'registration'>;

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? value as UnknownRecord : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const normalizeCallsign = (value: string) => {
  const callsign = value.trim().toUpperCase();
  const match = callsign.match(/^([A-Z]*)([0-9]*)([A-Z]*)$/);
  if (!match) return callsign;
  const number = match[2].replace(/^0+(?=\d)/, '');
  return `${match[1]}${number}${match[3]}`;
};

const parseAirport = (value: unknown): RouteAirport | undefined => {
  const airport = asRecord(value);
  if (!airport) return undefined;
  const name = asString(airport.name);
  const iata = asString(airport.iata);
  const icao = asString(airport.icao);
  if (!name || (!iata && !icao)) return undefined;

  return {
    name,
    iata,
    icao,
    location: asString(airport.location),
    countryCode: asString(airport.countryiso2),
    latitude: asNumber(airport.lat),
    longitude: asNumber(airport.lon),
  };
};

const parseRoute = (value: unknown, callsign: string): AircraftRoute | null => {
  if (!Array.isArray(value)) return null;
  const routeRecord = value
    .map(asRecord)
    .find((candidate) => candidate && normalizeCallsign(asString(candidate.callsign) ?? '') === callsign)
    ?? asRecord(value[0]);
  if (!routeRecord || !Array.isArray(routeRecord._airports)) return null;

  const airports = routeRecord._airports.flatMap((candidate): RouteAirport[] => {
    const airport = parseAirport(candidate);
    return airport ? [airport] : [];
  });
  if (airports.length < 2) return null;

  return {
    callsign: asString(routeRecord.callsign) ?? callsign,
    airports,
    plausible: routeRecord.plausible !== false,
  };
};

export async function loadAircraftRoute(aircraft: AircraftRouteLookup): Promise<AircraftRoute | null> {
  const callsign = normalizeCallsign(aircraft.flight);
  if (!callsign || callsign === aircraft.registration?.toUpperCase() || !/[0-9]/.test(callsign)) return null;

  const cached = routeCache.get(callsign);
  if (cached && cached.expiresAt > Date.now()) return cached.route;

  const pending = pendingRoutes.get(callsign);
  if (pending) return pending;

  const request = (async () => {
    const plane: { callsign: string; lat?: number; lng?: number } = { callsign };
    if (aircraft.latitude !== undefined && aircraft.longitude !== undefined) {
      plane.lat = aircraft.latitude;
      plane.lng = aircraft.longitude;
    }

    try {
      const response = await fetch(ROUTE_API, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ planes: [plane] }),
      });
      if (!response.ok) return null;
      const route = parseRoute(await response.json(), callsign);
      routeCache.set(callsign, {
        route,
        expiresAt: Date.now() + (route ? ROUTE_CACHE_MS : EMPTY_ROUTE_CACHE_MS),
      });
      return route;
    } catch {
      return null;
    } finally {
      pendingRoutes.delete(callsign);
    }
  })();

  pendingRoutes.set(callsign, request);
  return request;
}
