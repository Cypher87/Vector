import type { Aircraft } from '../domain/aircraft';

const feetPerKilometre = 3_280.84;
const altitudeStops = [
  { altitudeFt: 0, color: [110, 216, 154] },
  { altitudeFt: 1 * feetPerKilometre, color: [110, 216, 182] },
  { altitudeFt: 2 * feetPerKilometre, color: [110, 216, 211] },
  { altitudeFt: 3 * feetPerKilometre, color: [110, 194, 216] },
  { altitudeFt: 4 * feetPerKilometre, color: [110, 166, 216] },
  { altitudeFt: 5 * feetPerKilometre, color: [110, 138, 216] },
  { altitudeFt: 6 * feetPerKilometre, color: [110, 110, 216] },
  { altitudeFt: 7 * feetPerKilometre, color: [138, 110, 216] },
  { altitudeFt: 8 * feetPerKilometre, color: [166, 110, 216] },
  { altitudeFt: 9 * feetPerKilometre, color: [194, 110, 216] },
  { altitudeFt: 10 * feetPerKilometre, color: [216, 110, 211] },
  { altitudeFt: 11 * feetPerKilometre, color: [216, 110, 182] },
  { altitudeFt: 12 * feetPerKilometre, color: [216, 110, 154] },
] as const;

const interpolate = (start: number, end: number, progress: number) =>
  Math.round(start + (end - start) * progress);

export function altitudeColorForValue(altitudeFt?: number, onGround = false) {
  if (onGround) return `rgb(${altitudeStops[0].color.join(', ')})`;
  if (altitudeFt === undefined) return '#d5e1e4';

  const clampedAltitudeFt = Math.min(
    altitudeStops.at(-1)!.altitudeFt,
    Math.max(altitudeStops[0].altitudeFt, altitudeFt),
  );
  const upperIndex = altitudeStops.findIndex((stop) => stop.altitudeFt >= clampedAltitudeFt);
  const lowerIndex = Math.max(0, upperIndex - 1);
  const lower = altitudeStops[lowerIndex];
  const upper = altitudeStops[upperIndex];
  const interval = upper.altitudeFt - lower.altitudeFt;
  const progress = interval === 0 ? 0 : (clampedAltitudeFt - lower.altitudeFt) / interval;

  return `rgb(${interpolate(lower.color[0], upper.color[0], progress)}, ${interpolate(lower.color[1], upper.color[1], progress)}, ${interpolate(lower.color[2], upper.color[2], progress)})`;
}

export function altitudeColor(aircraft: Aircraft) {
  return altitudeColorForValue(aircraft.altitudeFt, aircraft.onGround);
}
