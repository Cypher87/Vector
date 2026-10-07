import {
  aircraftSortDirection, aircraftSortField, aircraftSortFields, defaultAircraftSort,
  reverseAircraftSort, type AircraftSort, type AircraftSortField,
} from '../domain/aircraft-sort';
import { translate, type Language, type TranslationKey } from '../i18n';
import { VectorIcon } from './vector-icon';

const labels: Record<AircraftSortField, TranslationKey> = {
  altitude: 'altitude', distance: 'distance', speed: 'sortSpeed', callsign: 'callsign', seen: 'sortReceived',
};
const directionLabels: Record<AircraftSort, TranslationKey> = {
  'altitude-asc': 'lowestFirst', 'altitude-desc': 'highestFirst',
  'distance-asc': 'nearestFirst', 'distance-desc': 'farthestFirst',
  'speed-asc': 'slowestFirst', 'speed-desc': 'fastestFirst',
  'callsign-asc': 'callsignAscending', 'callsign-desc': 'callsignDescending',
  'seen-asc': 'latestFirst', 'seen-desc': 'oldestFirst',
};

export function AircraftSortControls({ sort, favoritesFirst, language, onSortChange, onFavoritesFirstChange }: {
  sort: AircraftSort; favoritesFirst: boolean; language: Language;
  onSortChange: (sort: AircraftSort) => void; onFavoritesFirstChange: (value: boolean) => void;
}) {
  const t = (key: TranslationKey) => translate(language, key);
  const direction = aircraftSortDirection(sort);
  return (
    <div className="aircraft-sort-controls" role="group" aria-label={t('sortAircraft')}>
      <div className="aircraft-sort-field">
        <select className="sort-select" aria-label={t('sortAircraft')} value={aircraftSortField(sort)}
          onChange={(event) => onSortChange(defaultAircraftSort(event.target.value as AircraftSortField))}>
          {aircraftSortFields.map((field) => <option key={field} value={field}>{t(labels[field])}</option>)}
        </select>
        <VectorIcon className="sort-chevron" name="chevronDown" />
      </div>
      <button type="button" className="sort-direction" data-direction={direction}
        aria-label={`${t('sortDirection')}: ${t(directionLabels[sort])}`}
        data-tooltip={`${t(directionLabels[sort])} · ${t('reverseSort')}`}
        onClick={() => onSortChange(reverseAircraftSort(sort))}>
        <VectorIcon name={direction === 'asc' ? 'sortAscending' : 'sortDescending'} />
      </button>
      <button type="button" className="sort-favorites" aria-label={t('favoritesFirst')}
        aria-pressed={favoritesFirst} data-tooltip={t('favoritesFirst')}
        onClick={() => onFavoritesFirstChange(!favoritesFirst)}>
        <VectorIcon name="favorite" />
      </button>
    </div>
  );
}
