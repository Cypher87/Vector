import { useRef } from 'react';
import type { AircraftFilterKey, AircraftFilters } from '../domain/aircraft-filter-preset';
import { translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';
import { activeAircraftFilterKeys } from '../domain/aircraft-filters';
import type { UnitSystem } from '../domain/aircraft';
import { aircraftFilterLabel } from './aircraft-filter-labels';

type AircraftActiveFiltersProps = {
  filters: AircraftFilters;
  language: Language;
  unitSystem: UnitSystem;
  onRemove: (key: AircraftFilterKey) => void;
};

export function AircraftActiveFilters({ filters, language, unitSystem, onRemove }: AircraftActiveFiltersProps) {
  const buttons = useRef<Partial<Record<AircraftFilterKey, HTMLButtonElement | null>>>({});
  const activeKeys = activeAircraftFilterKeys(filters);
  if (activeKeys.length === 0) return null;

  return (
    <div className="active-filter-chips" role="group" aria-label={translate(language, 'activeFilters')}>
      {activeKeys.map((key, index) => {
        const label = aircraftFilterLabel(key, filters, language, unitSystem);
        return (
          <button
            className="active-filter-chip"
            key={key}
            type="button"
            ref={(button) => { buttons.current[key] = button; }}
            aria-label={`${translate(language, 'removeFilter')}: ${label}`}
            title={label}
            onClick={() => {
              // Keep keyboard focus on a remaining chip; the parent handles the last one.
              const nextKey = activeKeys[index + 1] ?? activeKeys[index - 1];
              if (nextKey) buttons.current[nextKey]?.focus();
              onRemove(key);
            }}
          >
            <span>{label}</span>
            <VectorIcon name="close" />
          </button>
        );
      })}
    </div>
  );
}
