import type { AircraftKind } from '../domain/aircraft.ts';
import type { AircraftIconPart, AircraftShape } from './aircraft-icon-definition.ts';

// Drawn for Vector on a common 40 × 40 grid, nose up. These are deliberately
// family silhouettes, not manufacturer logos or copies of another icon set.
const shape = (path: string | string[], accent?: string | string[], movingParts?: AircraftIconPart[]): AircraftShape => ({
  w: 40, h: 40, viewBox: '0 0 40 40', strokeScale: 0.85, path, ...(accent ? { accent } : {}), ...(movingParts ? { movingParts } : {}),
});

// Three tapered blades. The renderer projects this disk into a narrow ellipse
// before rotating it, so it reads as a forward-facing propeller, not a rotor.
const propeller = (origin: [number, number], radius: number): AircraftIconPart => ({
  kind: 'propeller', origin,
  path: [0, 120, 240].map((degrees) => {
    const angle = degrees * Math.PI / 180;
    const point = (x: number, y: number) => [
      origin[0] + x * Math.cos(angle) - y * Math.sin(angle),
      origin[1] + x * Math.sin(angle) + y * Math.cos(angle),
    ].map((value) => value.toFixed(3)).join(' ');
    return `M${point(0, -.65)}L${point(radius - .6, -1.2)}Q${point(radius + .6, 0)} ${point(radius - .6, 1.2)}L${point(0, .65)}Z`;
  }).join(''),
});

export type VectorAircraftShapeName = Exclude<AircraftKind, 'unknown'> | 'unknown-contact-dot' | 'heavy-four' | 'airship' | 'gyrocopter';

export const vectorAircraftShapes: Record<VectorAircraftShapeName, AircraftShape> = {
  airliner: shape([
    'M20 2Q22.2 4 22.2 8V14L37 23V26L22 21V30L27 34V36L20 34L13 36V34L18 30V21L3 26V23L17.8 14V8Q17.8 4 20 2Z',
    'M10 19H13V25H10ZM27 19H30V25H27Z',
  ], 'M18.6 8Q20 7 21.4 8'),
  heavy: shape([
    'M20 1Q22.8 3 22.8 9V15L38 24V28L23 23V31L28 35V38L20 35.5L12 38V35L17 31V23L2 28V24L17.2 15V9Q17.2 3 20 1Z',
    'M9 19Q11 18 13 19V27H9ZM27 19Q29 18 31 19V27H27Z',
  ], 'M18 8Q20 6.5 22 8'),
  'heavy-four': shape([
    'M20 1Q23 4 23 10V15L38 25V29L23 24V31L29 36V38L20 35L11 38V36L17 31V24L2 29V25L17 15V10Q17 4 20 1Z',
    'M6 23H9V29H6ZM12 19H15V26H12ZM25 19H28V26H25ZM31 23H34V29H31Z',
  ], 'M18 8Q20 6.5 22 8'),
  small: shape([
    'M20 3Q22 5 22 10V16L34 24V27L22 23V30L27 33V35L20 33.5L13 35V33L18 30V23L6 27V24L18 16V10Q18 5 20 3Z',
    'M14 27H17V32H14ZM23 27H26V32H23Z',
  ]),
  light: shape('M20 4Q22 5 22 9V15L35 16V20L22 20V29L27 31V34L20 32L13 34V31L18 29V20L5 20V16L18 15V9Q18 5 20 4Z', undefined, [
    propeller([20, 4], 7),
  ]),
  turboprop: shape([
    'M20 3Q22 5 22 9V16L36 20V24L22 21V30L28 33V36L20 33.5L12 36V33L18 30V21L4 24V20L18 16V9Q18 5 20 3Z',
    'M10 14H13V23H10ZM27 14H30V23H27Z',
  ], undefined, [
    propeller([11.5, 13], 6),
    propeller([28.5, 13], 6),
  ]),
  glider: shape('M20 5Q21.5 6 21.5 12V17L38 19V21L21.2 20.5L20.8 31L26 33V35L20 33.5L14 35V33L19.2 31L18.8 20.5L2 21V19L18.5 17V12Q18.5 6 20 5Z'),
  helicopter: shape([
    // Narrow, tapered cabin with a distinct tail boom instead of a round pod.
    'M20 4Q21.4 4.5 22.4 7L23.4 10V17.5L22.3 21L21.2 23L20.8 32L24.5 33.5V35L20.7 34.2V37H19.3V34.2L15.5 35V33.5L19.2 32L18.8 23L17.7 21L16.6 17.5V10L17.6 7Q18.6 4.5 20 4Z',
    'M13.5 10.5L12.8 12.5V22.5L13.8 24H15L14.1 22V12.8L14.6 10.5ZM26.5 10.5L27.2 12.5V22.5L26.2 24H25L25.9 22V12.8L25.4 10.5Z',
    'M14 14H17V15H14ZM23 14H26V15H23ZM14 20H18V21H14ZM22 20H26V21H22Z',
  ], ['M17.3 10L20 8.8L22.7 10', 'M20 8.8V12'], [
    { kind: 'rotor', path: 'M5 15.5H35V16.5H5Z', origin: [20, 16] },
  ]),
  gyrocopter: shape([
    'M20 11C24 11 25 16 23 22L21 25V31L26 33V35L20 33L14 35V33L19 31V25C15 23 15 14 18 12Z',
    'M8 17H32V18.5H8Z',
  ], undefined, [
    { kind: 'rotor', path: 'M6 16.5H34V17.5H6Z', origin: [20, 17] },
  ]),
  balloon: shape('M20 4C10 4 7 10 9 17C10 22 15 26 16 30H24C25 26 30 22 31 17C33 10 30 4 20 4ZM16 33H24L23 37H17Z', ['M20 5C13 12 15 24 18 29', 'M20 5C27 12 25 24 22 29', 'M16 30L17 33M24 30L23 33']),
  airship: shape('M20 3C27 3 29 11 27 21L26 26L31 32L30 34L23 31L22 36H18L17 31L10 34L9 32L14 26C10 15 12 3 20 3Z', 'M20 5V32'),
  'high-performance': shape('M20 2L23 14L26 15L34 28V30L23 27L25 34L29 37H22L20 35L18 37H11L15 34L17 27L6 30V28L14 15L17 14Z', 'M20 10V20'),
  ultralight: shape('M20 7L36 23V26L21 21V31L25 33V35L20 33L15 35V33L19 31V21L4 26V23Z', 'M20 10V26'),
  uav: shape('M20 6L23 16L36 23V26L22 22V31L27 35H22L20 32L18 35H13L18 31V22L4 26V23L17 16Z', 'M17 15H23'),
  skydiver: shape('M5 18C6 3 34 3 35 18L29 16L24 18L20 16L16 18L11 16ZM18 29H22L23 35H17Z', ['M6 18L19 29M34 18L21 29', 'M16 18L19 29M24 18L21 29']),
  ground: shape([
    'M15 6H25L28 12V33H12V12Z',
    'M9 13H12V19H9ZM28 13H31V19H28ZM9 27H12V33H9ZM28 27H31V33H28Z',
  ], ['M15 14H25V20H15Z', 'M15 28H25']),
  // A small neutral contact carries no implied type or heading.
  'unknown-contact-dot': { w: 24, h: 24, viewBox: '0 0 24 24', strokeScale: 0.8, path: 'M17 12a5 5 0 1 1-10 0a5 5 0 1 1 10 0Z' },
};
