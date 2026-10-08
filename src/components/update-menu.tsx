'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '../i18n';
import { vectorVersion, vectorRevision } from '../version';
import { VectorIcon } from './vector-icon';
import { activeUpdatePhases, type UpdateBuild } from '../domain/update-progress';
import { useUpdateStatus } from '../updates/use-update-status';

const words = {
  nl: {
    title: 'Updates', close: 'Updates sluiten', current: 'Geïnstalleerd', available: 'Beschikbaar', password: 'Beheerwachtwoord', login: 'Ontgrendelen', logout: 'Vergrendelen', check: 'Controleren op updates', update: 'Bijwerken', confirm: 'Update installeren', cancel: 'Annuleren',
    confirmation: 'Vector blijft beschikbaar tijdens het bouwen en wordt daarna kort herstart.',
    latest: 'Je installatie is bijgewerkt.', finishing: 'Update afgerond. Vector wordt opnieuw verbonden en de pagina vernieuwt automatisch…', reconnecting: 'Vector wordt herstart. Wachten tot de verbinding is hersteld…',
    reconnectTimeout: 'Vector is nog niet bereikbaar. De uitkomst van de update is nog onbekend. We blijven opnieuw verbinden; controleer de serverlogs als dit aanhoudt.',
    updateUnconfirmed: 'De update kon niet worden bevestigd. Controleer opnieuw op updates voordat je nog een installatie start.',
    phases: { checking: 'Controleren op updates…', downloading: 'Update downloaden…', building: 'Nieuwe versie bouwen…', activating: 'Vector herstarten…', verifying: 'Installatie controleren…', restoring: 'Vorige installatie herstellen…' },
    errors: { disabled: 'Updates zijn uitgeschakeld door de beheerder.', unauthorized: 'Ontgrendel opnieuw om verder te gaan.', invalid_password: 'Onjuist beheerwachtwoord.', rate_limited: 'Te veel pogingen. Probeer het over 15 minuten opnieuw.', check_limited: 'Wacht een minuut voordat je opnieuw controleert.', check_failed: 'Updates konden niet worden opgehaald. Probeer later opnieuw.', service_unavailable: 'De updateservice is niet bereikbaar. Voer de nieuwste installer uit op deze server.', password_not_configured: 'Stel eerst een beheerwachtwoord in op de server.', unmanaged_installation: 'Updates zijn beschikbaar na installatie met de officiële Vector-installer.', check_required: 'Controleer opnieuw voordat je deze update installeert.', busy: 'Er wordt al een update uitgevoerd.', update_failed: 'Update mislukt. Controleer de installerlogs voordat je opnieuw probeert.', recovery_required: 'Herstel vraagt aandacht. Voer de installer opnieuw uit op de server.', invalid_origin: 'Dit adres is niet toegestaan voor beheeracties. Controleer de reverse-proxyconfiguratie.', invalid_request: 'De aanvraag is ongeldig.' },
  },
  en: {
    title: 'Updates', close: 'Close updates', current: 'Installed', available: 'Available', password: 'Administrator password', login: 'Unlock', logout: 'Lock', check: 'Check for updates', update: 'Update', confirm: 'Install update', cancel: 'Cancel',
    confirmation: 'Vector remains available during the build, then briefly restarts.',
    latest: 'Your installation is up to date.', finishing: 'Update complete. Reconnecting to Vector; this page will refresh automatically…', reconnecting: 'Vector is restarting. Waiting for the connection to return…',
    reconnectTimeout: 'Vector is still unreachable. The update outcome is not yet known. We will keep reconnecting; check the server logs if this continues.',
    updateUnconfirmed: 'The update could not be confirmed. Check for updates again before starting another installation.',
    phases: { checking: 'Checking for updates…', downloading: 'Downloading update…', building: 'Building new version…', activating: 'Restarting Vector…', verifying: 'Checking installation…', restoring: 'Restoring previous installation…' },
    errors: { disabled: 'Updates are disabled by the administrator.', unauthorized: 'Unlock again to continue.', invalid_password: 'Incorrect administrator password.', rate_limited: 'Too many attempts. Try again in 15 minutes.', check_limited: 'Wait a minute before checking again.', check_failed: 'Updates could not be retrieved. Try again later.', service_unavailable: 'The update service is unavailable. Run the latest installer on this server.', password_not_configured: 'Set an administrator password on the server first.', unmanaged_installation: 'Updates require installation using the official Vector installer.', check_required: 'Check again before installing this update.', busy: 'An update is already running.', update_failed: 'Update failed. Check the installer logs before trying again.', recovery_required: 'Recovery needs attention. Run the installer again on the server.', invalid_origin: 'This address is not allowed for administration. Check the reverse proxy configuration.', invalid_request: 'The request is invalid.' },
  },
};

export function UpdateMenu({ language }: { language: Language }) {
  const text = words[language];
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const { status, busy, error, setError, disconnected, watching, settling, refresh, act: requestAction } = useUpdateStatus(open);
  const running = watching || activeUpdatePhases.has(status?.phase || '');

  useEffect(() => {
    if (status?.enabled !== false) return;
    const timer = window.setTimeout(() => { setOpen(false); setPassword(''); setConfirm(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [status?.enabled]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, [open]);

  const close = () => {
    setOpen(false); setPassword(''); setConfirm(false); setError(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.settings-menu summary')?.focus());
  };
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (action === 'apply') setConfirm(false);
    await requestAction(action, extra);
    setPassword('');
  };

  if (!status?.enabled) return null;
  const phase = status.phase as keyof typeof text.phases;
  // Locked visitors only see their own password-validation feedback, never installer status.
  const failure = status.authenticated ? error || status.error
    : error === 'invalid_password' || error === 'rate_limited' ? error : null;
  const errorText = failure === 'reconnect_timeout' ? text.reconnectTimeout : failure === 'update_unconfirmed' ? text.updateUnconfirmed
    : failure ? text.errors[failure as keyof typeof text.errors] || text.errors.service_unavailable : null;
  const current = status.current || { version: vectorVersion, revision: vectorRevision };
  const formatBuild = (build: UpdateBuild) => `${build.version || vectorVersion}${build.revision ? ` · ${build.revision.slice(0, 7)}` : ''}`;
  return <>
    <button className="settings-update-button" type="button" onClick={() => { setOpen(true); void refresh(); }}>{text.title}<span aria-hidden="true">→</span></button>
    {open && createPortal(
      <dialog ref={dialog} className="update-dialog" aria-labelledby="update-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); } }}>
        <header><h2 id="update-dialog-title">{text.title}</h2><button type="button" aria-label={text.close} onClick={close}><VectorIcon name="close" /></button></header>
        <div className="update-dialog-body">
          <dl className="update-builds"><div><dt>{text.current}</dt><dd>{formatBuild(current)}</dd></div>{status.authenticated && status.available && <div><dt>{text.available}</dt><dd>{formatBuild(status.available)}</dd></div>}</dl>
          {errorText && <p role="alert" className="update-error">{errorText}</p>}
          {status.authenticated && <div aria-live="polite" role="status">
            {(running || status.phase === 'checking') && <p className="update-progress">{disconnected ? text.reconnecting : settling ? text.finishing : text.phases[phase]}</p>}
            {status.checkedAt && !status.available && status.phase === 'idle' && !errorText && <p>{text.latest}</p>}
          </div>}
          {!status.authenticated && status.ready && <form onSubmit={(event) => { event.preventDefault(); void act('login', { password }); }}>
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
