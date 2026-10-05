import type { Aircraft, AircraftKind } from '../domain/aircraft.ts';
import { aircraftKind } from '../domain/aircraft-kind.ts';
import { aircraftIconMotionActive } from './icon-animation.ts';
import type { VectorAircraftShapeName } from './vector-aircraft-shapes.ts';

export type AircraftWakeStyle = 'jet' | 'propeller' | 'turboprop';
export type AircraftWake = {
  style: AircraftWakeStyle;
  origins: [number, number][];
  length: number;
  width: number;
  duration: number;
};

const minimumWakeZoom = 6.6;
const fullWakeZoom = 7.2;
const wakeLengthScale = 12.5;
// Include long tails when deciding which offscreen aircraft can still draw.
export const maximumAircraftWakeScreenLength = 38 * wakeLengthScale * 32.4 / 40;

/** Ease in across a zoom band instead of switching on at a single zoom level. */
export function aircraftWakeZoomOpacity(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  const progress = Math.max(0, Math.min(1, (zoom - minimumWakeZoom) / (fullWakeZoom - minimumWakeZoom)));
  return progress * progress * (3 - 2 * progress);
}

/** Build trail length before opacity, keeping wider views softly faded. */
export function aircraftWakeZoomProfile(zoom: number) {
  const detailFrom = (start: number) => {
    const progress = Number.isFinite(zoom) ? Math.max(0, Math.min(1, (zoom - start) / 3)) : 0;
    return progress * progress * (3 - 2 * progress);
  };
  // Length builds earlier than opacity so longer routes remain subtle.
  const lengthDetail = detailFrom(6.5);
  const fadeDetail = detailFrom(8.5);
  return {
    lengthScale: .16 + .84 * lengthDetail,
    middleOpacity: .12 + .16 * fadeDetail,
    tailOpacity: .025 + .095 * fadeDetail,
  };
}

// These are decorative, screen-sized airflow cues, not measured exhaust or
// weather-dependent contrails. Unpowered/ambiguous categories remain unmarked.
const familyStyles: Record<AircraftKind, AircraftWakeStyle | undefined> = {
  airliner: 'jet', heavy: 'jet', small: 'jet', 'high-performance': 'jet',
  light: 'propeller', turboprop: 'turboprop',
  helicopter: undefined, glider: undefined, balloon: undefined, skydiver: undefined,
  ground: undefined, unknown: undefined, ultralight: undefined, uav: undefined,
};

function engineOrigins(count: number, shape: VectorAircraftShapeName): [number, number][] {
  if (count === 1) return [[20, shape === 'high-performance' ? 37 : 34]];
  if (count === 2) {
    if (shape === 'small') return [[15.5, 32], [24.5, 32]];
    if (shape === 'high-performance') return [[18, 36], [22, 36]];
    return [[11.5, shape === 'turboprop' ? 24 : 27], [28.5, shape === 'turboprop' ? 24 : 27]];
  }
  if (count === 3) return [...engineOrigins(2, shape), [20, 36]];
  if (count === 4) return [[7.5, 29], [13.5, 26], [26.5, 26], [32.5, 29]];
  if (count === 5) return [...engineOrigins(4, shape), [20, 36]];
  return [[6, 30], [10, 28], [14, 26], [26, 26], [30, 28], [34, 30]];
}

export function aircraftWake(aircraft: Aircraft, shape: VectorAircraftShapeName): AircraftWake | undefined {
  if (!aircraftIconMotionActive(aircraft) || !Number.isFinite(aircraft.trackDeg) || aircraft.groundSpeedKts! < 30) return;
  const kind = aircraftKind(aircraft);
  // Includes powered gliders: a motor's presence does not tell us it is running.
  if (['glider', 'balloon', 'helicopter', 'skydiver', 'ground', 'unknown'].includes(kind)) return;
  const engine = /^([LA])([1-6])([JPTE])$/.exec(aircraft.description?.trim().toUpperCase() ?? '');
  const style = engine
    ? engine[3] === 'J' ? 'jet' : engine[3] === 'T' ? 'turboprop' : 'propeller'
    : familyStyles[kind];
  if (!style) return;
  // Without engine metadata the family silhouette provides the visual fallback,
  // not a claim about the real aircraft's exact engine count or placement.
  const count = engine ? Number(engine[2]) : shape === 'heavy-four' ? 4
    : kind === 'light' || kind === 'high-performance' ? 1 : 2;
  const speed = Math.min(1, aircraft.groundSpeedKts! / (style === 'jet' ? 500 : style === 'turboprop' ? 300 : 180));
  const baseLength = style === 'jet' ? 10 + 28 * speed : style === 'turboprop' ? 7 + 17 * speed : 5 + 11 * speed;
  return {
    style, origins: engineOrigins(count, shape),
    length: Math.round(baseLength * wakeLengthScale * 10) / 10,
    // The 40-unit icon renders 32.4 CSS px wide: at least two screen pixels
    // avoid one engine's line landing on a pixel while its twin straddles two.
    // Low stroke opacity keeps the broader coverage optically light.
    width: style === 'jet' ? 2.5 : style === 'turboprop' ? 2.7 : 2.9,
    duration: Math.round((2.4 - speed) * 100) / 100,
  };
}
