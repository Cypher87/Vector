import { useId, useRef, useState } from 'react';
import {
  aircraftFilterPresetNameExists, canNotifyForPreset, maxAircraftFilterPresetNameLength,
  normalizeAircraftFilterPresetName, type AircraftFilterPreset,
} from '../domain/aircraft-filter-preset';
import { activeAircraftFilterKeys } from '../domain/aircraft-filters';
import type { UnitSystem } from '../domain/aircraft';
import type { AircraftSort } from '../domain/aircraft-sort';
import { translate, type Language, type TranslationKey } from '../i18n';
import { aircraftFilterLabel } from './aircraft-filter-labels';
import { VectorIcon } from './vector-icon';

const sortLabels: Record<AircraftSort, TranslationKey> = {
  'altitude-asc': 'lowestFirst', 'altitude-desc': 'highestFirst',
  'distance-asc': 'nearestFirst', 'distance-desc': 'farthestFirst',
  'speed-asc': 'slowestFirst', 'speed-desc': 'fastestFirst',
  'callsign-asc': 'callsignAscending', 'callsign-desc': 'callsignDescending',
  'seen-asc': 'latestFirst', 'seen-desc': 'oldestFirst',
};

export function FilterPresetNameForm({ presets, preset, language, onSave, onCancel }: {
  presets: AircraftFilterPreset[]; preset?: AircraftFilterPreset; language: Language;
  onSave: (name: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(preset?.name ?? '');
  const id = useId();
  const t = (key: TranslationKey) => translate(language, key);
  const normalized = normalizeAircraftFilterPresetName(name);
  const duplicate = aircraftFilterPresetNameExists(presets, name, preset?.id);
  return (
    <form className="filter-preset-name-form" onSubmit={(event) => {
      event.preventDefault();
      if (normalized && !duplicate) onSave(normalized);
    }}>
      <label htmlFor={id}>{t('savedViewName')}</label>
      <input id={id} autoFocus maxLength={maxAircraftFilterPresetNameLength} value={name}
        placeholder={t('savedViewNamePlaceholder')} aria-invalid={duplicate}
        aria-describedby={duplicate ? `${id}-error` : undefined}
        onChange={(event) => setName(event.target.value)} />
      {duplicate && <p id={`${id}-error`} className="filter-error" role="alert">{t('savedViewDuplicateName')}</p>}
      <div className="filter-preset-text-actions">
        <button className="primary" type="submit" disabled={!normalized || duplicate}>{t('save')}</button>
        <button type="button" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </form>
  );
}

export function AircraftSavedFilters({ presets, activePresetId, modified, language, unitSystem, managingId, onManageChange,
  onApply, onEdit, onRename, onDelete, onNotificationsChange }: {
  presets: AircraftFilterPreset[]; activePresetId?: string; modified: boolean;
  language: Language; unitSystem: UnitSystem;
  managingId: string | null; onManageChange: (id: string | null) => void;
  onApply: (preset: AircraftFilterPreset) => void; onEdit: (preset: AircraftFilterPreset) => void;
  onRename: (id: string, name: string) => void; onDelete: (id: string) => void;
  onNotificationsChange: (id: string, enabled: boolean) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const managerButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const t = (key: TranslationKey) => translate(language, key);
  const id = useId();
  const finishManaging = (presetId: string) => {
    onManageChange(null);
    managerButtons.current[presetId]?.focus();
  };
  if (presets.length === 0) return <div className="filter-presets-empty">
    <VectorIcon name="save" /><strong>{t('savedViewEmpty')}</strong><p>{t('savedViewEmptyHint')}</p>
  </div>;

  return <div className="filter-preset-list">
    {presets.map((preset) => {
      const active = preset.id === activePresetId;
      const summary = activeAircraftFilterKeys(preset.filters)
        .map((key) => aircraftFilterLabel(key, preset.filters, language, unitSystem)).join(' · ') || t('savedViewAllAircraft');
      const managing = managingId === preset.id;
      return <div className={`filter-preset-card ${active ? 'active' : ''}`} key={preset.id}>
        <div className="filter-preset-row">
          <button className="filter-preset-apply" type="button" aria-pressed={active && !modified} onClick={() => onApply(preset)}>
            <VectorIcon name={active && !modified ? 'check' : 'save'} />
            <span><strong>{preset.name}</strong>
              {active && <small>{t(modified ? 'savedViewModified' : 'savedViewActive')}</small>}
            </span>
          </button>
          <div className="filter-preset-actions">
            <button type="button" aria-label={`${t('eventFilterNotifications')}: ${preset.name}`}
              aria-pressed={preset.notifyOnMatch === true && canNotifyForPreset(preset)} disabled={!canNotifyForPreset(preset)}
              title={t(!canNotifyForPreset(preset) ? 'eventFilterRequired' : preset.notifyOnMatch ? 'eventFilterDisable' : 'eventFilterEnable')}
              onClick={() => onNotificationsChange(preset.id, !preset.notifyOnMatch)}><VectorIcon name="notifications" /></button>
            <button type="button" aria-label={`${t('manageSavedView')}: ${preset.name}`} title={t('manageSavedView')}
              ref={(button) => { managerButtons.current[preset.id] = button; }}
              aria-expanded={managing} aria-controls={`${id}-${preset.id}`}
              onClick={() => { onManageChange(managing ? null : preset.id); setDeletingId(null); }}><VectorIcon name="edit" /></button>
          </div>
        </div>
        <p className="filter-preset-description">{summary}</p>
        <p className="filter-preset-sort">{t(sortLabels[preset.sort])}{preset.favoritesFirst ? ` · ${t('favoritesFirst')}` : ''}</p>
        {managing && <div className="filter-preset-manager" id={`${id}-${preset.id}`}>
          <FilterPresetNameForm key={preset.id} presets={presets} preset={preset} language={language}
            onSave={(name) => { onRename(preset.id, name); finishManaging(preset.id); }} onCancel={() => finishManaging(preset.id)} />
          {deletingId === preset.id ? <div className="filter-preset-delete-confirm">
            <strong>{t('savedViewDeleteConfirm')}</strong>
            <div className="filter-preset-text-actions">
              <button type="button" className="danger" onClick={() => { onDelete(preset.id); onManageChange(null); setDeletingId(null); }}>{t('savedViewDelete')}</button>
              <button type="button" autoFocus onClick={() => setDeletingId(null)}>{t('cancel')}</button>
            </div>
          </div> : <div className="filter-preset-text-actions filter-preset-management-actions">
            <button type="button" onClick={() => onEdit(preset)}>{t('editSavedViewFilters')}</button>
            <button type="button" onClick={() => setDeletingId(preset.id)}>{t('savedViewDelete')}</button>
          </div>}
        </div>}
      </div>;
    })}
  </div>;
}
