import type { Aircraft, FeedStatus } from './aircraft.ts';

export const radarEventKinds = [
  'favorite-entered',
  'squawk-7500',
  'squawk-7600',
  'squawk-7700',
  'receiver-offline',
  'receiver-online',
] as const;

export type RadarEventKind = (typeof radarEventKinds)[number];
export type RadarEventPreferenceKey = 'emergency' | 'favorite' | 'receiver';

export type RadarEventPreferences = Record<RadarEventPreferenceKey, boolean>;

export type RadarEvent = {
  aircraftId?: string;
  flight?: string;
  id: string;
  kind: RadarEventKind;
  read: boolean;
  registration?: string;
  timestamp: number;
};

export type RadarEventMonitorState = {
  emergencies: Map<string, string>;
  favorites: Set<string>;
  initialized: boolean;
  receiverStatus?: FeedStatus;
};

export const radarEventStorageKey = 'vector.radarEvents';
export const radarEventPreferencesStorageKey = 'vector.radarEventPreferences';
export const defaultRadarEventPreferences: RadarEventPreferences = {
  emergency: true,
  favorite: true,
  receiver: true,
};

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export function normalizeRadarEventPreferences(value: unknown): RadarEventPreferences {
  if (!isObject(value)) return defaultRadarEventPreferences;
  return {
    emergency: typeof value.emergency === 'boolean' ? value.emergency : true,
    favorite: typeof value.favorite === 'boolean' ? value.favorite : true,
    receiver: typeof value.receiver === 'boolean' ? value.receiver : true,
  };
}

export function parseRadarEventPreferences(value: string | null): RadarEventPreferences {
  if (!value) return defaultRadarEventPreferences;
  try {
    return normalizeRadarEventPreferences(JSON.parse(value));
  } catch {
    return defaultRadarEventPreferences;
  }
}

export function parseRadarEvents(value: string | null): RadarEvent[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate): RadarEvent[] => {
      if (
        !isObject(candidate)
        || typeof candidate.id !== 'string'
        || candidate.id.length > 160
        || !radarEventKinds.includes(candidate.kind as RadarEventKind)
        || typeof candidate.timestamp !== 'number'
        || !Number.isFinite(candidate.timestamp)
      ) return [];
      const aircraftId = typeof candidate.aircraftId === 'string' && /^[a-f0-9]{6}$/i.test(candidate.aircraftId)
        ? candidate.aircraftId.toLowerCase()
        : undefined;
      return [{
        aircraftId,
        flight: typeof candidate.flight === 'string' ? candidate.flight.slice(0, 16) : undefined,
        id: candidate.id,
        kind: candidate.kind as RadarEventKind,
        read: candidate.read === true,
        registration: typeof candidate.registration === 'string' ? candidate.registration.slice(0, 16) : undefined,
        timestamp: candidate.timestamp,
      }];
    }).slice(0, 100);
  } catch {
    return [];
  }
}

export function emptyRadarEventMonitorState(): RadarEventMonitorState {
  return {
    emergencies: new Map(),
    favorites: new Set(),
    initialized: false,
  };
}

const eventForAircraft = (
  aircraft: Aircraft,
  kind: RadarEventKind,
  timestamp: number,
): RadarEvent => ({
  aircraftId: aircraft.id,
  flight: aircraft.flight.trim() || undefined,
  id: `${timestamp}-${kind}-${aircraft.id}`,
  kind,
  read: false,
  registration: aircraft.registration,
  timestamp,
});

export function detectRadarEvents(
  previous: RadarEventMonitorState,
  aircraft: readonly Aircraft[],
  favoriteIds: ReadonlySet<string>,
  receiverStatus: FeedStatus,
  preferences: RadarEventPreferences,
  timestamp = Date.now(),
): { events: RadarEvent[]; state: RadarEventMonitorState } {
  const favorites = new Set(
    aircraft.filter((item) => favoriteIds.has(item.id)).map((item) => item.id),
  );
  const emergencies = new Map<string, string>();
  for (const item of aircraft) {
    if (item.squawk === '7500' || item.squawk === '7600' || item.squawk === '7700') {
      emergencies.set(item.id, item.squawk);
    }
  }

  const state: RadarEventMonitorState = {
    emergencies,
    favorites,
    initialized: true,
    receiverStatus,
  };
  if (!previous.initialized) return { events: [], state };

  const events: RadarEvent[] = [];
  if (preferences.favorite) {
    for (const item of aircraft) {
      if (favorites.has(item.id) && !previous.favorites.has(item.id)) {
        events.push(eventForAircraft(item, 'favorite-entered', timestamp));
      }
    }
  }
  if (preferences.emergency) {
    for (const item of aircraft) {
      const squawk = emergencies.get(item.id);
      if (squawk && previous.emergencies.get(item.id) !== squawk) {
        events.push(eventForAircraft(item, `squawk-${squawk}` as RadarEventKind, timestamp));
      }
    }
  }
  if (preferences.receiver) {
    if (receiverStatus === 'offline' && previous.receiverStatus !== 'offline') {
      events.push({ id: `${timestamp}-receiver-offline`, kind: 'receiver-offline', read: false, timestamp });
    } else if (
      receiverStatus === 'live'
      && (previous.receiverStatus === 'offline' || previous.receiverStatus === 'stale')
    ) {
      events.push({ id: `${timestamp}-receiver-online`, kind: 'receiver-online', read: false, timestamp });
    }
  }

  return { events, state };
}
