import type { Aircraft, FeedStatus, Receiver } from '../domain/aircraft';
import { receiverStatistics } from '../domain/receiver-statistics';
import { localeForLanguage, translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';

type ReceiverDashboardProps = {
  aircraft: readonly Aircraft[];
  lastUpdate?: number;
  language: Language;
  latitude: number;
  longitude: number;
  messageCount: number;
  messageRate: number;
  onClose: () => void;
  receiver?: Receiver;
  receiverName: string;
  status: FeedStatus;
  statusLabel: string;
};

export function ReceiverDashboard({
  aircraft,
  lastUpdate,
  language,
  latitude,
  longitude,
  messageCount,
  messageRate,
  onClose,
  receiver,
  receiverName,
  status,
  statusLabel,
}: ReceiverDashboardProps) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const number = new Intl.NumberFormat(localeForLanguage[language]);
  const time = new Intl.DateTimeFormat(localeForLanguage[language], { timeStyle: 'medium' });
  const statistics = receiverStatistics(aircraft);
  const sources = [
    { label: 'ADS-B', value: statistics.adsb },
    { label: 'MLAT', value: statistics.mlat },
    { label: 'Mode S', value: statistics.modeS },
    { label: t('otherSources'), value: statistics.other },
  ];
  const availability = (enabled: boolean) => (
    <span className={`receiver-capability-state ${enabled ? 'available' : ''}`}>
      <i /> {t(enabled ? 'available' : 'unavailable')}
    </span>
  );

  return (
    <section className="receiver-dashboard" role="dialog" aria-label={t('receiverDashboard')}>
      <header className="receiver-dashboard-heading">
        <span className="receiver-dashboard-icon"><VectorIcon name="receiver" /></span>
        <div>
          <h2>{t('receiverDashboard')}</h2>
          <span>{receiverName}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t('closeReceiverDashboard')} title={t('closeReceiverDashboard')}>
          <VectorIcon name="close" />
        </button>
      </header>

      <div className="receiver-dashboard-live">
        <span className={`receiver-dashboard-status ${status}`}><i /> {statusLabel}</span>
        <small>{t('lastUpdate')}: {lastUpdate ? time.format(lastUpdate) : '—'}</small>
      </div>

      <div className="receiver-dashboard-metrics">
        <article><span>{t('trackedAircraft')}</span><strong>{number.format(statistics.total)}</strong></article>
        <article><span>{t('positionedAircraft')}</span><strong>{number.format(statistics.positioned)}</strong></article>
        <article><span>{t('airborne')}</span><strong>{number.format(statistics.airborne)}</strong></article>
        <article><span>{t('ground')}</span><strong>{number.format(statistics.ground)}</strong></article>
      </div>

      <section className="receiver-dashboard-section">
        <h3>{t('dataReception')}</h3>
        <div className="receiver-dashboard-data">
          <div><span>{t('messageRate')}</span><strong>{lastUpdate ? number.format(messageRate) : '—'} <small>msg/s</small></strong></div>
          <div><span>{t('messageCount')}</span><strong>{lastUpdate ? number.format(messageCount) : '—'}</strong></div>
        </div>
      </section>

      <section className="receiver-dashboard-section">
        <h3>{t('dataSources')}</h3>
        <div className="receiver-source-list">
          {sources.map((source) => {
            const share = statistics.total > 0 ? source.value / statistics.total * 100 : 0;
            return (
              <div className="receiver-source" key={source.label}>
                <span>{source.label}</span>
                <i><b style={{ width: `${share}%` }} /></i>
                <strong>{number.format(source.value)}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <section className="receiver-dashboard-section">
        <h3>{t('receiverDetails')}</h3>
        <dl className="receiver-dashboard-details">
          <div><dt>{t('receiverLocation')}</dt><dd>{latitude.toFixed(4)}°, {longitude.toFixed(4)}°</dd></div>
          <div><dt>{t('updateInterval')}</dt><dd>{receiver ? `${number.format(receiver.refreshMs)} ms` : '—'}</dd></div>
          <div><dt>readsb</dt><dd>{receiver?.version ?? '—'}</dd></div>
          <div><dt>{t('historyFiles')}</dt><dd>{receiver ? number.format(receiver.historyCount) : '—'}</dd></div>
        </dl>
      </section>

      <section className="receiver-dashboard-section">
        <h3>{t('receiverCapabilities')}</h3>
        <div className="receiver-capabilities">
          <div><span>{t('historyReplay')}</span>{availability(receiver?.haveReplay === true)}</div>
          <div><span>{t('actualRangeOutline')}</span>{availability(receiver?.outlineJson === true)}</div>
        </div>
      </section>
    </section>
  );
}
