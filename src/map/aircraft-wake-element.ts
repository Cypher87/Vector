import type { Aircraft, AircraftTracePoint } from '../domain/aircraft.ts';
import type { AircraftIconDefinition } from './aircraft-icon-definition.ts';
import { aircraftWake, type AircraftWake } from './aircraft-wake.ts';
import { aircraftWakeRoute, aircraftWakeLane, aircraftWakeOrigins, type WakePoint } from './aircraft-wake-route.ts';
import type { AircraftPosition } from './aircraft-motion.ts';

const namespace = 'http://www.w3.org/2000/svg';
type WakeElement = {
  aircraft: Aircraft;
  shape: string;
  key?: string;
  group?: SVGGElement;
  gradients?: SVGLinearGradientElement[];
  wake?: AircraftWake;
  paths?: SVGPathElement[][];
};
const elements = new WeakMap<SVGSVGElement, WakeElement>();
let nextGradient = 0;

/** Only live map icons call this; React list/detail icons and shadows stay clean. */
export function updateAircraftWakeElement(icon: SVGSVGElement, aircraft: Aircraft, definition: AircraftIconDefinition) {
  if (icon.classList.contains('aircraft-altitude-shadow-icon')) return;
  const previous = elements.get(icon);
  if (previous?.aircraft === aircraft && previous.shape === definition.name
    && (!previous.group || previous.group.parentNode === icon)) return;

  const wake = aircraftWake(aircraft, definition.name);
  const key = wake ? `${wake.style}:${JSON.stringify(wake.origins)}` : undefined;
  let state: WakeElement = { ...previous, aircraft, shape: definition.name };
  if (previous?.key !== key || previous?.group?.parentNode !== icon) {
    // Also discard a group left behind by a development hot reload.
    icon.querySelector('.aircraft-speed-wake')?.remove();
    state = { aircraft, shape: definition.name, key };
    if (wake) {
      const group = document.createElementNS(namespace, 'g');
      group.classList.add('aircraft-speed-wake');
      group.dataset.wake = wake.style;
      group.dataset.engines = String(wake.origins.length);
      const defs = document.createElementNS(namespace, 'defs');
      const gradients: SVGLinearGradientElement[] = [];
      const createGradient = () => {
        const gradient = document.createElementNS(namespace, 'linearGradient');
        const gradientId = `vector-speed-wake-${aircraft.id.replace(/[^a-z0-9-]/gi, '')}-${++nextGradient}`;
        gradient.id = gradientId;
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        gradient.setAttribute('x1', '0');
        gradient.setAttribute('x2', '0');
        gradient.setAttribute('y1', '0');
        // Soft, wider coverage avoids uneven subpixel lines without a dark core.
        for (const [offset, opacity] of [
          ['0%', '.42'], ['45%', 'var(--aircraft-wake-middle-opacity, .28)'],
          ['75%', 'var(--aircraft-wake-tail-opacity, .12)'], ['100%', '0'],
        ]) {
          const stop = document.createElementNS(namespace, 'stop');
          stop.setAttribute('offset', offset);
          stop.setAttribute('stop-color', 'var(--aircraft-wake-color)');
          stop.setAttribute('stop-opacity', opacity);
          gradient.appendChild(stop);
        }
        defs.appendChild(gradient);
        gradients.push(gradient);
        return gradientId;
      };
      group.appendChild(defs);
      const paths = wake.origins.map(([x, y]) => {
        const gradientId = createGradient();
        const lane = document.createElementNS(namespace, 'g');
        lane.setAttribute('transform', `translate(${x} ${y})`);
        const strokes = ['aircraft-speed-wake-base', 'aircraft-speed-wake-flow'].map((className) => {
          const path = document.createElementNS(namespace, 'path');
          path.classList.add(className);
          path.setAttribute('stroke', `url(#${gradientId})`);
          lane.appendChild(path);
          return path;
        });
        group.appendChild(lane);
        return strokes;
      });
      // Behind the silhouette; does not alter icon size, anchor or hit target.
      icon.prepend(group);
      Object.assign(state, { group, gradients, paths });
    }
  }
  state.wake = wake;
  if (wake && state.group) {
    state.group.style.setProperty('--wake-duration', `${wake.duration}s`);
    state.group.dataset.length = String(wake.length);
    state.group.setAttribute('stroke-width', String(wake.width));
  }
  elements.set(icon, state);
}

/** Called for feed changes and map/marker motion; the older points stay geographic. */
export function updateAircraftWakeRouteElement(
  icon: SVGSVGElement, trace: readonly AircraftTracePoint[], timestamp: number,
  position: AircraftPosition, project: (position: AircraftPosition) => WakePoint, rotation: number, lengthScale: number, iconScale = 1,
) {
  const state = elements.get(icon);
  if (!state?.wake || !state.group) return;
  const wake = { ...state.wake, length: state.wake.length * lengthScale, origins: aircraftWakeOrigins(state.wake, iconScale) };
  const renderLength = wake.length.toFixed(2);
  if (state.group.dataset.renderLength !== renderLength) state.group.dataset.renderLength = renderLength;
  const route = aircraftWakeRoute(trace, timestamp, position, project, rotation, wake.length + 20 * iconScale);
  let drawn = false;
  state.paths?.forEach((paths, index) => {
    const [x, y] = wake.origins[index];
    const transform = `translate(${x} ${y})`;
    const group = paths[0].parentElement!;
    if (group.getAttribute('transform') !== transform) group.setAttribute('transform', transform);
    const lane = aircraftWakeLane(wake, index, route);
    for (const path of paths) {
      if (path.getAttribute('d') !== lane.path) path.setAttribute('d', lane.path);
    }
    const gradient = state.gradients![index];
    for (const [attribute, value] of [['x2', lane.end.x], ['y2', lane.end.y]] as const) {
      const next = value.toFixed(2);
      if (gradient.getAttribute(attribute) !== next) gradient.setAttribute(attribute, next);
    }
    drawn ||= lane.length > 0;
  });
  const status = drawn ? 'measured' : 'pending';
  if (state.group.dataset.route !== status) state.group.dataset.route = status;
}

/** On busy maps, one shared canvas replaces hundreds of repainting SVGs.
 * Use the same measured route, engine offsets, gradients and CSS-pixel widths.
 * Only the faint dash animation rests while the camera is moving.
 */
export function drawAircraftWakeRoute(
  context: CanvasRenderingContext2D, icon: SVGSVGElement, trace: readonly AircraftTracePoint[], timestamp: number,
  position: AircraftPosition, project: (position: AircraftPosition) => WakePoint, rotation: number,
  appearance: { lengthScale: number; middleOpacity: number; tailOpacity: number; opacity: number; color: string; flowTime: number }, iconScale: number,
) {
  const state = elements.get(icon);
  if (!state?.wake) return false;
  const wake = { ...state.wake, length: state.wake.length * appearance.lengthScale, origins: aircraftWakeOrigins(state.wake, iconScale) };
  const route = aircraftWakeRoute(trace, timestamp, position, project, rotation, wake.length + 20 * iconScale);
  const origin = project(position);
  context.save();
  context.translate(origin.x, origin.y);
  context.rotate(rotation * Math.PI / 180);
  context.scale(32.4 / 40, 32.4 / 40);
  context.lineWidth = wake.width;
  context.lineCap = 'round';
  let drawn = false;
  wake.origins.forEach(([x, y], index) => {
    const lane = aircraftWakeLane(wake, index, route);
    if (!lane.length) return;
    drawn = true;
    context.save();
    context.translate(x - 20, y - 20);
    const gradient = context.createLinearGradient(0, 0, lane.end.x, lane.end.y);
    for (const [stop, alpha] of [[0, .42], [.45, appearance.middleOpacity], [.75, appearance.tailOpacity], [1, 0]]) {
      gradient.addColorStop(stop, `rgba(${appearance.color}, ${alpha})`);
    }
    context.strokeStyle = gradient;
    const path = new Path2D(lane.path);
    context.globalAlpha = appearance.opacity * .45;
    context.stroke(path);
    context.globalAlpha = appearance.opacity * .08;
    context.setLineDash([3, 8]);
    context.lineDashOffset = -22 * (appearance.flowTime / 1_000 / wake.duration % 1);
    context.stroke(path);
    context.restore();
  });
  context.restore();
  if (state.group) {
    const status = drawn ? 'measured' : 'pending';
    if (state.group.dataset.route !== status) state.group.dataset.route = status;
  }
  return drawn;
}
