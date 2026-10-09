import type { Aircraft, AircraftMetadata, FeedStatus } from './aircraft.ts';
import { normalizeFavoriteAircraftIds } from './favorite-aircraft.ts';

export type FavoriteAircraftEntry = {
  id: string;
  registration?: string;
  aircraftType?: string;
  description?: string;
  flight?: string;
  live: boolean;
};

/** Membership comes from saved favorites, never from the visible map or receiver history. */
export function favoriteAircraftOverview(
  favorites: readonly string[], aircraft: readonly Aircraft[], metadata: ReadonlyMap<string, AircraftMetadata>, status: FeedStatus,
): FavoriteAircraftEntry[] {
  const liveAircraft = new Map(aircraft.map((item) => [item.id, item]));
  return normalizeFavoriteAircraftIds(favorites).map((id) => {
    const item = liveAircraft.get(id);
    const record = metadata.get(id);
    const live = status === 'live' && !!item && Number.isFinite(item.seenSeconds) && item.seenSeconds >= 0 && item.seenSeconds <= 60;
    return {
      id, live,
      registration: item?.registration || record?.registration,
      aircraftType: item?.aircraftType || record?.aircraftType,
      description: item?.description || record?.description,
      flight: live ? item.flight : undefined,
    };
  });
}
