export type SolarPosition = {
  azimuthDeg: number;
  elevationDeg: number;
};

export type AltitudeShadowProjection = {
  blurPx: number;
  offsetXpx: number;
  offsetYpx: number;
  opacity: number;
  scale: number;
};

const radians = Math.PI / 180;
const millisecondsPerDay = 86_400_000;
const julianUnixEpoch = 2_440_587.5;
const julianJ2000 = 2_451_545;
const maximumVisualAltitudeFt = 45_000;

const normalizeDegrees = (value: number) => ((value % 360) + 360) % 360;

export function solarPosition(
  timestampSeconds: number,
  latitude: number,
  longitude: number,
): SolarPosition {
  const julianDate = timestampSeconds * 1_000 / millisecondsPerDay + julianUnixEpoch;
  const daysSinceJ2000 = julianDate - julianJ2000;
  const meanAnomaly = radians * (357.5291 + 0.98560028 * daysSinceJ2000);
  const equationOfCentre = radians * (
    1.9148 * Math.sin(meanAnomaly)
    + 0.02 * Math.sin(2 * meanAnomaly)
    + 0.0003 * Math.sin(3 * meanAnomaly)
  );
  const eclipticLongitude = meanAnomaly + equationOfCentre + radians * 102.9372 + Math.PI;
  const obliquity = radians * 23.4397;
  const declination = Math.asin(Math.sin(eclipticLongitude) * Math.sin(obliquity));
  const rightAscension = Math.atan2(
    Math.sin(eclipticLongitude) * Math.cos(obliquity),
    Math.cos(eclipticLongitude),
  );
  const siderealTime = radians * (280.16 + 360.9856235 * daysSinceJ2000) + longitude * radians;
  const hourAngle = siderealTime - rightAscension;
  const latitudeRad = latitude * radians;
  const elevation = Math.asin(
    Math.sin(latitudeRad) * Math.sin(declination)
    + Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuthFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitudeRad) - Math.tan(declination) * Math.cos(latitudeRad),
  );

  return {
    azimuthDeg: normalizeDegrees(azimuthFromSouth / radians + 180),
    elevationDeg: elevation / radians,
  };
}

export function altitudeShadowProjection(
  altitudeFt: number | undefined,
  onGround: boolean,
  sun: SolarPosition,
  mapBearingDeg = 0,
): AltitudeShadowProjection {
  if ((altitudeFt === undefined && !onGround) || sun.elevationDeg <= -0.833) {
    return { blurPx: 0, offsetXpx: 0, offsetYpx: 0, opacity: 0, scale: 1 };
  }

  const altitudeRatio = Math.min(maximumVisualAltitudeFt, Math.max(0, altitudeFt ?? 0)) / maximumVisualAltitudeFt;
  const normalizedAltitude = onGround ? 0 : Math.pow(altitudeRatio, 0.8);
  const elevationRad = Math.max(3, Math.min(90, sun.elevationDeg)) * radians;
  const solarLengthFactor = Math.max(0.58, Math.min(1.55, 0.45 + 0.55 / Math.tan(elevationRad)));
  const baseDistance = onGround ? 0.6 : 1 + normalizedAltitude * 17;
  const distance = Math.min(19, baseDistance * solarLengthFactor);
  const shadowBearing = normalizeDegrees(sun.azimuthDeg + 180 - mapBearingDeg) * radians;

  return {
    blurPx: onGround ? 0.3 : 0.5 + normalizedAltitude * 1.8,
    offsetXpx: Math.sin(shadowBearing) * distance,
    offsetYpx: -Math.cos(shadowBearing) * distance,
    opacity: onGround ? 0.36 : 0.35 - normalizedAltitude * 0.11,
    scale: onGround ? 0.94 : 0.9 - normalizedAltitude * 0.18,
  };
}

export function applyAltitudeShadowProjection(
  element: HTMLElement,
  altitudeFt: number | undefined,
  onGround: boolean,
  latitude: number,
  longitude: number,
  timestampSeconds: number,
  mapBearingDeg: number,
) {
  const projection = altitudeShadowProjection(
    altitudeFt,
    onGround,
    solarPosition(timestampSeconds, latitude, longitude),
    mapBearingDeg,
  );
  element.style.setProperty('--aircraft-shadow-blur', `${projection.blurPx.toFixed(2)}px`);
  element.style.setProperty('--aircraft-shadow-offset-x', `${projection.offsetXpx.toFixed(2)}px`);
  element.style.setProperty('--aircraft-shadow-offset-y', `${projection.offsetYpx.toFixed(2)}px`);
  element.style.setProperty('--aircraft-shadow-opacity', projection.opacity.toFixed(3));
  element.style.setProperty('--aircraft-shadow-scale', projection.scale.toFixed(3));
}
