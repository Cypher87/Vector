import type { Aircraft, AircraftMetadata, FeedStatus } from './aircraft.ts';
import { normalizeFavoriteAircraftIds, normalizeFavoriteCallsign, normalizeFavoriteCallsigns, normalizeFavoriteRegistration, normalizeFavoriteRegistrations } from './favorite-aircraft.ts';

export type FavoriteAircraftEntry = {
  id: string;
  registration?: string;
  aircraftType?: string;
  description?: string;
  flight?: string;
  live: boolean;
  callsign?: string;
  favoriteRegistration?: string;
  liveAircraftId?: string;
};

/** Membership comes from saved favorites, never from the visible map or receiver history. */
export function favoriteAircraftOverview(
  favorites: readonly string[], aircraft: readonly Aircraft[], metadata: ReadonlyMap<string, AircraftMetadata>, status: FeedStatus,
  callsigns: readonly string[] = [],
  registrations: readonly string[] = [],
): FavoriteAircraftEntry[] {
  const isLive = (item: Aircraft | undefined) => status === 'live' && !!item && Number.isFinite(item.seenSeconds) && item.seenSeconds >= 0 && item.seenSeconds <= 60;
  const liveAircraft = new Map(aircraft.map((item) => [item.id, item]));
  const entries: FavoriteAircraftEntry[] = normalizeFavoriteAircraftIds(favorites).map((id) => {
    const item = liveAircraft.get(id);
    const record = metadata.get(id);
    const live = isLive(item);
    return {
      id, live,
      liveAircraftId: live ? id : undefined,
      registration: item?.registration || record?.registration,
      aircraftType: item?.aircraftType || record?.aircraftType,
      description: item?.description || record?.description,
      flight: live ? item?.flight : undefined,
    };
  });
  const byCallsign = new Map<string, Aircraft[]>();
  const byRegistration = new Map<string, Aircraft[]>();
  for (const item of aircraft) {
    if (!isLive(item)) continue;
    const callsign = normalizeFavoriteCallsign(item.flight);
    const registration = normalizeFavoriteRegistration(item.registration);
    for (const [key, index] of [[callsign, byCallsign], [registration, byRegistration]] as const) {
      if (!key) continue;
      const matches = index.get(key);
      if (matches) matches.push(item);
      else index.set(key, [item]);
    }
  }
  return [...entries, ...normalizeFavoriteCallsigns(callsigns).map((callsign): FavoriteAircraftEntry => {
    const matches = byCallsign.get(callsign) ?? [];
    // Do not choose an arbitrary aircraft when multiple contacts transmit the same callsign.
    const item = matches.length === 1 ? matches[0] : undefined;
    return { id: `callsign:${callsign}`, callsign, flight: callsign, live: matches.length > 0,
      liveAircraftId: item?.id, registration: item?.registration, aircraftType: item?.aircraftType, description: item?.description };
  }), ...normalizeFavoriteRegistrations(registrations).map((registration): FavoriteAircraftEntry => {
    const matches = byRegistration.get(registration) ?? [];
    const item = matches.length === 1 ? matches[0] : undefined;
    return { id: `registration:${registration}`, favoriteRegistration: registration, registration,
      live: matches.length > 0, liveAircraftId: item?.id, flight: item?.flight,
      aircraftType: item?.aircraftType, description: item?.description };
  })];
}
