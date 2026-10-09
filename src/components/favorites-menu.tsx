'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadAircraftMetadata } from '../data/readsb';
import type { Aircraft, AircraftMetadata, FeedStatus } from '../domain/aircraft';
import { favoriteAircraftOverview } from '../domain/favorite-aircraft-overview';
import { normalizeFavoriteCallsign } from '../domain/favorite-aircraft';
import { localeForLanguage, translate, type Language } from '../i18n';
import { VectorIcon } from './vector-icon';

const pageSize = 10;

function FavoriteRemovalConfirmation({ label, language, onCancel, onConfirm }: {
  label: string; language: Language; onCancel: () => void; onConfirm: () => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="favorites-dialog favorites-confirm-dialog" role="alertdialog"
    aria-labelledby="favorites-remove-title" aria-describedby="favorites-remove-aircraft"
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
    }}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onCancel(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onCancel();
    }}>
    <header><h2 id="favorites-remove-title">{t('favoritesRemoveTitle')}</h2></header>
    <p id="favorites-remove-aircraft">{label}</p>
    <footer>
      <button ref={cancel} type="button" onClick={onCancel}>{t('cancel')}</button>
      <button type="button" className="favorites-confirm-remove" onClick={onConfirm}>{t('favoritesRemove')}</button>
    </footer>
  </dialog>;
}

export function FavoritesMenu({ language, favorites, callsigns, aircraft, status, onRemove, onSelect, onAddCallsign, onRemoveCallsign }: {
  language: Language; favorites: ReadonlySet<string>; callsigns: ReadonlySet<string>; aircraft: readonly Aircraft[]; status: FeedStatus;
  onRemove: (id: string) => void; onSelect: (id: string) => void;
  onAddCallsign: (callsign: string) => void; onRemoveCallsign: (callsign: string) => void;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; label: string; callsign?: string } | null>(null);
  const [newCallsign, setNewCallsign] = useState('');
  const [addError, setAddError] = useState<'favoritesCallsignInvalid' | 'favoritesCallsignDuplicate' | 'favoritesCallsignLimit'>();
  const [lookup, setLookup] = useState({ records: new Map<string, AircraftMetadata>(), failed: false, key: '' });
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const removeButton = useRef<HTMLButtonElement | null>(null);
  const favoriteKey = [...favorites].sort().join(',');
  const count = favorites.size + callsigns.size;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const allIds = favoriteKey ? favoriteKey.split(',') : [];
    const ids = allIds.filter((id) => /^[a-f0-9]{6}$/.test(id));
    // Load bounded batches only while the overview is open. A failed lookup must never hide a favorite.
    const load = async () => {
      const records = new Map<string, AircraftMetadata>();
      try {
        for (let offset = 0; offset < ids.length; offset += 100) {
          const batch = await loadAircraftMetadata(ids.slice(offset, offset + 100), AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
          if (controller.signal.aborted) return;
          for (const id of ids.slice(offset, offset + 100)) {
            const record = batch.get(id);
            if (record) records.set(id, record);
          }
        }
        if (!controller.signal.aborted) setLookup({ records, failed: false, key: favoriteKey });
      } catch {
        if (!controller.signal.aborted) setLookup((previous) => ({
          records: new Map(allIds.flatMap((id) => {
            const record = records.get(id) ?? previous.records.get(id);
            return record ? [[id, record] as const] : [];
          })), failed: true, key: favoriteKey,
        }));
      }
    };
    void load();
    return () => controller.abort();
  }, [open, favoriteKey, retry]);

  const matches = useMemo(() => {
    if (!open) return [];
    const query = search.trim().toLowerCase();
    const collator = new Intl.Collator(localeForLanguage[language], { numeric: true, sensitivity: 'base' });
    return favoriteAircraftOverview([...favorites], aircraft, lookup.records, status, [...callsigns])
      .filter((entry) => [entry.id, entry.registration, entry.aircraftType, entry.description, entry.flight]
        .some((value) => value?.toLowerCase().includes(query)))
      .sort((a, b) => collator.compare(a.callsign || a.registration || a.id, b.callsign || b.registration || b.id) || a.id.localeCompare(b.id));
  }, [open, favorites, callsigns, aircraft, lookup.records, status, search, language]);
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = matches.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const close = (restoreFocus = true) => {
    setPendingRemoval(null);
    setNewCallsign('');
    setAddError(undefined);
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    searchInput.current?.focus({ preventScroll: true });
    return () => element?.close();
  }, [open]);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [currentPage, search]);

  return <>
    <button ref={trigger} type="button" className="favorites-menu-button" aria-label={t('favoritesOpen')}
      title={t('favorites')} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setSearch(''); setPage(1); setOpen(true); }}><VectorIcon name="favorite" /></button>
    {open && createPortal(<dialog ref={dialog} className="favorites-dialog" aria-labelledby="favorites-title"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
      }}>
      <header><h2 id="favorites-title">{t('favorites')} <span aria-hidden="true">{count}</span></h2>
        <button type="button" aria-label={t('favoritesClose')} onClick={() => close()}><VectorIcon name="close" /></button></header>
      <div ref={content} className="favorites-content">
        <label className="favorites-search"><VectorIcon name="search" /><input ref={searchInput} type="search" maxLength={80}
          aria-label={t('favoritesSearch')} placeholder={t('favoritesSearch')} value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <form className="favorites-add" onSubmit={(event) => {
          event.preventDefault();
          const callsign = normalizeFavoriteCallsign(newCallsign);
          if (!callsign) { setAddError('favoritesCallsignInvalid'); return; }
          if (callsigns.has(callsign)) { setAddError('favoritesCallsignDuplicate'); return; }
          if (callsigns.size >= 2_000) { setAddError('favoritesCallsignLimit'); return; }
          onAddCallsign(callsign);
          setNewCallsign(''); setAddError(undefined); setSearch(callsign); setPage(1);
          searchInput.current?.focus({ preventScroll: true });
        }}>
          <label htmlFor="favorite-callsign">{t('favoritesAddCallsign')}</label>
          <div><input id="favorite-callsign" type="text" value={newCallsign} maxLength={16} placeholder="KLM123"
            autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={!!addError}
            aria-describedby={addError ? 'favorite-callsign-error' : undefined}
            onChange={(event) => { setNewCallsign(event.target.value); setAddError(undefined); }} />
            <button type="submit" disabled={!newCallsign.trim()}>{t('favoritesAdd')}</button></div>
          {addError && <p id="favorite-callsign-error" role="alert">{t(addError)}</p>}
        </form>
        {lookup.failed && lookup.key === favoriteKey && <div className="favorites-notice" role="status">
          <span>{t('favoritesMetadataUnavailable')}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>{t('favoritesRetry')}</button>
        </div>}
        {visible.length === 0 ? <p className="favorites-empty">{t(count === 0 ? 'favoritesEmpty' : 'logbookNoResults')}</p>
          : <ul className="favorites-list">{visible.map((entry) => <li key={entry.id} data-aircraft-id={entry.id}>
            <button type="button" className="favorites-remove" aria-label={`${t('removeFromFavorites')}: ${entry.callsign || entry.registration || entry.id.toUpperCase()}`}
              title={t('removeFromFavorites')} onClick={(event) => {
                removeButton.current = event.currentTarget;
                setPendingRemoval({ id: entry.id, callsign: entry.callsign,
                  label: entry.callsign || (entry.registration ? `${entry.registration} · ${entry.id.toUpperCase()}` : entry.id.toUpperCase()) });
              }}><VectorIcon name="favorite" /></button>
            <div className="favorites-identity">
              <strong>{entry.callsign || entry.registration || entry.id.toUpperCase()}</strong>
              <span>{(entry.callsign ? [t('callsign'), entry.registration, entry.aircraftType]
                : [entry.flight, entry.aircraftType || t('unknownType'), entry.registration ? entry.id.toUpperCase() : undefined]).filter(Boolean).join(' · ')}</span>
              <small className={entry.live ? 'is-live' : ''}>{entry.live ? 'Live' : t('favoritesNotLive')}</small>
            </div>
            {entry.liveAircraftId && <button type="button" className="favorites-view" aria-label={`${t('details')}: ${entry.callsign || entry.registration || entry.id.toUpperCase()}`}
              onClick={() => { close(false); onSelect(entry.liveAircraftId!); }}>{t('details')} <VectorIcon name="chevronRight" /></button>}
          </li>)}</ul>}
      </div>
      {pages > 1 && <footer><nav aria-label={t('favoritesPages')}>
        <button type="button" disabled={currentPage === 1} aria-label={t('logbookPrevious')} onClick={() => setPage(currentPage - 1)}><VectorIcon name="chevronLeft" /></button>
        <span>{currentPage} / {pages}</span>
        <button type="button" disabled={currentPage === pages} aria-label={t('logbookNext')} onClick={() => setPage(currentPage + 1)}><VectorIcon name="chevronRight" /></button>
      </nav></footer>}
      {pendingRemoval && <FavoriteRemovalConfirmation label={pendingRemoval.label} language={language}
        onCancel={() => {
          setPendingRemoval(null);
          requestAnimationFrame(() => (removeButton.current?.isConnected ? removeButton.current : searchInput.current)?.focus({ preventScroll: true }));
        }}
        onConfirm={() => {
          // Another synchronized device may already have removed this favorite.
          if (pendingRemoval.callsign) onRemoveCallsign(pendingRemoval.callsign);
          else if (favorites.has(pendingRemoval.id)) onRemove(pendingRemoval.id);
          setPendingRemoval(null);
          requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }));
        }} />}
    </dialog>, document.body)}
  </>;
}
