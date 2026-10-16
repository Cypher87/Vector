import { Marker, type Map as MapLibre } from 'maplibre-gl';
import { createVectorIconElement } from '../components/vector-icon';
import { relocateCircleDrawing, type AreaDrawing } from '../domain/map-area';
import { translate, type Language } from '../i18n';

/** Native marker dragging handles mouse and touch without moving the camera. */
export function createAreaCenterHandle(map: MapLibre, onPreview: (drawing: AreaDrawing) => void, onChange: (drawing: AreaDrawing) => void) {
  let drawing: AreaDrawing | undefined;
  let marker: Marker | undefined;
  let dragging = false;
  let lastDrag = -Infinity;
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'map-area-center-handle';
  element.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
  element.appendChild(createVectorIconElement('center'));
  element.addEventListener('click', (event) => event.stopPropagation());
  const move = () => {
    if (!marker || !drawing) return;
    const point = marker.getLngLat().wrap();
    drawing = relocateCircleDrawing(drawing, [point.lng, point.lat]);
    marker.setLngLat(drawing.points[0]);
    onPreview(drawing);
  };
  element.addEventListener('keydown', (event) => {
    const deltas: Readonly<Record<string, readonly [number, number]>> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const delta = deltas[event.key];
    if (!delta || !marker || !drawing || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault(); event.stopPropagation();
    const position = map.project(marker.getLngLat()), step = event.shiftKey ? 10 : 1;
    marker.setLngLat(map.unproject([position.x + delta[0] * step, position.y + delta[1] * step]));
    move();
    onChange(drawing);
  });
  return {
    update(next: AreaDrawing | undefined, language: Language) {
      if (!next || next.kind !== 'circle' || !next.points.length) {
        marker?.remove(); marker = undefined; drawing = undefined; dragging = false;
        element.classList.remove('dragging');
        return;
      }
      element.title = translate(language, 'areaMoveCenter');
      element.setAttribute('aria-label', element.title);
      element.setAttribute('aria-description', translate(language, 'areaMoveCenterKeys'));
      if (dragging) return;
      drawing = next;
      if (!marker) {
        marker = new Marker({ element, draggable: true, anchor: 'center', subpixelPositioning: true });
        marker.on('dragstart', () => { dragging = true; element.classList.add('dragging'); });
        marker.on('drag', move);
        marker.on('dragend', () => {
          dragging = false; lastDrag = performance.now(); element.classList.remove('dragging');
          if (drawing) onChange(drawing);
        });
        marker.setLngLat(next.points[0]).addTo(map);
      } else marker.setLngLat(next.points[0]);
    },
    // MapLibre suppresses marker clicks during a drag; the resulting canvas click
    // must not become a new radius point when the pointer is released.
    suppressMapClick() { return dragging || performance.now() - lastDrag < 250; },
    dispose() { marker?.remove(); marker = undefined; drawing = undefined; },
  };
}
