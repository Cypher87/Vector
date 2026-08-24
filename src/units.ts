import type { Aircraft, UnitSystem } from './domain/aircraft';
import { localeForLanguage, translate, type Language } from './i18n';

export type UnitValue = {
  unit: string;
  value: string;
};

const numberFormats: Record<Language, { decimal: Intl.NumberFormat; integer: Intl.NumberFormat }> = {
  nl: {
    decimal: new Intl.NumberFormat(localeForLanguage.nl, { maximumFractionDigits: 1 }),
    integer: new Intl.NumberFormat(localeForLanguage.nl, { maximumFractionDigits: 0 }),
  },
  en: {
    decimal: new Intl.NumberFormat(localeForLanguage.en, { maximumFractionDigits: 1 }),
    integer: new Intl.NumberFormat(localeForLanguage.en, { maximumFractionDigits: 0 }),
  },
};

const missing = (unit = ''): UnitValue => ({ value: '—', unit });

export const formatNumber = (value?: number, language: Language = 'nl') =>
  value === undefined ? '—' : numberFormats[language].integer.format(Math.round(value));

export function altitudeValue(aircraft: Aircraft, unitSystem: UnitSystem, language: Language = 'nl'): UnitValue {
  const { integer } = numberFormats[language];
  if (aircraft.onGround) return { value: translate(language, 'ground'), unit: '' };
  if (aircraft.altitudeFt === undefined) return missing(unitSystem === 'metric' ? 'm' : 'ft');
  if (unitSystem === 'metric') return { value: integer.format(aircraft.altitudeFt * 0.3048), unit: 'm' };
  return { value: integer.format(aircraft.altitudeFt), unit: 'ft' };
}

export function speedValue(knots: number | undefined, unitSystem: UnitSystem, language: Language = 'nl'): UnitValue {
  const { integer } = numberFormats[language];
  if (knots === undefined) return missing(unitSystem === 'metric' ? 'km/h' : unitSystem === 'imperial' ? 'mph' : 'kt');
  if (unitSystem === 'metric') return { value: integer.format(knots * 1.852), unit: 'km/h' };
  if (unitSystem === 'imperial') return { value: integer.format(knots * 1.150779), unit: 'mph' };
  return { value: integer.format(knots), unit: 'kt' };
}

export function verticalRateValue(feetPerMinute: number | undefined, unitSystem: UnitSystem, language: Language = 'nl'): UnitValue {
  const { decimal, integer } = numberFormats[language];
  if (feetPerMinute === undefined) return missing(unitSystem === 'metric' ? 'm/s' : 'ft/min');
  if (unitSystem === 'metric') return { value: decimal.format(feetPerMinute * 0.00508), unit: 'm/s' };
  return { value: integer.format(feetPerMinute), unit: 'ft/min' };
}

export function distanceValue(kilometres: number | undefined, unitSystem: UnitSystem, language: Language = 'nl'): UnitValue {
  const { decimal } = numberFormats[language];
  if (kilometres === undefined) return missing(unitSystem === 'metric' ? 'km' : unitSystem === 'imperial' ? 'mi' : 'NM');
  const converted = unitSystem === 'metric' ? kilometres : unitSystem === 'imperial' ? kilometres * 0.621371 : kilometres / 1.852;
  return { value: decimal.format(converted), unit: unitSystem === 'metric' ? 'km' : unitSystem === 'imperial' ? 'mi' : 'NM' };
}

export function distanceKilometres(
  fromLatitude?: number,
  fromLongitude?: number,
  toLatitude?: number,
  toLongitude?: number,
) {
  if ([fromLatitude, fromLongitude, toLatitude, toLongitude].some((value) => value === undefined)) return undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(toLatitude! - fromLatitude!);
  const deltaLongitude = radians(toLongitude! - fromLongitude!);
  const originLatitude = radians(fromLatitude!);
  const destinationLatitude = radians(toLatitude!);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function mapAltitudeLabel(aircraft: Aircraft, unitSystem: UnitSystem, language: Language = 'nl') {
  const { decimal } = numberFormats[language];
  if (aircraft.onGround) return 'GND';
  if (aircraft.altitudeFt === undefined) return '—';
  const trend = aircraft.verticalRateFpm === undefined || Math.abs(aircraft.verticalRateFpm) < 128
    ? ''
    : aircraft.verticalRateFpm > 0 ? ' ↗' : ' ↘';
  if (unitSystem === 'metric') return `${decimal.format(aircraft.altitudeFt * 0.0003048)} km${trend}`;
  return `${decimal.format(aircraft.altitudeFt / 1_000)}k ft${trend}`;
}

export const altitudeLegendScale = (unitSystem: UnitSystem) => unitSystem === 'metric'
  ? { unit: 'km', ticks: ['0', '3', '6', '9', '12'] }
  : { unit: 'k ft', ticks: ['0', '10', '20', '30', '40'] };
