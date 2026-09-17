import type { Aircraft } from '../domain/aircraft';
import { defaultTheme, type Theme } from '../theme.ts';

const feetPerKilometre = 3_280.84;
type RgbColor = readonly [red: number, green: number, blue: number];

const altitudeColors: Record<Theme, readonly RgbColor[]> = {
  vector: [
    [110, 216, 154], [110, 216, 182], [110, 216, 211], [110, 194, 216], [110, 166, 216],
    [110, 138, 216], [110, 110, 216], [138, 110, 216], [166, 110, 216], [194, 110, 216],
    [216, 110, 211], [216, 110, 182], [216, 110, 154],
  ],
  midnight: [
    [98, 214, 189], [98, 214, 210], [98, 194, 228], [98, 169, 238], [114, 144, 245],
    [134, 124, 242], [156, 112, 234], [179, 109, 222], [202, 112, 207], [220, 118, 189],
    [230, 131, 170], [235, 146, 153], [236, 160, 142],
  ],
  radar: [
    [111, 227, 154], [120, 227, 134], [145, 223, 114], [176, 218, 101], [207, 206, 95],
    [229, 185, 95], [239, 160, 100], [240, 132, 109], [233, 111, 123], [218, 99, 143],
    [196, 95, 165], [170, 98, 187], [141, 105, 203],
  ],
  amber: [
    [111, 200, 176], [121, 199, 160], [143, 195, 140], [169, 189, 120], [194, 182, 107],
    [214, 170, 97], [228, 154, 93], [236, 135, 94], [237, 115, 101], [231, 102, 114],
    [219, 93, 131], [200, 89, 150], [177, 87, 168],
  ],
  daylight: [
    [88, 202, 139], [80, 204, 163], [75, 200, 188], [76, 187, 211], [84, 168, 225],
    [99, 147, 232], [120, 130, 232], [144, 116, 226], [169, 105, 216], [192, 99, 201],
    [211, 101, 182], [225, 107, 163], [235, 116, 145],
  ],
};

const altitudeStops = (theme: Theme) => altitudeColors[theme].map((color, index) => ({
  altitudeFt: index * feetPerKilometre,
  color,
}));

const interpolate = (start: number, end: number, progress: number) =>
  Math.round(start + (end - start) * progress);

export function altitudeColorForValue(altitudeFt?: number, onGround = false, theme: Theme = defaultTheme) {
  const stops = altitudeStops(theme);
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
