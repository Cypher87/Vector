import type { AircraftFilterKey, AircraftFilters, FilterCategory, NumericFilterKind } from '../domain/aircraft-filters';
import { filterMeasurement } from '../domain/aircraft-filters';
import type { UnitSystem } from '../domain/aircraft';
import { translate, type Language, type TranslationKey } from '../i18n';

export const categoryLabels: Record<FilterCategory, TranslationKey> = {
  light: 'filterKindLight', airliner: 'filterKindAirliner', heavy: 'filterKindHeavy',
  turboprop: 'filterKindTurboprop', helicopter: 'filterKindHelicopter', glider: 'filterKindGlider',
  balloon: 'filterKindBalloon', other: 'filterKindOther',
};
export const flightStatusLabels: Record<AircraftFilters['flightStatus'], TranslationKey> = {
  all: 'filterAll', airborne: 'airborne', ground: 'ground', climbing: 'filterClimbing', descending: 'filterDescending',
};
export const positionLabels: Record<AircraftFilters['position'], TranslationKey> = {
  all: 'filterAll', with: 'filterWithPosition', without: 'filterWithoutPosition',
};
export const alertLabels: Record<AircraftFilters['alert'], TranslationKey> = {
  all: 'filterAll', emergency: 'filterEmergency', '7500': 'filterSquawk7500', '7600': 'filterSquawk7600', '7700': 'filterSquawk7700',
};
export const measurementLabels: Record<NumericFilterKind, TranslationKey> = {
  altitude: 'altitude', distance: 'filterDistance', speed: 'groundSpeed',
};
export function aircraftFilterLabel(key: AircraftFilterKey, filters: AircraftFilters, language: Language, units: UnitSystem): string {
  const t = (label: TranslationKey) => translate(language, label);
  if (key === 'favoritesOnly') return t('favorites');
  if (key === 'categories') return filters.categories.map((category) => t(categoryLabels[category])).join(', ');
  if (key === 'flightStatus') return t(flightStatusLabels[filters.flightStatus]);
  if (key === 'source') return filters.source === 'adsb' ? 'ADS-B' : filters.source === 'mlat' ? 'MLAT' : t('filterOtherSource');
  if (key === 'position') return t(positionLabels[filters.position]);
  if (key === 'typeCodes') return filters.typeCodes.join(', ');
  if (key === 'alert') return t(alertLabels[filters.alert]);
  const { factor, unit } = filterMeasurement(key, units);
  const format = (value: number) => (value * factor).toLocaleString(language === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 1 });
  if (key === 'distance') return `${t('distance')} ≤ ${format(filters.distance!)} ${unit}`;
  const { min, max } = filters[key];
  const range = min === null ? `≤ ${format(max!)}` : max === null ? `≥ ${format(min)}` : `${format(min)}–${format(max)}`;
  return `${t(measurementLabels[key])} ${range} ${unit}`;
}
