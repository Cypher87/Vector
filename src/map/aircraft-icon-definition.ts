import type { Aircraft } from '../domain/aircraft.ts';
import { aircraftKind } from '../domain/aircraft-kind.ts';
import { vectorAircraftShapes, type VectorAircraftShapeName } from './vector-aircraft-shapes.ts';

export type ShapePath = string | string[];
export type AircraftIconPart = {
  kind: 'rotor' | 'propeller';
  path: string;
  origin: [number, number];
};

/** Compress a propeller's spinning disk along the fuselage, keeping its hub fixed. */
export const aircraftIconPartProjection = (part: AircraftIconPart) => part.kind === 'propeller'
  ? `translate(${part.origin[0]} ${part.origin[1]}) scale(1 .32) translate(${-part.origin[0]} ${-part.origin[1]})`
  : undefined;

export type AircraftShape = {
  accent?: ShapePath;
  accentMult?: number;
  h: number;
  noAspect?: boolean;
  path: ShapePath;
  movingParts?: AircraftIconPart[];
  strokeScale?: number;
  transform?: string;
  viewBox: string;
  w: number;
};

export type AircraftIconDefinition = {
  name: VectorAircraftShapeName;
  scale: number;
  shape: AircraftShape;
  upright?: boolean;
};

/** Original Vector silhouettes; classification is shared with filters and labels. */
export function aircraftIconDefinition(aircraft: Aircraft): AircraftIconDefinition {
  const kind = aircraftKind(aircraft);
  const type = aircraft.aircraftType?.trim().toUpperCase() ?? '';
  const description = aircraft.description?.trim().toUpperCase() ?? '';
  let name: VectorAircraftShapeName = kind === 'unknown' ? 'unknown-contact-dot' : kind;
  if (kind === 'balloon' && (type === 'SHIP' || description.includes('AIRSHIP'))) name = 'airship';
  else if (kind === 'helicopter' && /^G[1-9][PTJ]$/.test(description)) name = 'gyrocopter';
  else if (kind === 'heavy' && (/^(A34|A38|B74|C5|AN12|A124|A225)/.test(type) || /^[LA]4[JT]$/.test(description))) name = 'heavy-four';
  return { name, scale: 1, shape: vectorAircraftShapes[name], upright: kind === 'balloon' || kind === 'unknown' };
}

export const aircraftIconTransform = (definition: AircraftIconDefinition, rotation: number) =>
  `rotate(${definition.upright ? 0 : rotation}deg) scale(${definition.scale})`;
