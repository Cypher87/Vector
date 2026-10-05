import type { AircraftTracePoint } from '../domain/aircraft.ts';
import { aircraftPositionDistanceMetres, type AircraftPosition } from './aircraft-motion.ts';
import type { AircraftWake } from './aircraft-wake.ts';

export type WakePoint = { x: number; y: number };
export type WakeLane = { path: string; end: WakePoint; length: number };
const iconPixelsPerUnit = 32.4 / 40;

/** Match the resized silhouette's engines, without scaling geographic history or stroke widths. */
export const aircraftWakeOrigins = (wake: AircraftWake, iconScale: number): [number, number][] =>
  wake.origins.map(([x, y]) => [20 + (x - 20) * iconScale, 20 + (y - 20) * iconScale]);

/** Recent measured positions, projected into the rotating icon's coordinate space. */
export function aircraftWakeRoute(
  trace: readonly AircraftTracePoint[], now: number, position: AircraftPosition,
  project: (position: AircraftPosition) => WakePoint, rotation: number, maximumLength: number,
): WakePoint[] {
  const origin = project(position);
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const route: WakePoint[] = [{ x: 0, y: 0 }];
  let newer: AircraftTracePoint | undefined;
  let length = 0;
  // Reuse the whole bounded local trace buffer (600 samples at ~2 seconds).
  for (let index = trace.length - 1; index >= Math.max(0, trace.length - 600); index--) {
    const point = trace[index];
    if (!Number.isFinite(point.timestamp) || point.timestamp > now + 1) continue;
    if (point.stale || point.onGround || now - point.timestamp > 1_200
      || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90
      || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) break;
    if (!newer && now - point.timestamp > 15) break;
    if (!newer && aircraftPositionDistanceMetres(position, [point.longitude, point.latitude]) > 2_500) break;
    if (newer) {
      const elapsed = newer.timestamp - point.timestamp;
      if (newer.startsLeg || elapsed > 15 || elapsed <= 0) break;
      if (aircraftPositionDistanceMetres([point.longitude, point.latitude], [newer.longitude, newer.latitude])
        > Math.max(2_000, elapsed * 1_200)) break;
    }
    newer = point;
    // Use the same wrapped world as the marker, including at the date line.
    const longitude = position[0] + ((point.longitude - position[0] + 540) % 360) - 180;
    const projected = project([longitude, point.latitude]);
    const dx = projected.x - origin.x, dy = projected.y - origin.y;
    const local = { x: (dx * cos + dy * sin) / iconPixelsPerUnit, y: (-dx * sin + dy * cos) / iconPixelsPerUnit };
    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) break;
    const previous = route.at(-1)!;
    const distance = Math.hypot(local.x - previous.x, local.y - previous.y);
    if (distance < .05) continue;
    route.push(local);
    length += distance;
    if (length >= maximumLength) break;
  }
  return route;
}

/** Parallel engine lanes follow the measured route, not the current heading. */
export function aircraftWakeLane(wake: AircraftWake, index: number, route: readonly WakePoint[]): WakeLane {
  const empty = { path: '', end: { x: 0, y: 1 }, length: 0 };
  if (route.length < 2) return empty;
  const cumulative = [0];
  for (let i = 1; i < route.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(route[i].x - route[i - 1].x, route[i].y - route[i - 1].y));
  const [engineX, engineY] = wake.origins[index];
  const start = engineY - 20;
  const length = Math.min(wake.length, cumulative.at(-1)! - start);
  if (length < .5) return empty;
  const at = (distance: number): WakePoint => {
    const bounded = Math.max(0, Math.min(cumulative.at(-1)!, distance));
    const end = Math.max(1, cumulative.findIndex((value) => value >= bounded));
    const amount = (bounded - cumulative[end - 1]) / Math.max(.001, cumulative[end] - cumulative[end - 1]);
    return { x: route[end - 1].x + (route[end].x - route[end - 1].x) * amount,
      y: route[end - 1].y + (route[end].y - route[end - 1].y) * amount };
  };
  const centers = [at(start)];
  for (let i = 1; i < route.length; i++) {
    if (cumulative[i] > start && cumulative[i] < start + length) centers.push(route[i]);
  }
  centers.push(at(start + length));
  // Collapse redundant straight samples before offsetting. Otherwise an inside
  // corner can double back past the previous sample and form a small hook.
  const simplified: WakePoint[] = [];
  for (const point of centers) {
    while (simplified.length > 1) {
      const a = simplified.at(-2)!, b = simplified.at(-1)!;
      const ax = b.x - a.x, ay = b.y - a.y, bx = point.x - b.x, by = point.y - b.y;
      if (ax * bx + ay * by < 0 || Math.abs(ax * by - ay * bx) > .05 * Math.hypot(ax + bx, ay + by)) break;
      simplified.pop();
    }
    simplified.push(point);
  }
  const normals = simplified.slice(1).map((point, i) => {
    const dx = point.x - simplified[i].x, dy = point.y - simplified[i].y;
    const size = Math.hypot(dx, dy) || 1;
    return { x: dy / size, y: -dx / size };
  });
  const offset = engineX - 20;
  const points: WakePoint[] = [{ x: 0, y: 0 }];
  const add = (center: WakePoint, normal: WakePoint, amount = offset) => {
    points.push({ x: center.x + normal.x * amount - offset, y: center.y + normal.y * amount - start });
  };
  for (let i = 1; i < simplified.length - 1; i++) {
    const before = normals[i - 1], after = normals[i];
    const divisor = 1 + before.x * after.x + before.y * after.y;
    if (divisor >= .5) {
      // Intersect adjacent parallel segments instead of rotating their offsets
      // around a sharp corner. A bounded miter prevents spikes in tight turns.
      add(simplified[i], { x: before.x + after.x, y: before.y + after.y }, offset / divisor);
    } else {
      add(simplified[i], before);
      add(simplified[i], after);
    }
  }
  add(simplified.at(-1)!, normals.at(-1)!);
  const format = (point: WakePoint) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  let path = 'M0 0';
  // Round corners locally, without the overshoot of an unconstrained spline.
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1], corner = points[i], next = points[i + 1];
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(6, before / 2, after / 2);
    if (radius < .001) continue;
    const approach = { x: corner.x + (previous.x - corner.x) * radius / before,
      y: corner.y + (previous.y - corner.y) * radius / before };
    const departure = { x: corner.x + (next.x - corner.x) * radius / after,
      y: corner.y + (next.y - corner.y) * radius / after };
    path += `L${format(approach)}Q${format(corner)} ${format(departure)}`;
  }
  path += `L${format(points.at(-1)!)}`;
  return { path, end: points.at(-1)!, length };
}
