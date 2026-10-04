import type { Aircraft, AircraftKind } from '../domain/aircraft.ts';
import { aircraftKind } from '../domain/aircraft-kind.ts';
import rawCatalog from './tar1090-icons.json' with { type: 'json' };

export type ShapePath = string | string[];
type AircraftShape = {
  accent?: ShapePath;
  accentMult?: number;
  h: number;
  noAspect?: boolean;
  path?: ShapePath;
  strokeScale?: number;
  transform?: string;
  viewBox: string;
  w: number;
};
type ShapeReference = [name: string, scale: number];
type IconCatalog = {
  categories: Record<string, ShapeReference>;
  shapes: Record<string, AircraftShape>;
  typeDescriptions: Record<string, ShapeReference>;
  typeDesignators: Record<string, ShapeReference>;
};

export type AircraftIconDefinition = {
  name: string;
  scale: number;
  shape: AircraftShape;
  upright?: boolean;
};

const catalog = rawCatalog as unknown as IconCatalog;
const kindFallback: Record<AircraftKind, ShapeReference> = {
  airliner: ['airliner', 0.96],
  balloon: ['balloon', 1],
  glider: ['glider', 1],
  ground: ['ground_unknown', 0.82],
  heavy: ['heavy_2e', 0.94],
  helicopter: ['helicopter', 1],
  'high-performance': ['hi_perf', 0.94],
  light: ['cessna', 1],
  skydiver: ['para', 1],
  small: ['jet_swept', 0.94],
  turboprop: ['single_turbo', 1],
  uav: ['uav', 1],
  ultralight: ['cessna', 0.92],
  unknown: ['unknown', 1],
};

// Vector's neutral contact symbol: a small filled circle, with no implied aircraft type.
// Keep it separate from the generated tar1090 catalog so syncing icons cannot replace it.
const unknownContact: AircraftIconDefinition = {
  name: 'unknown-contact-dot',
  scale: 1,
  upright: true,
  shape: {
    w: 24,
    h: 24,
    viewBox: '0 0 24 24',
    strokeScale: 0.8,
    path: 'M17 12a5 5 0 1 1-10 0a5 5 0 1 1 10 0Z',
  },
};

export function aircraftIconDefinition(aircraft: Aircraft): AircraftIconDefinition {
  const type = aircraft.aircraftType?.trim().toUpperCase() ?? '';
  const description = aircraft.description?.trim().toUpperCase() ?? '';
  const category = aircraft.category?.trim().toUpperCase() ?? '';
  const reference = catalog.typeDesignators[type]
    ?? catalog.typeDescriptions[description]
    ?? catalog.typeDescriptions[description.slice(0, 1)]
    ?? catalog.categories[category]
    ?? kindFallback[aircraftKind(aircraft)];
  const [name, scale] = reference;
  const shape = catalog.shapes[name];

  if (name === 'unknown' || !shape?.path) return unknownContact;
  return { name, scale, shape };
}

export const aircraftIconTransform = (definition: AircraftIconDefinition, rotation: number) =>
  `rotate(${definition.upright ? 0 : rotation}deg) scale(${definition.scale})`;
