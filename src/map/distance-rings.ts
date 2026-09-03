import type { UnitSystem } from '../domain/aircraft';

export type DistanceRing = {
  coordinates: [longitude: number, latitude: number][];
  distanceKilometres: number;
  label: string;
  labelCoordinate: [longitude: number, latitude: number];
};

const earthRadiusKilometres = 6_371;
const degreesToRadians = (degrees: number) => degrees * Math.PI / 180;
const radiansToDegrees = (radians: number) => radians * 180 / Math.PI;

export const distanceRingScale = (unitSystem: UnitSystem) => {
  if (unitSystem === 'aeronautical') {
    return [25, 50, 75, 100].map((nauticalMiles) => ({
      distanceKilometres: nauticalMiles * 1.852,
      label: `${nauticalMiles} NM`,
    }));
  }
  if (unitSystem === 'imperial') {
    return [25, 50, 75, 100].map((miles) => ({
      distanceKilometres: miles * 1.609344,
      label: `${miles} mi`,
    }));
  }
  return [50, 100, 150, 200].map((kilometres) => ({
    distanceKilometres: kilometres,
    label: `${kilometres} km`,
  }));
};

export const destinationCoordinate = (
  center: [longitude: number, latitude: number],
  distanceKilometres: number,
  bearingDegrees: number,
): [longitude: number, latitude: number] => {
  const angularDistance = distanceKilometres / earthRadiusKilometres;
  const bearing = degreesToRadians(bearingDegrees);
  const latitude = degreesToRadians(center[1]);
  const longitude = degreesToRadians(center[0]);
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );

  return [
    ((radiansToDegrees(destinationLongitude) + 540) % 360) - 180,
    radiansToDegrees(destinationLatitude),
  ];
};

export const distanceRingLabelCoordinate = (
  center: [longitude: number, latitude: number],
  distanceKilometres: number,
): [longitude: number, latitude: number] => {
  const angularDistance = distanceKilometres / earthRadiusKilometres;
  const latitude = degreesToRadians(center[1]);
  const cosineLatitudeSquared = Math.cos(latitude) ** 2;
  if (cosineLatitudeSquared < Number.EPSILON) {
    return destinationCoordinate(center, distanceKilometres, 90);
  }

  const cosineLongitudeOffset = (
    Math.cos(angularDistance) - Math.sin(latitude) ** 2
  ) / cosineLatitudeSquared;
  const longitudeOffset = Math.acos(Math.max(-1, Math.min(1, cosineLongitudeOffset)));
  const longitude = ((center[0] + radiansToDegrees(longitudeOffset) + 540) % 360) - 180;

  return [longitude, center[1]];
};

export const createDistanceRings = (
  center: [longitude: number, latitude: number],
  unitSystem: UnitSystem,
  segments = 96,
): DistanceRing[] => distanceRingScale(unitSystem).map(({ distanceKilometres, label }) => ({
  coordinates: Array.from({ length: segments + 1 }, (_, index) =>
    destinationCoordinate(center, distanceKilometres, index / segments * 360)),
  distanceKilometres,
  label,
  labelCoordinate: distanceRingLabelCoordinate(center, distanceKilometres),
}));
