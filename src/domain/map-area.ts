import type { Aircraft } from './aircraft.ts';

export type AreaCoordinate = [longitude: number, latitude: number];
export type MapArea = { kind: 'circle'; center: AreaCoordinate; radiusKm: number }
  | { kind: 'polygon'; points: AreaCoordinate[] };
export type AreaDrawing = { kind: MapArea['kind']; points: AreaCoordinate[]; radiusKm?: number };
export const maxAreaPoints = 32;
export const maxAreaRadiusKm = 500;
const radians = (value: number) => value * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;
export const unwrapAreaLongitude = (value: number, reference: number) => reference + ((value - reference + 540) % 360 + 360) % 360 - 180;

export function areaDistanceKm(a: AreaCoordinate, b: AreaCoordinate) {
  const lat = Math.sin(radians(b[1] - a[1]) / 2);
  const lon = Math.sin(radians(b[0] - a[0]) / 2);
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(lat * lat + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * lon * lon)));
}

const validCoordinate = (value: unknown): value is AreaCoordinate => Array.isArray(value) && value.length === 2
  && value.every((number) => typeof number === 'number' && Number.isFinite(number))
  && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 85;
const unwrapPoints = (points: AreaCoordinate[]) => points.map(([lon, lat]): AreaCoordinate => [unwrapAreaLongitude(lon, points[0][0]), lat]);
const cross = (a: AreaCoordinate, b: AreaCoordinate, p: AreaCoordinate) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const onSegment = (a: AreaCoordinate, b: AreaCoordinate, p: AreaCoordinate) => Math.abs(cross(a, b, p)) < 1e-10
  && p[0] >= Math.min(a[0], b[0]) - 1e-10 && p[0] <= Math.max(a[0], b[0]) + 1e-10
  && p[1] >= Math.min(a[1], b[1]) - 1e-10 && p[1] <= Math.max(a[1], b[1]) + 1e-10;
const intersect = (a: AreaCoordinate, b: AreaCoordinate, c: AreaCoordinate, d: AreaCoordinate) =>
  onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
  || (cross(a, b, c) > 0) !== (cross(a, b, d) > 0) && (cross(c, d, a) > 0) !== (cross(c, d, b) > 0);

export function normalizeMapArea(value: unknown): MapArea | undefined {
  if (!value || typeof value !== 'object') return;
  const area = value as Record<string, unknown>;
  if (area.kind === 'circle' && validCoordinate(area.center) && typeof area.radiusKm === 'number'
    && Number.isFinite(area.radiusKm) && area.radiusKm >= .1 && area.radiusKm <= maxAreaRadiusKm) {
    return { kind: 'circle', center: [...area.center], radiusKm: area.radiusKm };
  }
  if (area.kind !== 'polygon' || !Array.isArray(area.points) || area.points.length < 3
    || area.points.length > maxAreaPoints || !area.points.every(validCoordinate)) return;
  const points = unwrapPoints(area.points);
  if (Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])) >= 180) return;
  let surface = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (a[0] === b[0] && a[1] === b[1]) return;
    surface += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersect(a, b, points[j], points[(j + 1) % points.length])) return;
    }
  }
  if (Math.abs(surface) < 1e-10) return;
  return { kind: 'polygon', points: area.points.map((point) => [...point] as AreaCoordinate) };
}

export function areaContains(area: MapArea, longitude: number, latitude: number) {
  if (!validCoordinate([longitude, latitude])) return false;
  if (area.kind === 'circle') return areaDistanceKm(area.center, [longitude, latitude]) <= area.radiusKm + 1e-7;
  const points = unwrapPoints(area.points);
  const point: AreaCoordinate = [unwrapAreaLongitude(longitude, points[0][0]), latitude];
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (onSegment(a, b, point)) return true;
    if ((a[1] > latitude) !== (b[1] > latitude)
      && point[0] < (b[0] - a[0]) * (latitude - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export const aircraftHasAreaPosition = (aircraft: Aircraft) => validCoordinate([aircraft.longitude, aircraft.latitude])
  && Number.isFinite(aircraft.positionSeenSeconds ?? aircraft.seenSeconds)
  && (aircraft.positionSeenSeconds ?? aircraft.seenSeconds) <= 20;

export function drawingMapArea(drawing: AreaDrawing): MapArea | undefined {
  if (drawing.kind === 'polygon') return normalizeMapArea({ kind: 'polygon', points: drawing.points });
  if (!drawing.points[0]) return;
  return normalizeMapArea({ kind: 'circle', center: drawing.points[0], radiusKm: drawing.radiusKm
    ?? (drawing.points[1] ? areaDistanceKm(drawing.points[0], drawing.points[1]) : 0) });
}

/** Translate the centre, not the radius; discard the old radius point so it cannot stay behind. */
export function relocateCircleDrawing(drawing: AreaDrawing, center: AreaCoordinate): AreaDrawing {
  if (drawing.kind !== 'circle' || !drawing.points[0] || !center.every(Number.isFinite)) return drawing;
  const radiusKm = drawing.radiusKm ?? (drawing.points[1] ? areaDistanceKm(drawing.points[0], drawing.points[1]) : undefined);
  return { kind: 'circle', points: [[unwrapAreaLongitude(center[0], 0), Math.max(-85, Math.min(85, center[1]))]],
    ...(radiusKm !== undefined ? { radiusKm } : {}) };
}

export function areaOutline(area: MapArea): AreaCoordinate[] {
  if (area.kind === 'polygon') return [...area.points, area.points[0]];
  const lat = radians(area.center[1]), lon = radians(area.center[0]), distance = area.radiusKm / 6371;
  return Array.from({ length: 65 }, (_, index): AreaCoordinate => {
    const bearing = index / 64 * 2 * Math.PI;
    const y = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
    const x = lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(y));
    return [((degrees(x) + 540) % 360) - 180, degrees(y)];
  });
}

export function areaBounds(area: MapArea): [AreaCoordinate, AreaCoordinate] {
  const points = unwrapPoints(areaOutline(area));
  return [[Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
    [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]];
}
