import type { Aircraft, FeedStatus } from './aircraft.ts';
import { normalizeAircraftFilterPresetIds, normalizeAircraftFilterPresetName } from './aircraft-filter-preset.ts';
import { observeFilterNotifications, type FilterNotificationContext, type FilterNotificationState, type MatchedFilter } from './filter-notifications.ts';

export const radarEventKinds = [
  'favorite-entered',
  'filter-matched',
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
  matchedFilters?: MatchedFilter[];
  id: string;
  kind: RadarEventKind;
  read: boolean;
  registration?: string;
  timestamp: number;
};

export type RadarEventMonitorState = {
  emergencies: Map<string, { squawk: string; lastSeen: number }>;
  /** null means present; a timestamp is the start of an observed absence. */
  favorites: Map<string, number | null>;
  filters: FilterNotificationState;
  initialized: boolean;
  hasBeenLive: boolean;
  receiverOfflineSince?: number;
  receiverNotified: boolean;
  lastObservedAt?: number;
};

export const favoriteAbsenceMs = 5 * 60_000;
export const receiverAlertDelayMs = 30_000;
export const radarEventCooldownMs = 30 * 60_000;
export const radarEventRetentionMs = 24 * 60 * 60_000;
const observationGapMs = 60_000;

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

const eventKey = (event: RadarEvent) => event.kind.startsWith('receiver-')
  ? 'receiver' : `${event.kind === 'filter-matched' || event.kind === 'favorite-entered' ? 'interest' : event.kind}:${event.aircraftId}`;

/** One latest notification per subject, including a single receiver incident/status. */
function compactRadarEvents(events: readonly RadarEvent[], now: number): RadarEvent[] {
  const seen = new Set<string>();
  return [...events].filter((event) => event.timestamp >= now - radarEventRetentionMs && event.timestamp <= now + 60_000)
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((event) => {
      const key = eventKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 100);
}

export function mergeRadarEvents(current: readonly RadarEvent[], incoming: readonly RadarEvent[], now = Date.now()): RadarEvent[] {
  let next = compactRadarEvents(current, now);
  for (const event of [...incoming].sort((a, b) => a.timestamp - b.timestamp)) {
    const key = eventKey(event);
    const previous = next.find((item) => eventKey(item) === key);
    if (previous && previous.timestamp > event.timestamp) continue;
    const repeat = previous && event.timestamp - previous.timestamp < radarEventCooldownMs;
    // Recovery updates the outage row, never creates a second unread notification.
    const read = event.kind === 'receiver-online' ? previous?.read ?? true
      : repeat ? previous.read : event.read;
    // Favorites and overlapping filters describe one sighting, not separate alerts.
    const matchedFilters = event.matchedFilters ?? (repeat ? previous.matchedFilters : undefined);
    next = [{ ...event, ...(matchedFilters?.length ? { kind: 'filter-matched', matchedFilters } : {}), read }, ...next.filter((item) => eventKey(item) !== key)];
  }
  next = compactRadarEvents(next, now);
  return next.length === current.length && next.every((event, index) => event === current[index])
    ? current as RadarEvent[] : next;
}

export function parseRadarEvents(value: string | null, now = Date.now()): RadarEvent[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const events = parsed.slice(0, 1_000).flatMap((candidate): RadarEvent[] => {
      if (
        !isObject(candidate)
        || typeof candidate.id !== 'string'
        || candidate.id.length > 160
        || !radarEventKinds.includes(candidate.kind as RadarEventKind)
        || typeof candidate.timestamp !== 'number'
        || !Number.isFinite(candidate.timestamp)
      ) return [];
      const aircraftId = typeof candidate.aircraftId === 'string' && /^~?[a-f0-9]{6}$/i.test(candidate.aircraftId)
        ? candidate.aircraftId.toLowerCase()
        : undefined;
      const receiver = (candidate.kind as string).startsWith('receiver-');
      if (!receiver && !aircraftId) return [];
      const matchedFilters = Array.isArray(candidate.matchedFilters) ? candidate.matchedFilters.slice(0, 20).flatMap((filter): MatchedFilter[] => {
        if (!isObject(filter) || normalizeAircraftFilterPresetIds([filter.id]).length !== 1) return [];
        const name = normalizeAircraftFilterPresetName(filter.name);
        return name ? [{ id: filter.id as string, name }] : [];
      }) : [];
      if (candidate.kind === 'filter-matched' && !matchedFilters.length) return [];
      return [{
        aircraftId: receiver ? undefined : aircraftId,
        flight: !receiver && typeof candidate.flight === 'string' ? candidate.flight.slice(0, 16) : undefined,
        id: candidate.id,
        kind: candidate.kind as RadarEventKind,
        ...(candidate.kind === 'filter-matched' ? { matchedFilters } : {}),
        read: candidate.read === true,
        registration: !receiver && typeof candidate.registration === 'string' ? candidate.registration.slice(0, 16) : undefined,
        timestamp: candidate.timestamp,
      }];
    });
    return compactRadarEvents(events, now);
  } catch {
    return [];
  }
}

export function emptyRadarEventMonitorState(): RadarEventMonitorState {
  return {
    emergencies: new Map(),
    favorites: new Map(),
    filters: new Map(),
    initialized: false,
    hasBeenLive: false,
    receiverNotified: false,
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
  visible = true,
  filterContext?: FilterNotificationContext,
): { events: RadarEvent[]; state: RadarEventMonitorState } {
  const gap = previous.lastObservedAt !== undefined
    && (timestamp - previous.lastObservedAt > observationGapMs || timestamp < previous.lastObservedAt);
  const state: RadarEventMonitorState = {
    ...previous,
    emergencies: new Map(previous.emergencies),
    favorites: new Map(previous.favorites),
    lastObservedAt: timestamp,
  };
  const events: RadarEvent[] = [];

  if (receiverStatus === 'live') {
    if (previous.receiverNotified && preferences.receiver) {
      events.push({ id: `${timestamp}-receiver-online`, kind: 'receiver-online', read: false, timestamp });
    }
    state.receiverOfflineSince = undefined;
    state.receiverNotified = false;
    state.hasBeenLive = true;
  } else if (receiverStatus === 'offline' && visible && !gap && previous.hasBeenLive) {
    state.receiverOfflineSince ??= timestamp;
    if (!state.receiverNotified && timestamp - state.receiverOfflineSince >= receiverAlertDelayMs && preferences.receiver) {
      events.push({ id: `${timestamp}-receiver-offline`, kind: 'receiver-offline', read: false, timestamp });
      state.receiverNotified = true;
    }
  } else {
    // A sleeping/background tab or a short delay isn't evidence of receiver failure.
    state.receiverOfflineSince = undefined;
  }

  if (receiverStatus !== 'live') {
    state.initialized = false;
    return { events, state };
  }

  const fresh = aircraft.filter((item) => Number.isFinite(item.seenSeconds) && item.seenSeconds <= 60);
  const present = new Set(fresh.map((item) => item.id));
  const baseline = !previous.initialized || gap;
  const filtered = observeFilterNotifications(previous.filters, fresh, favoriteIds,
    filterContext ?? { presets: [], distanceKm: () => undefined, receiverKey: '' }, timestamp, baseline);
  state.filters = filtered.state;
  state.favorites.clear();
  for (const id of favoriteIds) {
    const absentSince = previous.favorites.get(id);
    // Already-present favorites on startup, recovery or newly favoriting aren't arrivals.
    state.favorites.set(id, present.has(id) ? null
      : baseline || absentSince === undefined ? timestamp - favoriteAbsenceMs : absentSince ?? timestamp);
  }
  for (const [id, emergency] of state.emergencies) {
    if (!present.has(id) && timestamp - emergency.lastSeen >= favoriteAbsenceMs) state.emergencies.delete(id);
  }
  for (const item of fresh) {
    const emergency = item.squawk === '7500' || item.squawk === '7600' || item.squawk === '7700';
    const changed = emergency && previous.emergencies.get(item.id)?.squawk !== item.squawk;
    if (emergency) state.emergencies.set(item.id, { squawk: item.squawk!, lastSeen: timestamp });
    else state.emergencies.delete(item.id);
    const absentSince = previous.favorites.get(item.id);
    if (changed && preferences.emergency) {
      events.push(eventForAircraft(item, `squawk-${item.squawk}` as RadarEventKind, timestamp));
    } else if (filtered.matches.has(item.id) && !(emergency && preferences.emergency)) {
      events.push({ ...eventForAircraft(item, 'filter-matched', timestamp), matchedFilters: filtered.matches.get(item.id) });
    } else if (!baseline && preferences.favorite && favoriteIds.has(item.id)
      && absentSince !== undefined && absentSince !== null && timestamp - absentSince >= favoriteAbsenceMs) {
      events.push(eventForAircraft(item, 'favorite-entered', timestamp));
    }
  }
  state.initialized = true;
  return { events, state };
}
