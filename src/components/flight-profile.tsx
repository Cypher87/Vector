'use client';

import { useEffect, useId, useMemo, useState, type PointerEvent } from 'react';
import type { AircraftTracePoint, UnitSystem } from '../domain/aircraft';
import { parseLegTracePeriod, type LegTracePeriod } from '../domain/aircraft-trace';
import { nearestTracePoint, profileSeries } from '../domain/flight-profile';
import { localeForLanguage, translate, type Language } from '../i18n';
import { formatNumber } from '../units';
import { VectorIcon } from './vector-icon';

type Props = {
  points: AircraftTracePoint[]; loading: boolean; language: Language; unitSystem: UnitSystem;
  period: LegTracePeriod; historyOpen: boolean;
  onPeriodChange: (period: LegTracePeriod) => void;
  onHighlight: (point?: AircraftTracePoint) => void;
};

export function FlightProfile({ points, loading, language, unitSystem, period, historyOpen, onPeriodChange, onHighlight }: Props) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const [cursor, setCursor] = useState<number>();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const periods = [
    { value: '30', label: t('traceLast30Minutes') }, { value: '60', label: t('traceLastHour') },
    { value: '120', label: t('traceLast2Hours') }, { value: '240', label: t('traceLast4Hours') },
    { value: '360', label: t('traceLast6Hours') }, { value: '480', label: t('traceLast8Hours') },
    { value: 'full', label: t('traceFull') },
  ];
  const time = useMemo(() => new Intl.DateTimeFormat(localeForLanguage[language], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }), [language]);
  const altitudeFactor = unitSystem === 'metric' ? .3048 : 1;
  const speedFactor = unitSystem === 'metric' ? 1.852 : unitSystem === 'imperial' ? 1.150779 : 1;
  const altitude = useMemo(() => profileSeries(points, 'altitudeFt', altitudeFactor, 24, 46), [altitudeFactor, points]);
  const speed = useMemo(() => profileSeries(points, 'groundSpeedKts', speedFactor, 113, 46), [points, speedFactor]);
  const altitudeUnit = unitSystem === 'metric' ? 'm' : 'ft';
  const speedUnit = unitSystem === 'metric' ? 'km/h' : unitSystem === 'imperial' ? 'mph' : 'kt';
  const index = cursor === undefined ? points.length - 1 : nearestTracePoint(points, cursor);
  const current = points[index];
  const readable = (key: 'altitudeFt' | 'groundSpeedKts', factor: number, unit: string) =>
    `${formatNumber(current && !current.stale && current[key] !== undefined ? current[key]! * factor : undefined, language)} ${unit}`;
  const altitudeReading = readable('altitudeFt', altitudeFactor, altitudeUnit);
  const speedReading = readable('groundSpeedKts', speedFactor, speedUnit);
  const showPoint = (index: number) => {
    const point = points[index];
    if (!point) return;
    setCursor(point.timestamp);
    onHighlight(point);
  };
  const clear = () => { setCursor(undefined); onHighlight(); };
  const pointAtPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (event.type === 'pointermove' && event.pointerType !== 'mouse' && !event.buttons) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const proportion = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 320 - 42) / 266));
    const start = points[0].timestamp;
    showPoint(nearestTracePoint(points, start + proportion * (points.at(-1)!.timestamp - start)));
  };
  useEffect(() => () => onHighlight(), [onHighlight]);

  return (
    <section className="flight-profile" aria-label={t('flightProfile')}>
      <h3 className="profile-heading">
        <button type="button" className="profile-toggle" aria-expanded={open} aria-controls={contentId}
          onClick={() => { clear(); setOpen((value) => !value); }}>
          <span>{t('flightProfile')}</span>
          {(!open || historyOpen) && <small>{historyOpen ? t('profileHistory') : periods.find((item) => item.value === String(period))?.label}</small>}
          <VectorIcon name="chevronDown" />
        </button>
      </h3>
      <div id={contentId} hidden={!open}>
      {open && <>
      {!historyOpen && <div className="profile-controls">
        <select aria-label={t('profilePeriod')} value={String(period)} onChange={(event) => { clear(); onPeriodChange(parseLegTracePeriod(event.target.value)); }}>
          {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>}
      {points.length < 2 ? <p className="profile-empty" role="status">{t(loading ? 'profileLoading' : 'profileUnavailable')}</p> : <>
        <svg className="profile-chart" viewBox="0 0 320 182" role="img" aria-label={`${t('altitude')} / ${t('groundSpeed')}`}
          onPointerDown={pointAtPointer} onPointerMove={pointAtPointer} onPointerLeave={(event) => {
            if (event.pointerType === 'mouse' && !event.currentTarget.parentElement?.contains(document.activeElement)) clear();
          }}>
          {[{ series: altitude, top: 24, bottom: 70, unit: altitudeUnit, name: 'altitude', label: t('altitude'), reading: altitudeReading }, { series: speed, top: 113, bottom: 159, unit: speedUnit, name: 'speed', label: t('groundSpeed'), reading: speedReading }].map(({ series, top, bottom, unit, name, label, reading }) => <g key={name} className={`profile-series profile-${name}`}>
            <text x="42" y={top - 10}>{label} · {unit}</text>
            {cursor !== undefined && <text className="profile-reading" x="308" y={top - 10} textAnchor="end">{reading}</text>}
            {[{ y: top, value: series.maximum }, { y: bottom, value: series.minimum }].map(({ y, value }) => <g key={y}>
              <line className="profile-grid" x1="42" x2="308" y1={y} y2={y} />
              <text x="34" y={y + 4} textAnchor="end">{formatNumber(value, language)}</text>
            </g>)}
            <path d={series.path} fill="none" vectorEffect="non-scaling-stroke" />
            {!series.hasData && <text x="175" y={(top + bottom) / 2 + 4} textAnchor="middle">{t('profileNoData')}</text>}
            {current && series.valid(current) && <circle cx={series.x(current)} cy={series.y(current)} r="3" />}
          </g>)}
          {cursor !== undefined && current && <line className="profile-cursor" x1={altitude.x(current)} x2={altitude.x(current)} y1="19" y2="163" />}
          <text x="42" y="180">{time.format(points[0].timestamp * 1_000).slice(0, 5)}</text>
          <text x="308" y="180" textAnchor="end">{time.format(points.at(-1)!.timestamp * 1_000).slice(0, 5)}</text>
        </svg>
        <div className="profile-timeline">
          <input type="range" min={points[0].timestamp} max={points.at(-1)!.timestamp} step="any" value={current.timestamp} aria-label={t('profilePosition')}
            aria-valuetext={`${time.format(current.timestamp * 1_000)}, ${altitudeReading}, ${speedReading}`}
            onChange={(event) => showPoint(nearestTracePoint(points, Number(event.target.value)))} onFocus={() => showPoint(index)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, index - 1);
              else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(points.length - 1, index + 1);
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = points.length - 1;
              else return;
              event.preventDefault();
              showPoint(next);
            }} />
          <time dateTime={new Date(current.timestamp * 1_000).toISOString()}>{time.format(current.timestamp * 1_000)}</time>
        </div>
      </>}
      </>}
      </div>
    </section>
  );
}
