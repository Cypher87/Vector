import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  aircraftFilterPresetMatches,
  maxAircraftFilterPresetNameLength,
  maxAircraftFilterPresets,
  normalizeAircraftFilterPresetName,
  type AircraftFilterPreset,
  type AircraftFilters,
  type AircraftSort,
} from '../domain/aircraft-filter-preset';
import { translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';
import type { UnitSystem } from '../domain/aircraft';
import { AircraftFilterFields, type ChangeAircraftFilter } from './aircraft-filter-fields';
import { AircraftFilterGroup } from './aircraft-filter-group';

type AircraftFilterMenuProps = {
  activeFilterCount: number;
  filters: AircraftFilters;
  language: Language;
  unitSystem: UnitSystem;
  resultCount: number;
  receiverPositionKnown: boolean;
  presets: AircraftFilterPreset[];
  sort: AircraftSort;
  onApplyPreset: (preset: AircraftFilterPreset) => void;
  onChangeFilter: ChangeAircraftFilter;
  onDeletePreset: (presetId: string) => void;
  onRenamePreset: (presetId: string, name: string) => void;
  onReset: () => void;
  onSavePreset: (name: string) => void;
};

export function AircraftFilterMenu({
  activeFilterCount,
  filters,
  language,
  unitSystem,
  resultCount,
  receiverPositionKnown,
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
  const menuRef = useRef<HTMLDetailsElement>(null);
  const groupName = useId();
  const activePreset = presets.find((preset) => aircraftFilterPresetMatches(preset, filters, sort));
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) return;
      menu.open = false;
      setEditingPresetId(null);
      setDraftName('');
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menuRef.current?.open) return;
      menuRef.current.open = false;
      menuRef.current.querySelector('summary')?.focus();
      setEditingPresetId(null);
      setDraftName('');
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

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
    <details className="filter-menu" ref={menuRef} onToggle={(event) => {
      if (event.target !== event.currentTarget || !event.currentTarget.open) return;
      event.currentTarget.querySelector('.filter-popover')?.scrollTo({ top: 0 });
    }}>
      <summary className="filter-button" aria-label={`${activeFilterCount} ${t('activeFilters')}`}>
        {t('filter')} {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        <VectorIcon className="filter-chevron" name="chevronDown" />
      </summary>
      <div className="filter-popover filter-popover-expanded">
        <div className="filter-popover-heading">
          <strong>{t('filterAircraft')}</strong>
          <div className="filter-heading-actions">
            <button className="filter-reset" type="button" disabled={activeFilterCount === 0} onClick={onReset}>{t('clear')}</button>
            <button className="filter-close" type="button" aria-label={t('closeFilters')} onClick={() => {
              if (menuRef.current) menuRef.current.open = false;
              menuRef.current?.querySelector('summary')?.focus();
              stopEditing();
            }}><VectorIcon name="close" /></button>
          </div>
        </div>

        <AircraftFilterFields filters={filters} language={language} unitSystem={unitSystem}
          receiverPositionKnown={receiverPositionKnown} groupName={groupName} onChange={onChangeFilter} />

        <AircraftFilterGroup id="presets" name={groupName} title={t('savedViews')}
          summary={activePreset?.name ?? String(presets.length)} active={!!activePreset}>
        <div className="filter-presets">
          <div className="filter-presets-heading">
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

          {presets.length > 0 && (
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
                        {active && <small>{t('savedViewActive')}</small>}
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
        </div>
        </AircraftFilterGroup>

        <div className="filter-results">
          <strong role="status">{resultCount} {t(resultCount === 1 ? 'filterMatchSingular' : 'filterMatches')}</strong>
        </div>
      </div>
    </details>
  );
}
