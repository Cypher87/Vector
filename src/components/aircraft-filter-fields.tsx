import { useId, useRef, useState } from 'react';
import type { UnitSystem } from '../domain/aircraft';
import {
  activeAircraftFilterKeys, filterAlerts, filterCategories, filterFlightStatuses, filterMeasurement, filterPositions, normalizeTypeCodes,
  type AircraftFilterKey, type AircraftFilters, type FilterRange, type NumericFilterKind,
} from '../domain/aircraft-filters';
import { translate, type Language } from '../i18n';
import { aircraftFilterLabel, alertLabels, categoryLabels, flightStatusLabels, measurementLabels, positionLabels } from './aircraft-filter-labels';
import { AircraftFilterGroup } from './aircraft-filter-group';

export type ChangeAircraftFilter = <K extends AircraftFilterKey>(key: K, value: AircraftFilters[K]) => void;

// Keep drafts separate: an incomplete/invalid edit must not erase an active filter.
function RangeFields({ kind, value, units, language, onChange }: {
  kind: NumericFilterKind; value: FilterRange; units: UnitSystem; language: Language; onChange: (value: FilterRange) => void;
}) {
  const measurement = filterMeasurement(kind, units);
  const format = (number: number | null) => number === null ? '' : String(Number((number * measurement.factor).toFixed(2)));
  const [draft, setDraft] = useState({ min: format(value.min), max: format(value.max) });
  const [invalid, setInvalid] = useState(false);
  const signature = JSON.stringify(value);
  const [previous, setPrevious] = useState(signature);
  if (signature !== previous) {
    setPrevious(signature);
    setDraft({ min: format(value.min), max: format(value.max) });
    setInvalid(false);
  }
  const errorId = useId();
  const inputs = useRef<Partial<Record<'min' | 'max', HTMLInputElement | null>>>({});
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const commit = () => {
    const parse = (key: 'min' | 'max') => {
      // Preserve full precision of an unedited bound when changing units.
      if (draft[key] === format(value[key])) return value[key];
      return draft[key].trim() === '' ? null : Number(draft[key]) / measurement.factor;
    };
    const next = { min: parse('min'), max: parse('max') };
    const valid = !Object.values(inputs.current).some((input) => input?.validity.badInput)
      && Object.values(next).every((number) => number === null || Number.isFinite(number) && number >= measurement.min && number <= measurement.max)
      && (next.min === null || next.max === null || next.min <= next.max);
    setInvalid(!valid);
    if (valid) {
      setPrevious(JSON.stringify(next));
      onChange(next);
    }
  };
  return (
    <fieldset className={`filter-field ${kind === 'distance' ? 'filter-custom-distance' : ''}`}>
      <legend className={kind === 'distance' ? 'sr-only' : undefined}>{t(measurementLabels[kind])} <span>{measurement.unit}</span></legend>
      <div className="filter-range">
        {(kind === 'distance' ? ['max'] as const : ['min', 'max'] as const).map((bound) => (
          <label key={bound}>
            <span>{t(bound === 'min' ? 'filterMin' : 'filterMax')}</span>
            <input type="number" inputMode="decimal" step="any"
              ref={(input) => { inputs.current[bound] = input; }}
              aria-label={`${t(measurementLabels[kind])} · ${t(bound === 'min' ? 'filterMin' : 'filterMax')} (${measurement.unit})`}
              aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
              min={measurement.min * measurement.factor} max={measurement.max * measurement.factor}
              placeholder={t('filterNoLimit')} value={draft[bound]}
              onChange={(event) => setDraft({ ...draft, [bound]: event.target.value })}
              onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
          </label>
        ))}
      </div>
      {invalid && <p className="filter-error" id={errorId} role="alert">{t('filterRangeError')}</p>}
    </fieldset>
  );
}

function TypeCodeField({ value, language, onChange }: { value: string[]; language: Language; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState(value.join(', '));
  const [invalid, setInvalid] = useState(false);
  const signature = value.join(',');
  const [previous, setPrevious] = useState(signature);
  if (previous !== signature) {
    setPrevious(signature);
    setDraft(value.join(', '));
    setInvalid(false);
  }
  const id = useId();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const commit = () => {
    const codes = draft.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    const valid = codes.length <= 20 && codes.every((code) => /^[A-Z0-9]{1,4}$/.test(code));
    setInvalid(!valid);
    if (valid) onChange(normalizeTypeCodes(codes));
  };
  return (
    <label className="filter-field filter-type-codes">
      <span>{t('filterTypeCodes')}</span>
      <input value={draft} placeholder="B738, A320" maxLength={120} autoCapitalize="characters" spellCheck={false}
        aria-invalid={invalid} aria-describedby={invalid ? id : undefined}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      {invalid && <small id={id} className="filter-error" role="alert">{t('filterTypeError')}</small>}
    </label>
  );
}

export function AircraftFilterFields({ filters, language, unitSystem, receiverPositionKnown, groupName, onChange }: {
  filters: AircraftFilters; language: Language; unitSystem: UnitSystem; receiverPositionKnown: boolean; groupName: string; onChange: ChangeAircraftFilter;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const activeKeys = activeAircraftFilterKeys(filters);
  const group = (keys: AircraftFilterKey[], fallback = t('filterAll')) => {
    const active = keys.filter((key) => activeKeys.includes(key));
    return { active: active.length > 0, summary: active.length
      ? active.map((key) => aircraftFilterLabel(key, filters, language, unitSystem)).join(' · ')
      : fallback };
  };
  const distance = filterMeasurement('distance', unitSystem);
  const distanceValue = filters.distance === null ? '' : filters.distance * distance.factor;
  const distancePreset = [25, 50, 100, 200].find((value) => distanceValue !== '' && Math.abs(value - distanceValue) < 1e-6);
  const [customDistance, setCustomDistance] = useState(false);
  return (
    <div className="filter-options filter-fields">
      <label className="filter-favorite">
        <span><strong>{t('favoritesOnly')}</strong></span>
        <input type="checkbox" checked={filters.favoritesOnly} onChange={(event) => onChange('favoritesOnly', event.target.checked)} />
      </label>
      <AircraftFilterGroup id="categories" name={groupName} title={t('filterKinds')} {...group(['categories'])}>
      <fieldset className="filter-field">
        <legend className="sr-only">{t('filterKinds')}</legend>
        <div className="filter-categories">
          {filterCategories.map((category) => (
            <label key={category} className={filters.categories.includes(category) ? 'selected' : ''}>
              <input type="checkbox" checked={filters.categories.includes(category)}
                onChange={(event) => onChange('categories', event.target.checked ? [...filters.categories, category] : filters.categories.filter((value) => value !== category))} />
              <span>{t(categoryLabels[category])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      </AircraftFilterGroup>
      <AircraftFilterGroup id="flight" name={groupName} title={t('filterFlightGroup')} {...group(['altitude', 'speed', 'flightStatus'], t('filterDistanceAny'))}>
      <RangeFields key={`altitude-${unitSystem}`} kind="altitude" value={filters.altitude} units={unitSystem} language={language} onChange={(value) => onChange('altitude', value)} />
      <RangeFields key={`speed-${unitSystem}`} kind="speed" value={filters.speed} units={unitSystem} language={language} onChange={(value) => onChange('speed', value)} />
      <label className="filter-field">
        <span>{t('flightStatus')}</span>
        <select aria-label={t('flightStatus')} value={filters.flightStatus} onChange={(event) => onChange('flightStatus', event.target.value as AircraftFilters['flightStatus'])}>
          {filterFlightStatuses.map((value) => <option key={value} value={value}>{t(flightStatusLabels[value])}</option>)}
        </select>
      </label>
      </AircraftFilterGroup>
      <AircraftFilterGroup id="distance" name={groupName} title={t('distance')} {...group(['distance'], t('filterDistanceAny'))}>
      <div className="filter-field">
        <label className="filter-distance-label">
        <span>{t('filterDistance')} <em>{distance.unit}</em></span>
        <select aria-label={t('filterDistance')} value={customDistance || distanceValue !== '' && !distancePreset ? 'custom' : distanceValue === '' ? '' : String(distancePreset)}
          onChange={(event) => {
            setCustomDistance(event.target.value === 'custom');
            if (event.target.value !== 'custom') onChange('distance', event.target.value === '' ? null : Number(event.target.value) / distance.factor);
          }}>
          <option value="">{t('filterDistanceAny')}</option>
          {[25, 50, 100, 200].map((value) => <option key={value} value={value}>≤ {value} {distance.unit}</option>)}
          <option value="custom">{t('filterDistanceCustom')}</option>
        </select>
        </label>
      {(customDistance || distanceValue !== '' && !distancePreset) && (
        <RangeFields key={`distance-${unitSystem}`} kind="distance" value={{ min: null, max: filters.distance }} units={unitSystem} language={language} onChange={(value) => onChange('distance', value.max)} />
      )}
        {!receiverPositionKnown && <small className="filter-warning">{t('filterReceiverMissing')}</small>}
      </div>
      </AircraftFilterGroup>
      <AircraftFilterGroup id="advanced" name={groupName} title={t('filterAdvanced')} {...group(['source', 'position', 'typeCodes', 'alert'])}>
        <label className="filter-field">
          <span>{t('source')}</span>
          <select value={filters.source} onChange={(event) => onChange('source', event.target.value as AircraftFilters['source'])}>
            <option value="all">{t('filterAll')}</option><option value="adsb">ADS-B</option><option value="mlat">MLAT</option><option value="other">{t('filterOtherSource')}</option>
          </select>
        </label>
        <label className="filter-field">
          <span>{t('filterPosition')}</span>
          <select value={filters.position} onChange={(event) => onChange('position', event.target.value as AircraftFilters['position'])}>
            {filterPositions.map((value) => <option key={value} value={value}>{t(positionLabels[value])}</option>)}
          </select>
        </label>
        <TypeCodeField value={filters.typeCodes} language={language} onChange={(value) => onChange('typeCodes', value)} />
        <label className="filter-field">
          <span>{t('filterAlerts')}</span>
          <select value={filters.alert} onChange={(event) => onChange('alert', event.target.value as AircraftFilters['alert'])}>
            {filterAlerts.map((value) => <option key={value} value={value}>{t(alertLabels[value])}</option>)}
          </select>
        </label>
      </AircraftFilterGroup>
    </div>
  );
}
