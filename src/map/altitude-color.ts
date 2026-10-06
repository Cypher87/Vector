import type { Aircraft } from '../domain/aircraft';
import { feetPerKilometre } from '../domain/altitude-scale.ts';
import { defaultTheme, themes, type Theme } from '../theme.ts';

type RgbColor = readonly [red: number, green: number, blue: number];

// One anchor per kilometre, with hue progressing in one direction:
// green → turquoise → blue → violet → rose → coral. Do not return to blue
// at low altitudes: ground contacts must stay distinct from 7–8 km traffic.
const baseColors: readonly RgbColor[] = [
  [83, 177, 118], [58, 181, 143], [49, 177, 184], [66, 165, 205],
  [84, 149, 212], [103, 136, 214], [118, 124, 213], [134, 117, 211],
  [147, 108, 204], [161, 97, 204], [197, 90, 174], [224, 102, 132], [236, 139, 96],
];

// Themes may tune contrast, but never give the same altitude a different hue.
const themeTone: Record<Theme, { saturation: number; tint: number }> = {
  vector: { saturation: 1, tint: 0 },
  midnight: { saturation: .98, tint: .08 },
  radar: { saturation: .96, tint: .04 },
  amber: { saturation: .92, tint: .02 },
  daylight: { saturation: 1.08, tint: 0 },
};

const altitudeColors = Object.fromEntries(themes.map((theme) => [theme, baseColors.map((color): RgbColor => {
  const { saturation, tint } = themeTone[theme];
  const lightness = (Math.max(...color) + Math.min(...color)) / 2;
  const tune = (channel: number) => {
    const saturated = lightness + (channel - lightness) * saturation;
    return Math.round(saturated + (255 - saturated) * tint);
  };
  return [tune(color[0]), tune(color[1]), tune(color[2])];
})])) as Record<Theme, RgbColor[]>;

const altitudeStops = Object.fromEntries(themes.map((theme) => [theme, altitudeColors[theme].map((color, index) => ({
  altitudeFt: index * feetPerKilometre, color,
}))])) as Record<Theme, { altitudeFt: number; color: RgbColor }[]>;

const interpolate = (start: number, end: number, progress: number) =>
  Math.round(start + (end - start) * progress);

export function altitudeColorForValue(altitudeFt?: number, onGround = false, theme: Theme = defaultTheme) {
  const stops = altitudeStops[theme];
  if (onGround) return `rgb(${stops[0].color.join(', ')})`;
  if (altitudeFt === undefined) return '#d5e1e4';

  const clampedAltitudeFt = Math.min(
    stops.at(-1)!.altitudeFt,
    Math.max(stops[0].altitudeFt, altitudeFt),
  );
  const upperIndex = stops.findIndex((stop) => stop.altitudeFt >= clampedAltitudeFt);
  const lowerIndex = Math.max(0, upperIndex - 1);
  const lower = stops[lowerIndex];
  const upper = stops[upperIndex];
  const interval = upper.altitudeFt - lower.altitudeFt;
  const progress = interval === 0 ? 0 : (clampedAltitudeFt - lower.altitudeFt) / interval;

  return `rgb(${interpolate(lower.color[0], upper.color[0], progress)}, ${interpolate(lower.color[1], upper.color[1], progress)}, ${interpolate(lower.color[2], upper.color[2], progress)})`;
}

export function altitudeColor(aircraft: Aircraft, theme: Theme = defaultTheme) {
  return altitudeColorForValue(aircraft.altitudeFt, aircraft.onGround, theme);
}

export function altitudeLegendGradient(theme: Theme = defaultTheme) {
  const colors = altitudeColors[theme];
  return `linear-gradient(90deg, ${colors.map((color, index) => {
    const position = index / (colors.length - 1) * 100;
    return `rgb(${color.join(', ')}) ${position.toFixed(3)}%`;
  }).join(', ')})`;
}
