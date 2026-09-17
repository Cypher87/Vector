export const mapThemes = ['vector', 'standard', 'light', 'dark', 'contrast'] as const;

export type MapTheme = (typeof mapThemes)[number];

export const defaultMapTheme: MapTheme = 'vector';

export type MapThemePaint = {
  'raster-brightness-max': number;
  'raster-brightness-min': number;
  'raster-contrast': number;
  'raster-opacity': number;
  'raster-saturation': number;
};

const mapThemePaintValues: Record<MapTheme, MapThemePaint> = {
  vector: {
    'raster-opacity': 0.82,
    'raster-saturation': -0.78,
    'raster-contrast': 0.18,
    'raster-brightness-min': 0.08,
    'raster-brightness-max': 0.62,
  },
  standard: {
    'raster-opacity': 1,
    'raster-saturation': 0,
    'raster-contrast': 0,
    'raster-brightness-min': 0,
    'raster-brightness-max': 1,
  },
  light: {
    'raster-opacity': 0.94,
    'raster-saturation': -0.62,
    'raster-contrast': -0.08,
    'raster-brightness-min': 0.2,
    'raster-brightness-max': 0.94,
  },
  dark: {
    'raster-opacity': 0.9,
    'raster-saturation': -0.88,
    'raster-contrast': 0.26,
    'raster-brightness-min': 0.03,
    'raster-brightness-max': 0.43,
  },
  contrast: {
    'raster-opacity': 0.96,
    'raster-saturation': -0.24,
    'raster-contrast': 0.42,
    'raster-brightness-min': 0.07,
    'raster-brightness-max': 0.86,
  },
};

export function parseMapTheme(value: unknown): MapTheme {
  return mapThemes.includes(value as MapTheme) ? value as MapTheme : defaultMapTheme;
}

export function mapThemePaint(theme: MapTheme): MapThemePaint {
  return mapThemePaintValues[theme];
}

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
