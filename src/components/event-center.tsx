'use client';

import { useEffect, useRef, useState } from 'react';
import type { Language, TranslationKey } from '../i18n';
import { localeForLanguage, translate } from '../i18n';
import type { RadarEvent, RadarEventPreferenceKey, RadarEventPreferences } from '../domain/radar-event';
import { canNotifyForPreset, type AircraftFilterPreset } from '../domain/aircraft-filter-preset';
import { VectorIcon, type VectorIconName } from './vector-icon';

type EventCenterProps = {
  availableAircraftIds: ReadonlySet<string>;
  events: RadarEvent[];
  language: Language;
  onClear: () => void;
  onMarkAllRead: () => void;
  onPreferenceChange: (key: RadarEventPreferenceKey, enabled: boolean) => void;
  onPresetNotificationsChange: (presetId: string, enabled: boolean) => void;
  onSelectAircraft: (aircraftId: string) => void;
  preferences: RadarEventPreferences;
  presets: AircraftFilterPreset[];
  unreadCount: number;
};

const eventTranslation: Record<RadarEvent['kind'], TranslationKey> = {
  'filter-matched': 'eventFilterMatch',
  'favorite-entered': 'eventFavoriteEntered',
  'receiver-offline': 'eventReceiverOffline',
  'receiver-online': 'eventReceiverOnline',
  'squawk-7500': 'eventSquawk7500',
  'squawk-7600': 'eventSquawk7600',
  'squawk-7700': 'eventSquawk7700',
};

const eventIcon: Record<RadarEvent['kind'], VectorIconName> = {
  'filter-matched': 'notifications',
  'favorite-entered': 'favorite',
  'receiver-offline': 'receiver',
  'receiver-online': 'receiver',
  'squawk-7500': 'warning',
  'squawk-7600': 'warning',
  'squawk-7700': 'warning',
};

const preferenceLabels: Record<RadarEventPreferenceKey, TranslationKey> = {
  emergency: 'eventEmergencyAlerts',
  favorite: 'eventFavoriteAlerts',
  receiver: 'eventReceiverAlerts',
};

export function EventCenter({ availableAircraftIds, events, language, onClear, onMarkAllRead, onPreferenceChange, onPresetNotificationsChange, onSelectAircraft, preferences, presets, unreadCount }: EventCenterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const t = (key: TranslationKey) => translate(language, key);
  const dateTime = new Intl.DateTimeFormat(localeForLanguage[language], {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (open && event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('click', closeOnOutsideClick);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!open || event.key !== 'Escape') return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('.event-center-button')?.focus();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const markVisibleRead = () => {
      if (open && unreadCount > 0 && document.visibilityState !== 'hidden') onMarkAllRead();
    };
    markVisibleRead();
    document.addEventListener('visibilitychange', markVisibleRead);
    return () => document.removeEventListener('visibilitychange', markVisibleRead);
  }, [onMarkAllRead, open, unreadCount]);

  return (
    <div className={`event-center ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={t('openEventCenter')}
        className="settings-button event-center-button"
        onClick={() => setOpen((current) => !current)}
        title={t('openEventCenter')}
        type="button"
      >
        <VectorIcon name="notifications" />
        {unreadCount > 0 && <span className="event-unread-count">{Math.min(99, unreadCount)}</span>}
      </button>

      {open && (
        <section className="event-popover" aria-label={t('eventCenter')}>
          <header className="event-popover-header">
            <div>
              <strong>{t('eventCenter')}</strong>
              <span>{t('eventLastDay')}</span>
            </div>
            <button aria-label={t('closeEventCenter')} onClick={() => setOpen(false)} type="button">
              <VectorIcon name="close" />
            </button>
          </header>

          <div className="event-popover-body">
          <div className="event-list">
            {events.length === 0 && (
              <div className="event-empty">
                <VectorIcon name="notifications" />
                <strong>{t('eventNone')}</strong>
                <span>{t('eventNoneHelp')}</span>
              </div>
            )}
            {events.map((event) => {
              const aircraftLabel = event.flight ?? event.registration ?? event.aircraftId?.toUpperCase();
              const selectable = event.aircraftId && availableAircraftIds.has(event.aircraftId);
              const content = (
                <>
                  <span className={`event-kind-icon ${event.kind.startsWith('squawk') ? 'critical' : event.kind === 'receiver-online' ? 'success' : ''}`}>
                    <VectorIcon name={eventIcon[event.kind]} />
                  </span>
                  <span className="event-copy">
                    <strong>{event.kind === 'filter-matched' ? aircraftLabel : t(eventTranslation[event.kind])}</strong>
                    <small>{event.kind === 'filter-matched'
                      ? `${t('eventFilterMatch')}: ${event.matchedFilters?.map((filter) => filter.name).join(' · ')}`
                      : aircraftLabel ?? t('eventReceiver')}{event.aircraftId && !selectable ? ` · ${t('eventAircraftUnavailable')}` : ''}</small>
                  </span>
                  <time dateTime={new Date(event.timestamp).toISOString()}>{dateTime.format(event.timestamp)}</time>
                  {selectable && <VectorIcon className="event-chevron" name="chevronRight" />}
                </>
              );
              return selectable ? (
                <button className="event-row" key={event.id} onClick={() => { setOpen(false); onSelectAircraft(event.aircraftId!); }} type="button">
                  {content}
                </button>
              ) : <article className="event-row" key={event.id}>{content}</article>;
            })}
          </div>

          <details className="event-settings">
            <summary><VectorIcon name="settings" /><span>{t('eventSettings')}</span><VectorIcon name="chevronDown" /></summary>
            <div className="event-preferences event-filter-preferences">
              <strong>{t('eventWatchedFilters')}</strong>
              {presets.length === 0 && <p>{t('eventNoSavedFilters')}</p>}
              {presets.map((preset) => (
                <label key={preset.id}>
                  <span>{preset.name}</span>
                  <select
                    aria-label={`${t('eventFilterNotifications')}: ${preset.name}`}
                    disabled={!canNotifyForPreset(preset)}
                    title={!canNotifyForPreset(preset) ? t('eventFilterRequired') : undefined}
                    onChange={(event) => onPresetNotificationsChange(preset.id, event.target.value === 'yes')}
                    value={preset.notifyOnMatch && canNotifyForPreset(preset) ? 'yes' : 'no'}
                  >
                    <option value="yes">{t('yes')}</option>
                    <option value="no">{t('no')}</option>
                  </select>
                </label>
              ))}
            </div>
            <div className="event-preferences">
            <strong>{t('eventTypes')}</strong>
            {(Object.keys(preferenceLabels) as RadarEventPreferenceKey[]).map((key) => (
              <label key={key}>
                <span>{t(preferenceLabels[key])}</span>
                <select
                  aria-label={t(preferenceLabels[key])}
                  onChange={(event) => onPreferenceChange(key, event.target.value === 'yes')}
                  value={preferences[key] ? 'yes' : 'no'}
                >
                  <option value="yes">{t('yes')}</option>
                  <option value="no">{t('no')}</option>
                </select>
              </label>
            ))}
            </div>
          </details>
          </div>

          <footer>
            <button disabled={events.length === 0} onClick={onClear} type="button">
              <VectorIcon name="trash" /> {t('eventClear')}
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
