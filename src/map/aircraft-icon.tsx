import type { CSSProperties } from 'react';
import type { Aircraft, AircraftKind } from '../domain/aircraft';
import { aircraftKind } from '../domain/aircraft-kind';
import rawCatalog from './tar1090-icons.json';

type ShapePath = string | string[];
type Tar1090Shape = {
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
  shapes: Record<string, Tar1090Shape>;
  typeDescriptions: Record<string, ShapeReference>;
  typeDesignators: Record<string, ShapeReference>;
};
type AircraftIconDefinition = {
  name: string;
  scale: number;
  shape: Tar1090Shape;
};

const catalog = rawCatalog as unknown as IconCatalog;
const svgNamespace = 'http://www.w3.org/2000/svg';
const kindFallback: Record<AircraftKind, ShapeReference> = {
  airliner: ['airliner', 0.96],
  balloon: ['balloon', 1],
  glider: ['glider', 1],
  ground: ['unknown', 0.82],
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

const paths = (value?: ShapePath) => value ? Array.isArray(value) ? value : [value] : [];

export function aircraftIconDefinition(aircraft: Aircraft): AircraftIconDefinition {
  const type = aircraft.aircraftType?.toUpperCase() ?? '';
  const description = aircraft.description?.toUpperCase() ?? '';
  const category = aircraft.category?.toUpperCase() ?? '';
  const reference = catalog.typeDesignators[type]
    ?? catalog.typeDescriptions[description]
    ?? catalog.typeDescriptions[description.slice(0, 1)]
    ?? catalog.categories[category]
    ?? kindFallback[aircraftKind(aircraft)];
  const [name, scale] = reference;
  const shape = catalog.shapes[name];

  if (shape?.path) return { name, scale, shape };
  return { name: 'unknown', scale: 1, shape: catalog.shapes.unknown };
}

function renderPaths(parent: SVGElement, definition: AircraftIconDefinition) {
  const { shape } = definition;
  const group = document.createElementNS(svgNamespace, 'g');
  if (shape.transform) group.setAttribute('transform', shape.transform);

  paths(shape.path).forEach((pathData) => {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('class', 'aircraft-icon-main');
    path.setAttribute('d', pathData);
    path.setAttribute('paint-order', 'stroke');
    path.setAttribute('stroke-width', String(1.1 * (shape.strokeScale ?? 1)));
    group.appendChild(path);
  });
  paths(shape.accent).forEach((pathData) => {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('class', 'aircraft-icon-accent');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke-width', String(0.42 * (shape.accentMult ?? 1) * (shape.strokeScale ?? 1)));
    group.appendChild(path);
  });
  parent.appendChild(group);
}

export function createAircraftIconElement() {
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('class', 'aircraft-icon-svg map-aircraft-icon');
  return icon;
}

export function updateAircraftIconElement(icon: SVGSVGElement, aircraft: Aircraft, rotation: number) {
  const definition = aircraftIconDefinition(aircraft);
  if (icon.dataset.shape !== definition.name) {
    icon.replaceChildren();
    icon.dataset.shape = definition.name;
    icon.setAttribute('viewBox', definition.shape.viewBox);
    icon.setAttribute('preserveAspectRatio', definition.shape.noAspect ? 'none' : 'xMidYMid meet');
    renderPaths(icon, definition);
  }
  icon.style.transform = `rotate(${rotation}deg) scale(${definition.scale})`;
}

type AircraftIconProps = {
  aircraft: Aircraft;
  className?: string;
  rotation?: number;
  style?: CSSProperties;
};

export function AircraftIcon({ aircraft, className = '', rotation = 0, style }: AircraftIconProps) {
  const definition = aircraftIconDefinition(aircraft);
  const shape = definition.shape;
  return (
    <svg
      aria-hidden="true"
      className={`aircraft-icon-svg ${className}`}
      preserveAspectRatio={shape.noAspect ? 'none' : 'xMidYMid meet'}
      style={{ ...style, transform: `rotate(${rotation}deg) scale(${definition.scale})` }}
      viewBox={shape.viewBox}
    >
      <g transform={shape.transform}>
        {paths(shape.path).map((pathData, index) => (
          <path
            className="aircraft-icon-main"
            d={pathData}
            key={`main-${index}`}
            paintOrder="stroke"
            strokeWidth={1.1 * (shape.strokeScale ?? 1)}
          />
        ))}
        {paths(shape.accent).map((pathData, index) => (
          <path
            className="aircraft-icon-accent"
            d={pathData}
            key={`accent-${index}`}
            strokeWidth={0.42 * (shape.accentMult ?? 1) * (shape.strokeScale ?? 1)}
          />
        ))}
      </g>
    </svg>
  );
}
