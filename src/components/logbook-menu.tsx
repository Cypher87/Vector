'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { logbookPageSize, type LogbookResponse } from '../domain/logbook';
import { formatLogbookDuration } from '../domain/logbook-duration';
import { localeForLanguage, translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';

// Keep receiver API batches unchanged, including when connected to an older Vector server.
const resultsPerPage = 10;

function useLogbook(enabled: boolean, query: string, favorites?: string) {
  const requestKey = `${query}|${favorites ?? ''}`;
  const [result, setResult] = useState<{ query: string; data?: LogbookResponse; failed?: boolean; recording?: boolean }>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/logbook?${query}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          ...(favorites === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"favorites":${favorites}}` }),
        });
        if (!response.ok) throw new Error('Logbook unavailable');
        const data = await response.json() as LogbookResponse;
        if (!Array.isArray(data.entries) || !Number.isInteger(data.total)) throw new Error('Invalid response');
        if (!controller.signal.aborted) setResult({ query: requestKey, data, recording: !!data.updatedAt && Date.now() - data.updatedAt < 60_000 });
      } catch {
        if (!controller.signal.aborted) setResult((previous) => ({ query: requestKey, data: previous?.query === requestKey ? previous.data : undefined, failed: true }));
      } finally { pending = false; }
    };
    const debounce = setTimeout(() => { void load(); }, 250);
    const refresh = setInterval(() => { void load(); }, 30_000);
    return () => { controller.abort(); clearTimeout(debounce); clearInterval(refresh); };
  }, [enabled, query, favorites, requestKey]);
  return enabled && result?.query === requestKey ? result : undefined;
}

function LogbookVisits({ hex, days, language }: { hex: string; days: number; language: Language }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const result = useLogbook(true, `hex=${hex}&days=${days}`);
  const date = new Intl.DateTimeFormat(localeForLanguage[language], { dateStyle: 'medium', timeStyle: 'short' });
  return <div className="logbook-visits">
    <h3>{t('logbookRecentVisits')}</h3>
    {result?.failed ? <p role="alert">{t('logbookUnavailable')}</p> : !result?.data ? <p role="status">{t('logbookLoading')}</p>
      : <ol>{result.data.visits?.map((visit) => <li key={visit.firstSeen}>
        <span>{date.format(visit.firstSeen)} — {date.format(visit.lastSeen)}</span>
        <div className="logbook-visit-meta"><strong>{visit.callsigns || '—'}</strong>
          <dl className="logbook-visit-duration"><dt>{t('logbookDuration')}</dt>
            <dd>{formatLogbookDuration(visit.firstSeen, visit.lastSeen, language)}</dd></dl>
        </div>
      </li>)}</ol>}
  </div>;
}

export function LogbookMenu({ language, favorites, liveIds, onFavorite, onSelect }: {
  language: Language; favorites: ReadonlySet<string>; liveIds: ReadonlySet<string>;
  onFavorite: (id: string) => void; onSelect: (id: string) => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState(90);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('recent');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const receiverPage = Math.floor((page - 1) * resultsPerPage / logbookPageSize) + 1;
  const query = new URLSearchParams({ q: search.trim(), days: String(days), page: String(receiverPage), sort }).toString();
  const favoriteFilter = favoritesOnly ? JSON.stringify([...favorites].filter((id) => /^[a-f0-9]{6}$/.test(id)).sort()) : undefined;
  const result = useLogbook(open, query, favoriteFilter);
  const data = result?.data;
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / resultsPerPage));
  const currentPage = Math.min(page, pageCount);
  const entryOffset = data ? (currentPage - 1) * resultsPerPage - (data.page - 1) * data.pageSize : 0;
  const entries = data?.entries.slice(entryOffset, entryOffset + resultsPerPage);
  const date = new Intl.DateTimeFormat(localeForLanguage[language], { dateStyle: 'medium', timeStyle: 'short' });
  const close = () => { setOpen(false); setExpanded(null); requestAnimationFrame(() => button.current?.focus()); };
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [query, favoriteFilter, page]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    searchInput.current?.focus({ preventScroll: true });
    return () => element?.close();
  }, [open]);
  return <>
    <button ref={button} type="button" className="settings-button" aria-label={t('logbookOpen')} title={t('logbook')} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}><VectorIcon name="logbook" /></button>
    {open && createPortal(<dialog ref={dialog} className="logbook-dialog" aria-labelledby="logbook-title"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
      }}>
      <header><h2 id="logbook-title">{t('logbook')}</h2>
        <button type="button" aria-label={t('logbookClose')} onClick={close}><VectorIcon name="close" /></button></header>
      <div className="logbook-content" ref={content}>
      <div className="logbook-toolbar">
      <div className="logbook-controls">
        <label className="logbook-search"><VectorIcon name="search" /><input ref={searchInput} type="search" maxLength={80}
          aria-label={t('logbookSearch')} placeholder={t('logbookSearch')} value={search} onChange={(event) => {
            setSearch(event.target.value); setPage(1); setExpanded(null);
          }} /></label>
        <label><span>{t('logbookPeriod')}</span><span className="logbook-select"><select value={days} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); setExpanded(null); }}>
          {[1, 7, 30, 90].map((value) => <option key={value} value={value}>{value === 1 ? t('logbookDay') : `${value} ${t('logbookDays')}`}</option>)}</select><VectorIcon name="chevronDown" /></span></label>
        <label><span>{t('logbookSort')}</span><span className="logbook-select"><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); setExpanded(null); }}>
          <option value="recent">{t('logbookRecent')}</option><option value="visits">{t('logbookFrequent')}</option></select><VectorIcon name="chevronDown" /></span></label>
      </div>
      <div className="logbook-toolbar-meta">
        <button type="button" className="logbook-filter-toggle" aria-pressed={favoritesOnly} onClick={() => {
          setFavoritesOnly(!favoritesOnly); setPage(1); setExpanded(null);
        }}><VectorIcon name="favorite" />{t('favoritesOnly')}</button>
      <div className="logbook-summary" role="status">
        <strong>{data ? `${data.total} ${t(data.total === 1 ? 'logbookAircraftSingular' : 'logbookAircraft')}` : result?.failed ? '—' : t('logbookLoading')}</strong>
        {data && !result?.failed && !result?.recording && <span>{t('logbookPaused')}</span>}
      </div>
      </div>
      </div>
      <div className="logbook-body" aria-busy={!result}>
        {result?.failed && <p className="logbook-notice" role="alert">{t('logbookUnavailable')}</p>}
        {data?.entries.length === 0 && <div className="logbook-empty"><VectorIcon name="logbook" />
          <h3>{favoritesOnly ? t('logbookNoFavorites') : search ? t('logbookNoResults') : t('logbookEmpty')}</h3></div>}
        {entries?.map((entry) => <article className={`logbook-entry${expanded === entry.hex ? ' expanded' : ''}`} key={entry.hex}>
          <div className="logbook-entry-heading">
            <button type="button" className={`logbook-favorite ${favorites.has(entry.hex) ? 'active' : ''}`}
              aria-label={`${t('logbookFavorite')}: ${entry.registration || entry.hex}`} aria-pressed={favorites.has(entry.hex)} onClick={() => onFavorite(entry.hex)}><VectorIcon name="favorite" /></button>
            <button type="button" className="logbook-identity" aria-expanded={expanded === entry.hex}
              aria-controls={`logbook-visits-${entry.hex}`} onClick={() => setExpanded(expanded === entry.hex ? null : entry.hex)}>
              <strong>{entry.registration || entry.hex.toUpperCase()} <VectorIcon name="chevronDown" /></strong><span>{entry.callsign || '—'} · {entry.aircraftType || t('logbookUnknownType')}</span>
            </button>
            <span className="logbook-visit-count"><strong>{entry.visits}</strong>{t(entry.visits === 1 ? 'logbookVisitSingular' : 'logbookVisits')}</span>
          </div>
          <dl className="logbook-times"><div><dt>{t('logbookFirst')}</dt><dd>{date.format(entry.firstSeen)}</dd></div>
            <div><dt>{t('logbookLast')}</dt><dd>{date.format(entry.lastSeen)}</dd></div></dl>
          {expanded === entry.hex && <div className="logbook-entry-details" id={`logbook-visits-${entry.hex}`}>
            <div className="logbook-aircraft-info"><span>{entry.hex.toUpperCase()} · {entry.description || entry.aircraftType || '—'}</span>
              {liveIds.has(entry.hex) && <button type="button" onClick={() => { close(); onSelect(entry.hex); }}>{t('logbookShowLive')} <span aria-hidden="true">↗</span></button>}</div>
            <LogbookVisits hex={entry.hex} days={days} language={language} />
          </div>}
        </article>)}
      </div>
      </div>
      {data && pageCount > 1 && <footer>
        <nav aria-label={t('logbookPages')}>
          <button type="button" disabled={currentPage <= 1} aria-label={t('logbookPrevious')} onClick={() => { setPage(currentPage - 1); setExpanded(null); }}><VectorIcon name="chevronLeft" /></button>
          <span>{currentPage} / {pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount} aria-label={t('logbookNext')} onClick={() => { setPage(currentPage + 1); setExpanded(null); }}><VectorIcon name="chevronRight" /></button>
        </nav>
      </footer>}
    </dialog>, document.body)}
  </>;
}
