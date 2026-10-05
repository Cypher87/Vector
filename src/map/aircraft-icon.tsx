import type { CSSProperties } from 'react';
import type { Aircraft } from '../domain/aircraft';
import { aircraftIconDefinition, aircraftIconPartProjection, aircraftIconTransform, type AircraftIconDefinition, type ShapePath } from './aircraft-icon-definition';
import { aircraftIconMotionPhase } from './icon-animation';
import { updateAircraftWakeElement } from './aircraft-wake-element';

const svgNamespace = 'http://www.w3.org/2000/svg';

const paths = (value?: ShapePath) => value ? Array.isArray(value) ? value : [value] : [];

function renderPaths(parent: SVGElement, definition: AircraftIconDefinition) {
  const { shape } = definition;
  const group = document.createElementNS(svgNamespace, 'g');
  group.setAttribute('class', 'aircraft-icon-body');
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
  shape.movingParts?.forEach((part) => {
    const plane = document.createElementNS(svgNamespace, 'g');
    plane.setAttribute('class', `aircraft-icon-${part.kind}-plane`);
    const projection = aircraftIconPartProjection(part);
    if (projection) plane.setAttribute('transform', projection);
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('class', `aircraft-icon-moving-part aircraft-icon-${part.kind}`);
    path.setAttribute('d', part.path);
    path.setAttribute('paint-order', 'stroke');
    path.style.transformOrigin = `${part.origin[0]}px ${part.origin[1]}px`;
    plane.appendChild(path);
    group.appendChild(plane);
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
    icon.style.setProperty('--icon-motion-phase', aircraftIconMotionPhase(aircraft.id));
  }
  icon.style.transform = aircraftIconTransform(definition, rotation);
  updateAircraftWakeElement(icon, aircraft, definition);
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
      <g className="aircraft-icon-body" transform={shape.transform}>
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
        {shape.movingParts?.map((part, index) => (
          <g className={`aircraft-icon-${part.kind}-plane`} key={`moving-${index}`} transform={aircraftIconPartProjection(part)}>
            <path
              className={`aircraft-icon-moving-part aircraft-icon-${part.kind}`}
              d={part.path}
              paintOrder="stroke"
              style={{ transformOrigin: `${part.origin[0]}px ${part.origin[1]}px` }}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
