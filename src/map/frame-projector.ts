import type { AircraftPosition } from './aircraft-motion.ts';

type Point = { x: number; y: number };
type Project = (position: AircraftPosition) => Point;
const coordinates = new WeakMap<AircraftPosition, Point>();
const mercatorLatitude = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));

/** A flat Mercator camera is affine. Calibrate once, not once per trace sample.
 * Pitched, terrain and non-Mercator maps keep the map engine's full projection.
 * Immutable coordinate tuples are weakly cached across frames and zoom levels.
 */
export function createFrameProjector(project: Project, centerLongitude: number, flatMercator: boolean): Project {
  if (!flatMercator) return project;
  const origin = project([centerLongitude, 0]);
  const east = project([centerLongitude + 1, 0]);
  const north = project([centerLongitude, 45]);
  const northDistance = mercatorLatitude(45);
  const xx = east.x - origin.x, xy = east.y - origin.y;
  const yx = (north.x - origin.x) / northDistance, yy = (north.y - origin.y) / northDistance;
  return (position) => {
    let point = coordinates.get(position);
    if (!point) {
      point = { x: position[0], y: mercatorLatitude(position[1]) };
      coordinates.set(position, point);
    }
    const dx = point.x - centerLongitude;
    return { x: origin.x + dx * xx + point.y * yx, y: origin.y + dx * xy + point.y * yy };
  };
}
