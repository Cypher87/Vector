'use client';

import { useEffect, useState } from 'react';
import { localeForLanguage, translate, type Language } from '../i18n';
import type { HistorySource } from '../data/use-aircraft-history';

type HistoryControlsProps = {
  canNextPeriod: boolean;
  canPreviousPeriod: boolean;
  currentTimestamp?: number;
  error: boolean;
  index: number;
  language: Language;
  loading: boolean;
  open: boolean;
  playing: boolean;
  snapshotCount: number;
  source: HistorySource;
  speed: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onLoadAt: (date: Date) => void;
  onNextPeriod: () => void;
  onOpen: () => void;
  onPreviousPeriod: () => void;
  onSpeedChange: (speed: number) => void;
  onTogglePlaying: () => void;
};

type PickerValue = {
  date: string;
  hour: string;
  minute: string;
};

const toPickerValue = (timestamp?: number): PickerValue => {
  const date = new Date((timestamp ?? Date.now() / 1_000) * 1_000);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    date: `${year}-${month}-${day}`,
    hour: String(date.getHours()).padStart(2, '0'),
    minute: String(date.getMinutes()).padStart(2, '0'),
  };
};

const dateFromPicker = ({ date, hour, minute }: PickerValue) => {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const target = new Date(year, month - 1, day, Number(hour), Number(minute), 0, 0);
  return Number.isNaN(target.getTime()) ? undefined : target;
};

export function HistoryControls(props: HistoryControlsProps) {
  const {
    canNextPeriod,
    canPreviousPeriod,
    currentTimestamp,
    error,
    index,
    language,
    loading,
    onClose,
    onIndexChange,
    onLoadAt,
    onNextPeriod,
    onOpen,
    onPreviousPeriod,
    onSpeedChange,
    onTogglePlaying,
    open,
    playing,
    snapshotCount,
    source,
    speed,
  } = props;
  const [pickerValue, setPickerValue] = useState(() => toPickerValue(currentTimestamp));
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);

  const changePicker = (field: keyof PickerValue, value: string) => {
    const next = { ...pickerValue, [field]: value };
    setPickerValue(next);
    const target = dateFromPicker(next);
    if (target) onLoadAt(target);
  };

  useEffect(() => {
    if (!open || !currentTimestamp) return;

    const frame = requestAnimationFrame(() => {
      setPickerValue(toPickerValue(currentTimestamp));
    });

    return () => cancelAnimationFrame(frame);
  }, [currentTimestamp, open]);

  if (!open) {
    return (
      <button className="history-launch" type="button" onClick={onOpen}>
        <span aria-hidden="true">↶</span> {t('history')}
      </button>
    );
  }

  const date = currentTimestamp ? new Date(currentTimestamp * 1_000) : undefined;
  const dateFormatter = new Intl.DateTimeFormat(localeForLanguage[language], {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  return (
    <section className="history-panel" aria-label={t('history')}>
      <div className="history-heading">
        <div>
          <strong>{t('history')}</strong>
        </div>
        <button type="button" className="history-live" onClick={onClose}><i /> {t('backToLive')}</button>
      </div>

      <div className="history-playback">
        <button
          type="button"
          className="history-play"
          aria-label={t(playing ? 'pause' : 'play')}
          disabled={snapshotCount < 2 || loading}
          onClick={onTogglePlaying}
        >{playing ? 'Ⅱ' : '▶'}</button>
        <button
          type="button"
          className="history-period"
          aria-label={t('previousHistoryPeriod')}
          disabled={!canPreviousPeriod || loading}
          onClick={onPreviousPeriod}
        >‹</button>
        <time>{date ? dateFormatter.format(date) : '—'}</time>
        <button
          type="button"
          className="history-period"
          aria-label={t('nextHistoryPeriod')}
          disabled={!canNextPeriod || loading}
          onClick={onNextPeriod}
        >›</button>
        <input
          type="range"
          min="0"
          max={Math.max(0, snapshotCount - 1)}
          value={Math.min(index, Math.max(0, snapshotCount - 1))}
          disabled={snapshotCount < 2 || loading}
          aria-label={t('historyTimeline')}
          onChange={(event) => onIndexChange(Number(event.target.value))}
        />
        <select aria-label={t('playbackSpeed')} value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}>
          {[1, 5, 15, 30, 60].map((value) => <option value={value} key={value}>{value}×</option>)}
        </select>
      </div>

      <div className="history-jump">
        <div className="history-picker" role="group" aria-label={t('dateAndTime')}>
          <span>{t('dateAndTime')}</span>
          <input
            type="date"
            lang={localeForLanguage[language]}
            aria-label={t('date')}
            value={pickerValue.date}
            onChange={(event) => changePicker('date', event.target.value)}
          />
          <select aria-label={t('hour')} value={pickerValue.hour} onChange={(event) => changePicker('hour', event.target.value)}>
            {Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0')).map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
          <b aria-hidden="true">:</b>
          <select aria-label={t('minute')} value={pickerValue.minute} onChange={(event) => changePicker('minute', event.target.value)}>
            {Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0')).map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </div>
        <small>{loading ? t('historyLoading') : error ? t('receiverHistoryUnavailable') : source === 'session' ? t('sessionHistoryHelp') : `${snapshotCount} ${t('snapshots')}`}</small>
      </div>
    </section>
  );
}
