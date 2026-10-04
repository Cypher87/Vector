import type { CSSProperties } from 'react';
import type { Aircraft } from '../domain/aircraft';
import { aircraftIconDefinition, aircraftIconTransform, type AircraftIconDefinition, type ShapePath } from './aircraft-icon-definition';

const svgNamespace = 'http://www.w3.org/2000/svg';

const paths = (value?: ShapePath) => value ? Array.isArray(value) ? value : [value] : [];

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
  icon.style.transform = aircraftIconTransform(definition, rotation);
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
      data-shape={definition.name}
      preserveAspectRatio={shape.noAspect ? 'none' : 'xMidYMid meet'}
      style={{ ...style, transform: aircraftIconTransform(definition, rotation) }}
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
