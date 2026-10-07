'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../i18n';
import { vectorVersion, vectorRevision } from '../version';
import { VectorIcon } from './vector-icon';

type Build = { version: string; revision: string };
type UpdateStatus = { enabled: boolean; ready?: boolean; authenticated?: boolean; current?: Build; phase?: string; error?: string | null; available?: Build | null; checkedAt?: number | null };
const activePhases = new Set(['downloading', 'building', 'activating', 'verifying', 'restoring']);
const words = {
  nl: {
    title: 'Updates', close: 'Updates sluiten', current: 'Geïnstalleerd', available: 'Beschikbaar', password: 'Beheerwachtwoord', login: 'Ontgrendelen', logout: 'Vergrendelen', check: 'Controleren op updates', update: 'Bijwerken', confirm: 'Update installeren', cancel: 'Annuleren', reload: 'Pagina vernieuwen',
    confirmation: 'Vector blijft beschikbaar tijdens het bouwen en wordt daarna kort herstart.',
    latest: 'Je installatie is bijgewerkt.', complete: 'Update geïnstalleerd.', reconnecting: 'Verbinding wordt hersteld… De update draait op de server door.',
    phases: { checking: 'Controleren op updates…', downloading: 'Update downloaden…', building: 'Nieuwe versie bouwen…', activating: 'Vector herstarten…', verifying: 'Installatie controleren…', restoring: 'Vorige installatie herstellen…' },
    errors: { disabled: 'Updates zijn uitgeschakeld door de beheerder.', unauthorized: 'Ontgrendel opnieuw om verder te gaan.', invalid_password: 'Onjuist beheerwachtwoord.', rate_limited: 'Te veel pogingen. Probeer het over 15 minuten opnieuw.', check_limited: 'Wacht een minuut voordat je opnieuw controleert.', check_failed: 'Updates konden niet worden opgehaald. Probeer later opnieuw.', service_unavailable: 'De updateservice is niet bereikbaar. Voer de nieuwste installer uit op deze server.', password_not_configured: 'Stel eerst een beheerwachtwoord in op de server.', unmanaged_installation: 'Updates zijn beschikbaar na installatie met de officiële Vector-installer.', check_required: 'Controleer opnieuw voordat je deze update installeert.', busy: 'Er wordt al een update uitgevoerd.', update_failed: 'Update mislukt. Controleer de installerlogs voordat je opnieuw probeert.', recovery_required: 'Herstel vraagt aandacht. Voer de installer opnieuw uit op de server.', invalid_origin: 'Dit adres is niet toegestaan voor beheeracties. Controleer de reverse-proxyconfiguratie.', invalid_request: 'De aanvraag is ongeldig.' },
  },
  en: {
    title: 'Updates', close: 'Close updates', current: 'Installed', available: 'Available', password: 'Administrator password', login: 'Unlock', logout: 'Lock', check: 'Check for updates', update: 'Update', confirm: 'Install update', cancel: 'Cancel', reload: 'Reload page',
    confirmation: 'Vector remains available during the build, then briefly restarts.',
    latest: 'Your installation is up to date.', complete: 'Update installed.', reconnecting: 'Reconnecting… The update continues on the server.',
    phases: { checking: 'Checking for updates…', downloading: 'Downloading update…', building: 'Building new version…', activating: 'Restarting Vector…', verifying: 'Checking installation…', restoring: 'Restoring previous installation…' },
    errors: { disabled: 'Updates are disabled by the administrator.', unauthorized: 'Unlock again to continue.', invalid_password: 'Incorrect administrator password.', rate_limited: 'Too many attempts. Try again in 15 minutes.', check_limited: 'Wait a minute before checking again.', check_failed: 'Updates could not be retrieved. Try again later.', service_unavailable: 'The update service is unavailable. Run the latest installer on this server.', password_not_configured: 'Set an administrator password on the server first.', unmanaged_installation: 'Updates require installation using the official Vector installer.', check_required: 'Check again before installing this update.', busy: 'An update is already running.', update_failed: 'Update failed. Check the installer logs before trying again.', recovery_required: 'Recovery needs attention. Run the installer again on the server.', invalid_origin: 'This address is not allowed for administration. Check the reverse proxy configuration.', invalid_request: 'The request is invalid.' },
  },
};

export function UpdateMenu({ language }: { language: Language }) {
  const text = words[language];
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const refreshing = useRef(false);
  const running = activePhases.has(status?.phase || '');
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch('/api/updates', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const next = await response.json() as UpdateStatus;
      // A restart can briefly make the bridge unreachable. Retain the last known progress.
      if (!response.ok) {
        setStatus((previous) => previous && activePhases.has(previous.phase || '') ? previous : next);
        setDisconnected(true);
      } else {
        setStatus(next); setDisconnected(false);
        if (!next.enabled) { setOpen(false); setPassword(''); setConfirm(false); }
      }
    } catch { setDisconnected(true); }
    finally { refreshing.current = false; }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => { window.clearInterval(timer); element?.close(); };
  }, [open, refresh]);

  const close = () => {
    setOpen(false); setPassword(''); setConfirm(false); setError(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.settings-menu summary')?.focus());
  };
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/updates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }), signal: AbortSignal.timeout(40_000) });
      const result = await response.json();
      if (!response.ok) setError(result.error || 'service_unavailable');
      else {
        if (action === 'apply') { setConfirm(false); setStatus((previous) => ({ ...previous!, phase: 'downloading', error: null })); }
        await refresh();
      }
    } catch { setError('service_unavailable'); }
    finally { setBusy(false); setPassword(''); }
  };

  if (!status?.enabled) return null;
  const phase = status.phase as keyof typeof text.phases;
  const failure = error || status.error;
  const errorText = failure ? text.errors[failure as keyof typeof text.errors] || text.errors.service_unavailable : null;
  const current = status.current || { version: vectorVersion, revision: vectorRevision };
  const formatBuild = (build: Build) => `${build.version || vectorVersion}${build.revision ? ` · ${build.revision.slice(0, 7)}` : ''}`;
  return <>
    <button className="settings-update-button" type="button" onClick={() => { setOpen(true); void refresh(); }}>{text.title}<span aria-hidden="true">→</span></button>
    {open && createPortal(
      <dialog ref={dialog} className="update-dialog" aria-labelledby="update-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); } }}>
        <header><h2 id="update-dialog-title">{text.title}</h2><button type="button" aria-label={text.close} onClick={close}><VectorIcon name="close" /></button></header>
        <div className="update-dialog-body">
          <dl className="update-builds"><div><dt>{text.current}</dt><dd>{formatBuild(current)}</dd></div>{status.authenticated && status.available && <div><dt>{text.available}</dt><dd>{formatBuild(status.available)}</dd></div>}</dl>
          {errorText && <p role="alert" className="update-error">{errorText}</p>}
          <div aria-live="polite" role="status">
            {(running || status.phase === 'checking') && <p className="update-progress">{disconnected ? text.reconnecting : text.phases[phase]}</p>}
            {status.phase === 'complete' && <p>{text.complete}</p>}
            {status.checkedAt && !status.available && status.phase === 'idle' && !errorText && <p>{text.latest}</p>}
          </div>
          {status.phase === 'complete' && <button className="update-primary" type="button" onClick={() => window.location.reload()}>{text.reload}</button>}
          {!status.authenticated && status.ready && !running && <form onSubmit={(event) => { event.preventDefault(); void act('login', { password }); }}>
            <label htmlFor="update-admin-password">{text.password}</label>
            <input id="update-admin-password" type="password" autoComplete="current-password" value={password} maxLength={128} onChange={(event) => setPassword(event.target.value)} required />
            <button className="update-primary" disabled={busy || !password} type="submit">{text.login}</button>
          </form>}
          {status.authenticated && <>
            {confirm && <p>{text.confirmation}</p>}
            <div className="update-actions">
              {confirm ? <><button className="update-primary" type="button" disabled={busy || running} onClick={() => void act('apply', { revision: status.available?.revision, confirm: true })}>{text.confirm}</button><button type="button" disabled={busy} onClick={() => setConfirm(false)}>{text.cancel}</button></>
                : <><button type="button" disabled={busy || running || !status.ready} onClick={() => void act('check')}>{text.check}</button>{status.available && <button className="update-primary" type="button" disabled={busy || running} onClick={() => setConfirm(true)}>{text.update}</button>}</>}
            </div>
            {!running && <button className="update-lock" type="button" disabled={busy} onClick={() => { setConfirm(false); void act('logout'); }}>{text.logout}</button>}
          </>}
        </div>
      </dialog>, document.body)}
  </>;
}
