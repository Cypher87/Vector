import type { Aircraft, AircraftHistorySnapshot } from './aircraft.ts';
import { tracePointFromAircraft } from './flight-profile.ts';
import type { LogbookEntry, LogbookVisit } from './logbook.ts';

export type LogbookReplayRequest = Pick<LogbookEntry, 'hex' | 'registration' | 'aircraftType' | 'description'>
  & Pick<LogbookVisit, 'firstSeen' | 'lastSeen'>;

export type LogbookReplayResult = { status: 'ready'; aircraft: Aircraft }
  | { status: 'unavailable' | 'failed' | 'cancelled' };

const WINDOW_SECONDS = 30 * 60;

/** Recorder timestamps are milliseconds; replay timestamps are seconds. */
export function logbookReplayWindow(request: LogbookReplayRequest) {
  if (!/^[a-f0-9]{6}$/.test(request.hex) || !Number.isFinite(request.firstSeen)
    || !Number.isFinite(request.lastSeen) || request.firstSeen < 0 || request.lastSeen < request.firstSeen
    || request.lastSeen > 8.64e15) return undefined;
  const end = request.lastSeen / 1000;
  const start = Math.max(Math.floor(request.firstSeen / 1000), Math.floor(end) - WINDOW_SECONDS);
  const chunks: number[] = [];
  for (let time = Math.floor(start / WINDOW_SECONDS) * WINDOW_SECONDS; time <= end; time += WINDOW_SECONDS) {
    chunks.push(time * 1000);
  }
  return { start, end, chunks };
}

/** Never fall back to a neighbouring flight, time window or live position. */
export function selectLogbookReplay(request: LogbookReplayRequest, recordings: AircraftHistorySnapshot[][]) {
  const window = logbookReplayWindow(request);
  if (!window) return undefined;
  const byTime = new Map<number, AircraftHistorySnapshot>();
  for (const snapshots of recordings) {
    for (const snapshot of snapshots) {
      if (!Number.isFinite(snapshot.timestamp) || snapshot.timestamp < window.start || snapshot.timestamp > window.end) continue;
      const previous = byTime.get(snapshot.timestamp);
      // Session data can supplement a receiver slice without discarding its other aircraft.
      byTime.set(snapshot.timestamp, previous ? { ...snapshot,
        aircraft: [...new Map([...previous.aircraft, ...snapshot.aircraft].map((aircraft) => [aircraft.id, aircraft])).values()],
      } : snapshot);
    }
  }
  const snapshots = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  const positioned = (snapshot: AircraftHistorySnapshot) => snapshot.aircraft.find((aircraft) => {
    if (aircraft.id !== request.hex) return false;
    const point = tracePointFromAircraft(aircraft, snapshot.timestamp);
    return point && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
      && point.timestamp >= window.start;
  });
  const first = snapshots.findIndex((snapshot) => positioned(snapshot));
  const last = snapshots.findLastIndex((snapshot) => positioned(snapshot));
  if (first < 0) return undefined;
  // Keep gaps within the sighting, but don't start/end playback on an absent aircraft.
  const trimmed = snapshots.slice(first, last + 1);
  return { snapshots: trimmed, index: trimmed.length - 1, aircraft: positioned(trimmed.at(-1)!)! };
}
