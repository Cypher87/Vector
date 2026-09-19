import type { Aircraft } from '../domain/aircraft.ts';

export type AircraftPosition = [longitude: number, latitude: number];

export const maximumAircraftProjectionSeconds = 8;
export const maximumSmoothCorrectionMetres = 2_500;

const earthRadiusMetres = 6_371_000;
const knotsToMetresPerSecond = 0.514444;
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const aircraftHasMotionData = (aircraft: Aircraft): boolean => {
  return aircraft.latitude !== undefined
    && aircraft.longitude !== undefined
    && aircraft.trackDeg !== undefined
    && aircraft.groundSpeedKts !== undefined
    && aircraft.groundSpeedKts >= 10
    && !aircraft.onGround;
};

export function aircraftMotionEnabled(aircraft: Aircraft): boolean {
  return aircraftHasMotionData(aircraft)
    && (aircraft.positionSeenSeconds ?? aircraft.seenSeconds) < maximumAircraftProjectionSeconds;
}

export function projectAircraftPosition(
  aircraft: Aircraft,
  secondsSinceSnapshot = 0,
): AircraftPosition | undefined {
  if (aircraft.latitude === undefined || aircraft.longitude === undefined) return undefined;
  const position: AircraftPosition = [aircraft.longitude, aircraft.latitude];
  if (!aircraftHasMotionData(aircraft)) return position;

  const positionAge = Math.max(0, aircraft.positionSeenSeconds ?? aircraft.seenSeconds);
  const projectionSeconds = clamp(
    positionAge + Math.max(0, secondsSinceSnapshot),
    0,
    maximumAircraftProjectionSeconds,
  );
  if (projectionSeconds === 0) return position;

  const angularDistance = aircraft.groundSpeedKts! * knotsToMetresPerSecond
    * projectionSeconds / earthRadiusMetres;
  const bearing = radians(aircraft.trackDeg!);
  const latitude = radians(aircraft.latitude);
  const longitude = radians(aircraft.longitude);
  const projectedLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const projectedLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(projectedLatitude),
  );

  return [
    ((degrees(projectedLongitude) + 540) % 360) - 180,
    degrees(projectedLatitude),
  ];
}

export function interpolateAircraftPosition(
  from: AircraftPosition,
  to: AircraftPosition,
  progress: number,
): AircraftPosition {
  const amount = clamp(progress, 0, 1);
  const longitudeDelta = ((to[0] - from[0] + 540) % 360) - 180;
  return [
    ((from[0] + longitudeDelta * amount + 540) % 360) - 180,
    from[1] + (to[1] - from[1]) * amount,
  ];
}

export function aircraftPositionDistanceMetres(from: AircraftPosition, to: AircraftPosition): number {
  const deltaLatitude = radians(to[1] - from[1]);
  const deltaLongitude = radians(to[0] - from[0]);
  const originLatitude = radians(from[1]);
  const destinationLatitude = radians(to[1]);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusMetres * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
