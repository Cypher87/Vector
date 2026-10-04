import type { Aircraft, AircraftHistorySnapshot, AircraftTracePoint } from './aircraft.ts';

export function tracePointFromAircraft(aircraft: Aircraft, snapshotTime: number): AircraftTracePoint | undefined {
  if (!Number.isFinite(snapshotTime) || aircraft.latitude === undefined || aircraft.longitude === undefined
    || !Number.isFinite(aircraft.latitude) || !Number.isFinite(aircraft.longitude)) return;
  const age = Math.max(0, aircraft.positionSeenSeconds ?? aircraft.seenSeconds);
  if (!Number.isFinite(age) || age > 20) return;
  return {
    latitude: aircraft.latitude, longitude: aircraft.longitude, timestamp: snapshotTime - age,
    altitudeFt: aircraft.altitudeFt, groundSpeedKts: aircraft.groundSpeedKts, onGround: aircraft.onGround,
    stale: false, startsLeg: false,
  };
}

export function appendTracePoint(points: AircraftTracePoint[], point: AircraftTracePoint) {
  const previous = points.at(-1);
  if (previous && point.timestamp <= previous.timestamp) return points;
  if (previous && point.timestamp - previous.timestamp < 2) return points;
  return [...points.slice(-599), { ...point, startsLeg: !previous || point.timestamp - previous.timestamp > 300 }];
}

export function traceFromHistory(snapshots: AircraftHistorySnapshot[], aircraftId: string): AircraftTracePoint[] {
  let previous: AircraftTracePoint | undefined;
  return snapshots.flatMap((snapshot) => {
    const aircraft = snapshot.aircraft.find((item) => item.id === aircraftId);
    const point = aircraft && tracePointFromAircraft(aircraft, snapshot.timestamp);
    if (!point) { previous = undefined; return []; }
    point.startsLeg = !previous || point.timestamp - previous.timestamp > 300;
    previous = point;
    return [point];
  });
}

export function nearestTracePoint(points: AircraftTracePoint[], timestamp: number) {
  if (!points.length) return -1;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].timestamp < timestamp) low = mid + 1;
    else high = mid;
  }
  return low > 0 && timestamp - points[low - 1].timestamp < points[low].timestamp - timestamp ? low - 1 : low;
}

export function profileSeries(points: AircraftTracePoint[], key: 'altitudeFt' | 'groundSpeedKts', factor: number, top: number, height: number) {
  const valid = (point: AircraftTracePoint) => !point.stale && Number.isFinite(point[key]);
  const values = points.filter(valid).map((point) => point[key]! * factor);
  let minimum = 0;
  let maximum = key === 'altitudeFt' ? 100 : 10;
  for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  maximum *= 1.08;
  const first = points[0]?.timestamp ?? 0;
  const span = Math.max(1, (points.at(-1)?.timestamp ?? first) - first);
  const x = (point: AircraftTracePoint) => 42 + (point.timestamp - first) / span * 266;
  const y = (point: AircraftTracePoint) => top + height - (point[key]! * factor - minimum) / (maximum - minimum) * height;
  let penDown = false;
  let previous: AircraftTracePoint | undefined;
  const path = points.map((point) => {
    if (!valid(point)) { penDown = false; previous = point; return ''; }
    const continues = penDown && !point.startsLeg && previous && point.timestamp - previous.timestamp <= 300;
    const segment = `${continues ? 'L' : 'M'}${x(point).toFixed(2)},${y(point).toFixed(2)}`;
    penDown = true;
    previous = point;
    return segment;
  }).join(' ');
  return { path, minimum, maximum, hasData: values.length > 0, x, y, valid };
}
