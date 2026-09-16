import { useState, type FormEvent } from 'react';
import {
  aircraftFilterPresetMatches,
  maxAircraftFilterPresetNameLength,
  maxAircraftFilterPresets,
  normalizeAircraftFilterPresetName,
  type AircraftFilterKey,
  type AircraftFilterPreset,
  type AircraftFilters,
  type AircraftSort,
} from '../domain/aircraft-filter-preset';
import { translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';

type AircraftFilterMenuProps = {
  activeFilterCount: number;
  filters: AircraftFilters;
  language: Language;
  presets: AircraftFilterPreset[];
  sort: AircraftSort;
  onApplyPreset: (preset: AircraftFilterPreset) => void;
  onChangeFilter: (key: AircraftFilterKey, enabled: boolean) => void;
  onDeletePreset: (presetId: string) => void;
  onRenamePreset: (presetId: string, name: string) => void;
  onReset: () => void;
  onSavePreset: (name: string) => void;
};

export function AircraftFilterMenu({
  activeFilterCount,
  filters,
  language,
  presets,
  sort,
  onApplyPreset,
  onChangeFilter,
  onDeletePreset,
  onRenamePreset,
  onReset,
  onSavePreset,
}: AircraftFilterMenuProps) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const stopEditing = () => {
    setEditingPresetId(null);
    setDraftName('');
  };

  const startCreating = () => {
    setEditingPresetId('new');
    setDraftName('');
  };

  const startRenaming = (preset: AircraftFilterPreset) => {
    setEditingPresetId(preset.id);
    setDraftName(preset.name);
  };

  const saveName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizeAircraftFilterPresetName(draftName);
    if (!name) return;
    if (editingPresetId === 'new') onSavePreset(name);
    else if (editingPresetId) onRenamePreset(editingPresetId, name);
    stopEditing();
  };

  return (
    <details className="filter-menu">
      <summary className="filter-button" aria-label={`${activeFilterCount} ${t('activeFilters')}`}>
        {t('filter')} {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        <VectorIcon className="filter-chevron" name="chevronDown" />
      </summary>
      <div className="filter-popover">
        <div className="filter-popover-heading">
          <strong>{t('filterAircraft')}</strong>
          <button type="button" disabled={activeFilterCount === 0} onClick={onReset}>{t('clear')}</button>
        </div>

        <section className="filter-presets">
          <div className="filter-presets-heading">
            <strong>{t('savedViews')}</strong>
            {editingPresetId !== 'new' && (
              <button
                type="button"
                disabled={presets.length >= maxAircraftFilterPresets}
                onClick={startCreating}
              >
                <VectorIcon name="save" />
                {t('saveCurrentView')}
              </button>
            )}
          </div>

          {editingPresetId === 'new' && (
            <form className="filter-preset-form" onSubmit={saveName}>
              <input
                autoFocus
                aria-label={t('savedViewName')}
                maxLength={maxAircraftFilterPresetNameLength}
                placeholder={t('savedViewNamePlaceholder')}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
              <button type="submit" aria-label={t('save')} disabled={!normalizeAircraftFilterPresetName(draftName)} title={t('save')}>
                <VectorIcon name="check" />
              </button>
              <button type="button" aria-label={t('cancel')} title={t('cancel')} onClick={stopEditing}>
                <VectorIcon name="close" />
              </button>
            </form>
          )}

          {presets.length === 0 && editingPresetId !== 'new' ? (
            <p>{t('noSavedViews')}</p>
          ) : (
            <div className="filter-preset-list">
              {presets.map((preset) => {
                const active = aircraftFilterPresetMatches(preset, filters, sort);
                if (editingPresetId === preset.id) {
                  return (
                    <form className="filter-preset-form" key={preset.id} onSubmit={saveName}>
                      <input
                        autoFocus
                        aria-label={t('savedViewName')}
                        maxLength={maxAircraftFilterPresetNameLength}
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <button type="submit" aria-label={t('save')} disabled={!normalizeAircraftFilterPresetName(draftName)} title={t('save')}>
                        <VectorIcon name="check" />
                      </button>
                      <button type="button" aria-label={t('cancel')} title={t('cancel')} onClick={stopEditing}>
                        <VectorIcon name="close" />
                      </button>
                    </form>
                  );
                }
                return (
                  <div className={`filter-preset-row ${active ? 'active' : ''}`} key={preset.id}>
                    <button className="filter-preset-apply" type="button" onClick={() => onApplyPreset(preset)}>
                      <VectorIcon name="save" />
                      <span>
                        <strong>{preset.name}</strong>
                        <small>{t(active ? 'savedViewActive' : 'applySavedView')}</small>
                      </span>
                    </button>
                    <div className="filter-preset-actions">
                      <button type="button" aria-label={`${t('renameSavedView')}: ${preset.name}`} title={t('renameSavedView')} onClick={() => startRenaming(preset)}>
                        <VectorIcon name="edit" />
                      </button>
                      <button type="button" aria-label={`${t('deleteSavedView')}: ${preset.name}`} title={t('deleteSavedView')} onClick={() => onDeletePreset(preset.id)}>
                        <VectorIcon name="trash" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="filter-options">
          <label>
            <span><strong>{t('favoritesOnly')}</strong><small>{t('favoritesOnlyHelp')}</small></span>
            <input type="checkbox" checked={filters.favoritesOnly} onChange={(event) => onChangeFilter('favoritesOnly', event.target.checked)} />
          </label>
          <label>
            <span><strong>{t('positionAvailable')}</strong><small>{t('positionAvailableHelp')}</small></span>
            <input type="checkbox" checked={filters.positionOnly} onChange={(event) => onChangeFilter('positionOnly', event.target.checked)} />
          </label>
          <label>
            <span><strong>{t('airborne')}</strong><small>{t('airborneHelp')}</small></span>
            <input type="checkbox" checked={filters.airborneOnly} onChange={(event) => onChangeFilter('airborneOnly', event.target.checked)} />
          </label>
          <label>
            <span><strong>{t('adsbDirect')}</strong><small>{t('adsbDirectHelp')}</small></span>
            <input type="checkbox" checked={filters.adsbOnly} onChange={(event) => onChangeFilter('adsbOnly', event.target.checked)} />
          </label>
        </div>
      </div>
    </details>
  );
}
