import type { ExpressionSpecification, GeoJSONSource, Map as MapLibre } from 'maplibre-gl';
import { coarsenHeatmap, heatmapCell, type HeatmapData } from '../domain/heatmap.ts';
import type { Theme } from '../theme';

const sourceId = 'vector-traffic-density', layerId = 'vector-traffic-heatmap';
export function heatmapKernelScale(gridZoom: number, zoom: number) {
  const spacing = 512 * 2 ** (zoom - gridZoom);
  const radius = Math.min(768, Math.max(8 + zoom * .8, spacing * 1.5));
  // Normalize kernel area against cell area: overview maps must not saturate,
  // and coarse multi-day data must blend rather than reveal a grid of dots.
  return { radius, intensity: Math.max(.001, Math.min(4, 3 * (spacing / radius) ** 2)) };
}
function kernelExpression(gridZoom: number, property: 'radius' | 'intensity'): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], ...Array.from({ length: 23 }, (_, zoom) =>
    [zoom, heatmapKernelScale(gridZoom, zoom)[property]]).flat()] as ExpressionSpecification;
}
/** Calibrate the *blended density*, not just each point's count, within this period.
 * Calculated once per dataset; zoom interpolation remains entirely on the GPU. */
export function heatmapDensityProfile(data: HeatmapData) {
  const sorted = data.points.map((point) => point[2]).sort((a, b) => a - b);
  const countScale = sorted[Math.floor(sorted.length * .95)] ?? 1;
  const weights = data.points.map((point) => Math.min(2, point[2] / countScale));
  const levels = new Map<number, Map<number, number>>();
  const original = new Map<number, number>();
  data.points.forEach(([lon, lat], index) => {
    const cell = heatmapCell(lon, lat, data.gridZoom);
    original.set(cell, (original.get(cell) ?? 0) + weights[index]);
  });
  levels.set(data.gridZoom, original);
  const cellsAt = (level: number): Map<number, number> => {
    if (!levels.has(level)) levels.set(level, coarsenHeatmap(cellsAt(level + 1), level + 1));
    return levels.get(level)!;
  };
  const calibrated = new Map<string, number>();
  const samples = new Map<number, number[]>();
  const intensities = Array.from({ length: 23 }, (_, zoom) => {
    if (!data.points.length) return heatmapKernelScale(data.gridZoom, zoom).intensity;
    const { radius } = heatmapKernelScale(data.gridZoom, zoom);
    // At most six cells per kernel radius, even for a fine one-hour recording.
    const level = Math.max(0, Math.min(data.gridZoom, Math.ceil(zoom + Math.log2(1536 / radius))));
    const size = 2 ** level, spread = radius / (512 * 2 ** (zoom - level));
    const key = `${level}:${spread}`;
    const previous = calibrated.get(key);
    if (previous !== undefined) return previous;
    const cells = cellsAt(level), extent = Math.ceil(spread);
    if (!samples.has(level)) {
      const ordered = [...cells.keys()].sort((a, b) => a - b);
      // Only the palette reference is sampled, never the rendered observations.
      // Spatial stratification avoids recording-order bias and bounds UI work.
      samples.set(level, ordered.length <= 1024 ? ordered : Array.from({ length: 1024 }, (_, index) => ordered[Math.floor(index * ordered.length / 1024)]));
    }
    const offsets: [number, number, number][] = [];
    for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
      const weight = Math.exp(-4.5 * (x * x + y * y) / (spread * spread));
      if (weight >= .0001) offsets.push([x, y, weight]);
    }
    const densities: number[] = [];
    for (const cell of samples.get(level)!) {
      const x = cell % size, y = Math.floor(cell / size);
      let density = 0;
      for (const [dx, dy, weight] of offsets) {
        if (x + dx >= 0 && x + dx < size && y + dy >= 0 && y + dy < size)
          density += (cells.get((y + dy) * size + x + dx) ?? 0) * weight;
      }
      densities.push(density);
    }
    densities.sort((a, b) => a - b);
    // Same Gaussian coefficient as MapLibre; reserve deep red for the busiest
    // locations, ignoring isolated extremes when calibrating the color range.
    const reference = densities[Math.floor(densities.length * .95)] ?? 1;
    const intensity = Math.max(.001, Math.min(8, .85 / (.3989422804014327 * reference)));
    calibrated.set(key, intensity);
    return intensity;
  });
  return { weights, intensity: ['interpolate', ['linear'], ['zoom'], ...intensities.flatMap((value, zoom) => [zoom, value])] as ExpressionSpecification };
}
/** Render density on the GPU, never thousands of DOM markers or zoom-time React updates. */
export function createTrafficHeatmap(map: MapLibre, onState: (state: 'loading' | 'ready' | 'error') => void = () => {}) {
  let previous: HeatmapData | undefined;
  let attached = false;
  let revision = 0;
  return {
    update(data: HeatmapData | undefined, visible: boolean, theme: Theme) {
      if (!map.getStyle()) return;
      if (!attached && !visible) return;
      if (!attached) {
        map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: layerId, type: 'heatmap', source: sourceId, paint: {
          'heatmap-weight': ['get', 'weight'], 'heatmap-intensity': kernelExpression(16, 'intensity'),
          'heatmap-radius': kernelExpression(16, 'radius'),
          'heatmap-opacity': .65,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(77,142,140,0)', .15, '#4d8e8c', .4, '#c6ad6c', .65, '#db984d', 1, '#bd583b'],
        } });
        attached = true;
      }
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      map.setPaintProperty(layerId, 'heatmap-opacity', theme === 'dark' ? .65 : .6);
      if (data === previous) return;
      previous = data;
      const profile = data ? heatmapDensityProfile(data) : undefined;
      map.setPaintProperty(layerId, 'heatmap-radius', kernelExpression(data?.gridZoom ?? 16, 'radius'));
      map.setPaintProperty(layerId, 'heatmap-intensity', profile?.intensity ?? kernelExpression(16, 'intensity'));
      const request = ++revision;
      onState('loading');
      const update = (map.getSource(sourceId) as GeoJSONSource).setData({ type: 'FeatureCollection', features: (data?.points ?? []).map(([lon, lat], index) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { weight: profile!.weights[index] },
      })) });
      void Promise.resolve(update).then(() => {
        if (request !== revision) return;
        map.once('render', () => { if (request === revision) onState('ready'); });
        map.triggerRepaint();
      }).catch(() => { if (request === revision) onState('error'); });
    },
    dispose() { revision++; if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId); },
  };
}
