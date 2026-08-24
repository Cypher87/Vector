import type { Aircraft } from '../domain/aircraft';

const altitudePalette = [
  [117, 214, 173],
  [96, 214, 210],
  [114, 168, 233],
  [170, 132, 220],
  [218, 121, 181],
] as const;

const maximumAltitudeFt = 40_000;
const interpolate = (start: number, end: number, progress: number) =>
  Math.round(start + (end - start) * progress);

export function altitudeColorForValue(altitudeFt?: number, onGround = false) {
  if (onGround) return `rgb(${altitudePalette[0].join(', ')})`;
  if (altitudeFt === undefined) return '#d5e1e4';

  const position = Math.min(1, Math.max(0, altitudeFt / maximumAltitudeFt)) * (altitudePalette.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(altitudePalette.length - 1, lowerIndex + 1);
  const progress = position - lowerIndex;
  const lower = altitudePalette[lowerIndex];
  const upper = altitudePalette[upperIndex];

  return `rgb(${interpolate(lower[0], upper[0], progress)}, ${interpolate(lower[1], upper[1], progress)}, ${interpolate(lower[2], upper[2], progress)})`;
}

export function altitudeColor(aircraft: Aircraft) {
  return altitudeColorForValue(aircraft.altitudeFt, aircraft.onGround);
}
