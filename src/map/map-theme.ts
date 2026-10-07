import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Theme } from '../theme.ts';

export type MapThemePaint = {
  'raster-brightness-max': number;
  'raster-brightness-min': number;
  'raster-contrast': number;
  'raster-opacity': number;
  'raster-saturation': number;
};

const paints: Record<Theme, MapThemePaint> = {
  dark: {
    'raster-opacity': 1,
    'raster-saturation': -0.92,
    'raster-contrast': 0,
    // MapLibre interpolates between these endpoints. Reverse them so light land
    // becomes dark and dark street labels remain legible, using the same tiles.
    'raster-brightness-min': 0.62,
    'raster-brightness-max': 0.07,
  },
  light: {
    'raster-opacity': 1,
    'raster-saturation': -0.58,
    'raster-contrast': -0.04,
    'raster-brightness-min': 0.06,
    'raster-brightness-max': 0.98,
  },
};

export const mapThemePaint = (theme: Theme): Readonly<MapThemePaint> => paints[theme];

export function openStreetMapRasterLayerId(style: unknown): string | undefined {
  if (typeof style !== 'object' || style === null || !('layers' in style) || !Array.isArray(style.layers)) {
    return undefined;
  }

  const layer = style.layers.find((candidate) => (
    typeof candidate === 'object'
    && candidate !== null
    && 'type' in candidate
    && candidate.type === 'raster'
    && 'id' in candidate
    && candidate.id === 'openstreetmap'
  ));
  return layer && 'id' in layer && typeof layer.id === 'string' ? layer.id : undefined;
}

/** Change the existing layer in place, keeping tiles, overlays and camera position. */
export function applyMapTheme(map: Pick<MapLibreMap, 'getStyle' | 'setPaintProperty'>, theme: Theme) {
  const style = map.getStyle();
  const rasterLayerId = openStreetMapRasterLayerId(style);
  if (!rasterLayerId) return;
  const paint = mapThemePaint(theme);
  for (const property of Object.keys(paint) as (keyof MapThemePaint)[]) {
    // Avoid a washed-out grey midpoint when swapping the brightness endpoints.
    map.setPaintProperty(rasterLayerId, `${property}-transition`, { duration: 0, delay: 0 });
    map.setPaintProperty(rasterLayerId, property, paint[property]);
  }
  if (style?.layers?.some((layer) => layer.id === 'background' && layer.type === 'background')) {
    map.setPaintProperty('background', 'background-color', theme === 'dark' ? '#202321' : '#dddeda');
  }
}
