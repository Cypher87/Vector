import type { AircraftTracePoint } from './aircraft';

export const legTracePeriods = [30, 60, 120, 240, 360, 480, 'full'] as const;
export type LegTracePeriod = typeof legTracePeriods[number];

export const defaultLegTracePeriod: LegTracePeriod = 30;

export const parseLegTracePeriod = (value: string | null | undefined): LegTracePeriod => {
  if (value === 'full') return value;
  const minutes = Number(value);
  return legTracePeriods.includes(minutes as LegTracePeriod)
    ? minutes as LegTracePeriod
    : defaultLegTracePeriod;
};

export const limitAircraftTracePeriod = (
  points: AircraftTracePoint[],
  period: LegTracePeriod,
): AircraftTracePoint[] => {
  if (period === 'full' || points.length === 0) return points;
  const newestTimestamp = points.at(-1)!.timestamp;
  const firstVisibleIndex = points.findIndex((point) => point.timestamp >= newestTimestamp - period * 60);
  return firstVisibleIndex <= 0 ? points : points.slice(firstVisibleIndex);
};
