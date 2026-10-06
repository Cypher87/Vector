import type { AircraftTracePoint } from './aircraft.ts';

/** Receiver recordings are intentionally sparser than the live browser samples. */
export type WakeTracePoint = AircraftTracePoint & { receiverInterval?: boolean };
export const receiverWakeIntervalSeconds = 180;
export const wakeTraceWindowSeconds = 1_200;

export function recentWakeTrace(points: readonly AircraftTracePoint[], now: number): WakeTracePoint[] {
  return points.filter((point) => Number.isFinite(point.timestamp)
    && point.timestamp >= now - wakeTraceWindowSeconds && point.timestamp <= now + 1)
    .slice(-600).map((point) => ({ ...point, receiverInterval: true }));
}

/** Live measurements win on overlap; only the initial buffer boundary is joined. */
export function mergeWakeTrace(receiver: readonly WakeTracePoint[], local: readonly AircraftTracePoint[]): readonly WakeTracePoint[] {
  if (!local.length) return receiver;
  const first = local[0];
  const prefix = receiver.filter((point) => point.timestamp < first.timestamp);
  const previous = prefix.at(-1);
  if (!previous || first.timestamp - previous.timestamp > receiverWakeIntervalSeconds) return local;
  // The first browser sample starts a buffer, not necessarily a new flight leg.
  // Keep every subsequent leg/stale/ground flag so genuine breaks stay breaks.
  return [...prefix, { ...first, startsLeg: false, receiverInterval: true }, ...local.slice(1)].slice(-600);
}
