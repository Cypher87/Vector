import { useEffect, useId, useRef, useState } from 'react';
import {
  aircraftFilterPresetMatches, maxAircraftFilterPresets,
  type AircraftFilterPreset, type AircraftFilters, type AircraftSort,
} from '../domain/aircraft-filter-preset';
import { translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';
import type { UnitSystem } from '../domain/aircraft';
import { AircraftFilterFields, type ChangeAircraftFilter } from './aircraft-filter-fields';
import { AircraftSavedFilters, FilterPresetNameForm } from './aircraft-saved-filters';

type AircraftFilterMenuProps = {
  activeFilterCount: number;
  filters: AircraftFilters;
  language: Language;
  unitSystem: UnitSystem;
  resultCount: number;
  receiverPositionKnown: boolean;
  presets: AircraftFilterPreset[];
  sort: AircraftSort;
  favoritesFirst: boolean;
  onApplyPreset: (preset: AircraftFilterPreset) => void;
  onChangeFilter: ChangeAircraftFilter;
  onDeletePreset: (presetId: string) => void;
  onRenamePreset: (presetId: string, name: string) => void;
  onNotificationsChange: (presetId: string, enabled: boolean) => void;
  onReset: () => void;
  onSavePreset: (name: string) => string;
  onUpdatePreset: (presetId: string) => void;
};

export function AircraftFilterMenu({ activeFilterCount, filters, language, unitSystem, resultCount,
  receiverPositionKnown, presets, sort, favoritesFirst, onApplyPreset, onChangeFilter,
  onDeletePreset, onRenamePreset, onNotificationsChange, onReset, onSavePreset, onUpdatePreset,
}: AircraftFilterMenuProps) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<'filters' | 'saved', HTMLButtonElement | null>>>({});
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const groupName = useId();
  const [tab, setTab] = useState<'filters' | 'saved'>('filters');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  const matching = presets.find((preset) => aircraftFilterPresetMatches(preset, filters, sort, favoritesFirst));
  // Remember which view is being edited even after its criteria no longer match.
  const selected = presets.find((preset) => preset.id === selectedId) ?? matching;
  const modified = !!selected && !aircraftFilterPresetMatches(selected, filters, sort, favoritesFirst);
  const atLimit = presets.length >= maxAircraftFilterPresets;

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) return;
      menu.open = false;
      setCreating(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !menuRef.current?.open) return;
      menuRef.current.open = false;
      menuRef.current.querySelector('summary')?.focus();
      setCreating(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const changeTab = (next: 'filters' | 'saved', focus = false) => {
    setTab(next);
    setCreating(false);
    setManagingId(null);
    bodyRef.current?.scrollTo({ top: 0 });
    if (focus) tabRefs.current[next]?.focus();
  };
  const apply = (preset: AircraftFilterPreset) => {
    setSelectedId(preset.id);
    setCreating(false);
    setManagingId(null);
    onApplyPreset(preset);
  };
  const finishCreating = () => {
    setCreating(false);
    // The button is mounted on the next frame; restore focus after form submission/cancel.
    requestAnimationFrame(() => {
      const button = saveButtonRef.current;
      (button?.disabled ? tabRefs.current[tab] : button)?.focus();
    });
  };
  const validFields = () => {
    const invalid = menuRef.current?.querySelector<HTMLInputElement>('.filter-fields input[aria-invalid="true"]');
    if (!invalid) return true;
    changeTab('filters');
    const group = invalid.closest('details');
    if (group) group.open = true;
    requestAnimationFrame(() => { invalid.focus(); invalid.scrollIntoView({ block: 'nearest' }); });
    return false;
  };

  return (
    <details className="filter-menu" ref={menuRef} onToggle={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.currentTarget.open) {
        bodyRef.current?.scrollTo({ top: 0 });
        if (selected) setSelectedId(selected.id);
      } else { setCreating(false); setManagingId(null); }
    }}>
      <summary className="filter-button" aria-label={`${activeFilterCount} ${t('activeFilters')}`}>
        {t('filter')} {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
        <VectorIcon className="filter-chevron" name="chevronDown" />
      </summary>
      <div className="filter-popover filter-popover-expanded filter-workspace">
        <div className="filter-popover-heading">
          <strong>{t('filterAircraft')}</strong>
          <div className="filter-heading-actions">
            <button className="filter-reset" type="button" disabled={activeFilterCount === 0} onClick={() => {
              setSelectedId(null); setCreating(false); setManagingId(null); onReset();
            }}>{t('clear')}</button>
            <button className="filter-close" type="button" aria-label={t('closeFilters')} onClick={() => {
              if (menuRef.current) menuRef.current.open = false;
              menuRef.current?.querySelector('summary')?.focus();
            }}><VectorIcon name="close" /></button>
          </div>
        </div>
        <div className="filter-tabs" role="tablist" aria-label={t('filterAircraft')}>
          {(['filters', 'saved'] as const).map((name) => <button key={name} type="button" role="tab"
            ref={(button) => { tabRefs.current[name] = button; }} data-filter-tab={name}
            id={`${groupName}-${name}-tab`} aria-controls={`${groupName}-${name}-panel`}
            aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
            onClick={() => changeTab(name)} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              changeTab(event.key === 'Home' ? 'filters' : event.key === 'End' ? 'saved' : name === 'filters' ? 'saved' : 'filters', true);
            }}>{t(name === 'filters' ? 'filterTab' : 'savedFiltersTab')}{name === 'saved' && <span>{presets.length}</span>}</button>)}
        </div>
        <div className="filter-workspace-body" ref={bodyRef}>
          <div role="tabpanel" id={`${groupName}-filters-panel`} aria-labelledby={`${groupName}-filters-tab`} hidden={tab !== 'filters'}>
            <AircraftFilterFields filters={filters} language={language} unitSystem={unitSystem}
              receiverPositionKnown={receiverPositionKnown} groupName={groupName} onChange={(key, value) => {
                if (selected) setSelectedId(selected.id);
                onChangeFilter(key, value);
              }} />
          </div>
          <div role="tabpanel" id={`${groupName}-saved-panel`} aria-labelledby={`${groupName}-saved-tab`} hidden={tab !== 'saved'}>
            {tab === 'saved' && <AircraftSavedFilters presets={presets} activePresetId={selected?.id} modified={modified}
              managingId={managingId} onManageChange={(id) => { setManagingId(id); setCreating(false); }}
              language={language} unitSystem={unitSystem} onApply={apply}
              onEdit={(preset) => {
                // Continue local edits when managing the current view, not its old saved copy.
                if (selected?.id !== preset.id) apply(preset);
                else setSelectedId(preset.id);
                changeTab('filters', true);
              }}
              onRename={onRenamePreset} onDelete={(id) => {
                onDeletePreset(id);
                if (selected?.id === id) setSelectedId(null);
                tabRefs.current.saved?.focus();
              }} onNotificationsChange={onNotificationsChange} />}
          </div>
        </div>
        <div className="filter-results filter-workspace-footer">
          <div className="filter-current-view">
            <strong title={selected?.name}>{selected?.name ?? t(activeFilterCount ? 'customFilterView' : 'savedViewAllAircraft')}</strong>
            {selected && <span className={modified ? 'modified' : ''}>{t(modified ? 'savedViewModified' : 'savedViewSaved')}</span>}
          </div>
          <span className="filter-result-count" role="status">{resultCount} {t(resultCount === 1 ? 'filterMatchSingular' : 'filterMatches')}</span>
          {creating ? <FilterPresetNameForm presets={presets} language={language} onCancel={finishCreating} onSave={(name) => {
            if (atLimit || !validFields()) return;
            setSelectedId(onSavePreset(name));
            finishCreating();
          }} /> : <div className="filter-preset-text-actions">
            {modified && <button className="primary" type="button" onClick={() => {
              if (!validFields() || !selected) return;
              onUpdatePreset(selected.id);
              (atLimit ? tabRefs.current[tab] : saveButtonRef.current)?.focus();
            }}>{t('updateSavedView')}</button>}
            <button type="button" ref={saveButtonRef} disabled={atLimit} onClick={() => {
              if (validFields()) { setManagingId(null); setCreating(true); }
            }}>{t('saveNewView')}</button>
          </div>}
          {atLimit && <p className="filter-preset-limit">{t('savedViewLimit')}</p>}
        </div>
      </div>
    </details>
  );
}
