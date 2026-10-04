import { useEffect, useState } from 'react';
import { aircraftDatabaseHealth, parseAircraftDatabaseStatus, type AircraftDatabaseStatus } from '../domain/aircraft-database-status';
import { localeForLanguage, translate, type Language } from '../i18n';

export function AircraftDatabasePanel({ language }: { language: Language }) {
  const [snapshot, setSnapshot] = useState<{ status: AircraftDatabaseStatus | null; failed: boolean }>({ status: null, failed: false });
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden' || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch('/api/aircraft-database-status', {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) throw new Error('Database status is unavailable');
        const status = parseAircraftDatabaseStatus(await response.json());
        if (!controller.signal.aborted) setSnapshot({ status, failed: false });
      } catch {
        if (!controller.signal.aborted) setSnapshot((previous) => ({ ...previous, failed: true }));
      } finally { pending = false; }
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const { status, failed } = snapshot;
  const health = failed ? 'unavailable' : status ? aircraftDatabaseHealth(status) : 'loading';
  const labels = {
    ready: 'databaseRecent', stale: 'databaseStale', missing: 'databaseMissing',
    external: 'databaseUnknown', unavailable: 'databaseUnavailable', loading: 'databaseLoading',
  } as const;
  const hints = { stale: 'databaseStaleHint', missing: 'databaseMissingHint', external: 'databaseExternalHint', unavailable: 'databaseUnavailableHint' } as const;
  const updatedAt = status?.updatedAt;
  const date = new Intl.DateTimeFormat(localeForLanguage[language], {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });

  return (
    <section className="receiver-dashboard-section receiver-database" aria-label={t('aircraftDatabase')}>
      <div className="receiver-database-heading">
        <h3>{t('aircraftDatabase')}</h3>
        <span className={`receiver-database-state ${health}`} role="status">{t(labels[health])}</span>
      </div>
      <div className="receiver-database-content">
        <span>{t('lastUpdate')}</span>
        {updatedAt ? <time dateTime={new Date(updatedAt).toISOString()}>{date.format(updatedAt)}</time> : <strong>—</strong>}
        {status?.records && (
          <div className="receiver-database-meta">
            <span>{new Intl.NumberFormat(localeForLanguage[language]).format(status.records)} {t('databaseRecords')}</span>
            <span>{t(status.location === 'receiver' ? 'databaseOnReceiver' : 'databaseOnServer')}</span>
          </div>
        )}
        {health in hints && <p>{t(hints[health as keyof typeof hints])}</p>}
      </div>
    </section>
  );
}
