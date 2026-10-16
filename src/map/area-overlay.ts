import type { Map as MapLibre, MapMouseEvent } from 'maplibre-gl';
import { areaOutline, drawingMapArea, unwrapAreaLongitude, type AreaDrawing, type MapArea } from '../domain/map-area';

export type AreaOverlayItem = { id: string; name: string; area: MapArea; active: boolean };
const svgNamespace = 'http://www.w3.org/2000/svg';

/** Project a small static overlay on camera changes; never rerender aircraft to draw an area. */
export function createAreaOverlay(map: MapLibre) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.classList.add('map-areas-overlay');
  svg.setAttribute('aria-hidden', 'true');
  map.getCanvasContainer().appendChild(svg);
  let items: AreaOverlayItem[] = [];
  let drawing: AreaDrawing | undefined;
  let hover: [number, number] | undefined;
  let frame: number | undefined;
  const project = (coordinates: [number, number][]) => {
    const reference = coordinates[0]?.[0] ?? 0;
    const shift = unwrapAreaLongitude(reference, map.getCenter().lng) - reference;
    return coordinates.map(([lon, lat]) => map.project([unwrapAreaLongitude(lon, reference) + shift, lat]));
  };
  const render = () => {
    frame = undefined;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${map.getCanvas().clientWidth} ${map.getCanvas().clientHeight}`);
    for (const item of items) {
      if (drawing && item.active) continue;
      const points = project(areaOutline(item.area));
      const path = document.createElementNS(svgNamespace, 'polygon');
      path.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
      path.classList.add('map-area-shape');
      path.classList.toggle('active', item.active);
      path.dataset.areaId = item.id;
      svg.appendChild(path);
      const top = points.reduce((a, b) => a.y < b.y ? a : b);
      const label = document.createElementNS(svgNamespace, 'text');
      label.setAttribute('x', String(top.x)); label.setAttribute('y', String(top.y - 7));
      label.setAttribute('text-anchor', 'middle'); label.classList.add('map-area-label');
      label.textContent = item.name;
      svg.appendChild(label);
    }
    if (drawing) {
      const preview = hover && (drawing.kind === 'polygon' || drawing.points.length === 1 && drawing.radiusKm === undefined)
        ? { ...drawing, points: [...drawing.points, hover] } : drawing;
      const area = drawingMapArea(preview);
      const coordinates = area ? areaOutline(area) : [...drawing.points, ...(hover ? [hover] : [])];
      const points = project(coordinates);
      const path = document.createElementNS(svgNamespace, area ? 'polygon' : 'polyline');
      path.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
      path.classList.add('map-area-draft');
      svg.appendChild(path);
      for (const point of project(drawing.kind === 'circle' ? drawing.points.slice(1) : drawing.points)) {
        const vertex = document.createElementNS(svgNamespace, 'circle');
        vertex.setAttribute('cx', String(point.x)); vertex.setAttribute('cy', String(point.y));
        vertex.setAttribute('r', '4'); vertex.classList.add('map-area-vertex'); svg.appendChild(vertex);
      }
    }
  };
  const schedule = () => { if (items.length || drawing) frame ??= requestAnimationFrame(render); };
  const previewAt = (event: MapMouseEvent) => {
    if (!drawing) return;
    hover = [event.lngLat.wrap().lng, event.lngLat.lat]; schedule();
  };
  map.on('move', schedule); map.on('resize', schedule); map.on('mousemove', previewAt);
  return {
    update(next: AreaOverlayItem[], draft?: AreaDrawing) {
      items = next; drawing = draft; hover = undefined;
      if (!items.length && !drawing) svg.replaceChildren();
      else schedule();
    },
    dispose() {
      map.off('move', schedule); map.off('resize', schedule); map.off('mousemove', previewAt);
      if (frame !== undefined) cancelAnimationFrame(frame);
      svg.remove();
    },
  };
}
