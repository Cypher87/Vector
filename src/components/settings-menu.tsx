'use client';

import { useEffect, useRef } from 'react';
import type { UnitSystem } from '../domain/aircraft';
import { parseLegTracePeriod, type LegTracePeriod } from '../domain/aircraft-trace';
import { translate, type Language, type TranslationKey } from '../i18n';
import type { ThemeMode } from '../theme';
import { VectorIcon } from './vector-icon';

type SettingsMenuProps = {
  language: Language;
  themeMode: ThemeMode;
  unitSystem: UnitSystem;
  autoHideDetails: boolean;
  aircraftMotionEnabled: boolean;
  legTracePeriod: LegTracePeriod;
  changeTheme: (value: ThemeMode) => void;
  changeUnitSystem: (value: UnitSystem) => void;
  changeLanguage: (value: Language) => void;
  changeAutoHideDetails: (value: boolean) => void;
  changeAircraftMotionEnabled: (value: boolean) => void;
  changeLegTracePeriod: (value: LegTracePeriod) => void;
};

export function SettingsMenu({
  language,
  themeMode,
  unitSystem,
  autoHideDetails,
  aircraftMotionEnabled,
  legTracePeriod,
  changeTheme,
  changeUnitSystem,
  changeLanguage,
  changeAutoHideDetails,
  changeAircraftMotionEnabled,
  changeLegTracePeriod,
}: SettingsMenuProps) {
  const settingsMenuRef = useRef<HTMLDetailsElement>(null);
  const t = (key: TranslationKey) => translate(language, key);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = settingsMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = settingsMenuRef.current;
      if (event.key === 'Escape' && menu?.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  return (
    <details className="settings-menu" ref={settingsMenuRef}>
      <summary className="settings-button" aria-label={t('settings')} title={t('settings')}>
        <VectorIcon name="settings" />
      </summary>
      <div className="settings-popover">
        <strong>{t('settings')}</strong>
        <label className="settings-field">
          <span>{t('theme')}</span>
          <select
            aria-label={t('theme')}
            value={themeMode}
            onChange={(event) => changeTheme(event.target.value as ThemeMode)}
          >
            <option value="dark">{t('themeDark')}</option>
            <option value="light">{t('themeLight')}</option>
            <option value="auto">{t('themeAuto')}</option>
          </select>
        </label>
        <label className="settings-field">
          <span>{t('units')}</span>
          <select
            aria-label={t('unitSystem')}
            value={unitSystem}
            onChange={(event) => changeUnitSystem(event.target.value as UnitSystem)}
          >
            <option value="metric">{t('metric')}</option>
            <option value="aeronautical">{t('aeronautical')}</option>
            <option value="imperial">{t('imperial')}</option>
          </select>
        </label>
        <label className="settings-field">
          <span>{t('language')}</span>
          <select
            aria-label={t('language')}
            value={language}
            onChange={(event) => changeLanguage(event.target.value as Language)}
          >
            <option value="nl">{t('dutch')}</option>
            <option value="en">{t('english')}</option>
          </select>
        </label>
        <label className="settings-field">
          <span>{t('autoHideDetails')}</span>
          <select
            aria-label={t('autoHideDetails')}
            value={autoHideDetails ? 'yes' : 'no'}
            onChange={(event) => changeAutoHideDetails(event.target.value === 'yes')}
          >
            <option value="yes">{t('yes')}</option>
            <option value="no">{t('no')}</option>
          </select>
        </label>
        <label className="settings-field">
          <span>{t('aircraftPositionAnimation')}</span>
          <select
            aria-label={t('aircraftPositionAnimation')}
            value={aircraftMotionEnabled ? 'yes' : 'no'}
            onChange={(event) => changeAircraftMotionEnabled(event.target.value === 'yes')}
          >
            <option value="yes">{t('yes')}</option>
            <option value="no">{t('no')}</option>
          </select>
        </label>
        <label className="settings-field">
          <span>{t('legTracePeriod')}</span>
          <select
            aria-label={t('legTracePeriod')}
            value={String(legTracePeriod)}
            onChange={(event) => changeLegTracePeriod(parseLegTracePeriod(event.target.value))}
          >
            <option value="30">{t('traceLast30Minutes')}</option>
            <option value="60">{t('traceLastHour')}</option>
            <option value="120">{t('traceLast2Hours')}</option>
            <option value="240">{t('traceLast4Hours')}</option>
            <option value="360">{t('traceLast6Hours')}</option>
            <option value="480">{t('traceLast8Hours')}</option>
            <option value="full">{t('traceFull')}</option>
          </select>
        </label>
      </div>
    </details>
  );
}
