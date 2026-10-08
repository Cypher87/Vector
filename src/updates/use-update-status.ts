import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activeUpdatePhases, completedUpdateNeedsReload, readUpdateReloadMarker, updateReconnectGraceMs,
  updateReloadStorageKey, updateSettleMs, type UpdateStatus,
} from '../domain/update-progress';
import { vectorRevision } from '../version';

export function useUpdateStatus(open: boolean) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [watching, setWatching] = useState(false);
  const [settling, setSettling] = useState(false);
  const progress = useRef({
    status: null as UpdateStatus | null, watching: false, target: null as string | null,
    outageAt: null as number | null, completeAt: null as number | null, completeRevision: null as string | null,
    reloadedRevision: null as string | null, reloading: false, posting: false, refreshing: false, epoch: 0,
  });

  const track = useCallback((value: boolean) => { progress.current.watching = value; setWatching(value); }, []);
  const publish = useCallback((next: UpdateStatus) => { progress.current.status = next; setStatus(next); }, []);
  const unavailable = useCallback((next?: UpdateStatus) => {
    const p = progress.current;
    setDisconnected(true);
    p.completeAt = null; p.completeRevision = null;
    if (p.watching) {
      p.outageAt ??= Date.now();
      // A network interruption says nothing about the installer's outcome. Never retry POST here.
      setError(Date.now() - p.outageAt >= updateReconnectGraceMs ? 'reconnect_timeout' : null);
    } else {
      if (!p.status && next) publish(next);
      setError(p.status?.phase === 'failed' && p.status.error ? null : next?.error || 'service_unavailable');
    }
  }, [publish]);

  const refresh = useCallback(async () => {
    const p = progress.current;
    if (p.refreshing || p.posting || p.reloading) return;
    p.refreshing = true;
    const epoch = p.epoch;
    try {
      const response = await fetch('/api/updates', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const next = await response.json() as UpdateStatus;
      if (epoch !== p.epoch) return;
      if (!response.ok) { unavailable(next); return; }
      if (!next || typeof next.enabled !== 'boolean') { unavailable(); return; }
      p.outageAt = null;
      setDisconnected(false);
      setError((previous) => previous === 'service_unavailable' || previous === 'reconnect_timeout' ? null : previous);
      if (!next.enabled || next.phase === 'failed' || next.error) {
        track(false); setSettling(false); p.target = null; p.completeAt = null;
        publish(next); return;
      }
      if (activeUpdatePhases.has(next.phase || '')) {
        track(true); setSettling(false); p.completeAt = null;
        p.target = next.targetRevision || next.available?.revision || p.target;
        publish(next); return;
      }
      if (next.phase === 'complete') {
        if (p.target && next.current?.revision !== p.target) {
          // An older persisted completion must not confirm a newly requested update.
          track(false); setSettling(false); setError('update_unconfirmed'); p.target = null;
          publish({ ...next, phase: 'idle' }); return;
        }
        const reload = completedUpdateNeedsReload(next, vectorRevision, p.watching, p.reloadedRevision);
        if (next.restarting || reload) {
          track(true); setSettling(true); publish(next);
          if (next.restarting) { p.completeAt = null; return; }
          // Two services restart independently. Require stable successful polls, including
          // older workers that do not yet send the explicit restarting flag.
          if (p.completeRevision !== next.current!.revision || p.completeAt === null) {
            p.completeRevision = next.current!.revision; p.completeAt = Date.now();
          }
          if (Date.now() - p.completeAt >= updateSettleMs) {
            p.reloading = true;
            p.reloadedRevision = next.current!.revision;
            try { sessionStorage.setItem(updateReloadStorageKey, JSON.stringify({ revision: p.reloadedRevision, at: Date.now() })); } catch { /* storage can be unavailable */ }
            window.location.reload();
          }
          return;
        }
        // Completion is an installer journal entry, not a perpetual call to reload.
        track(false); setSettling(false); p.target = null; p.completeAt = null;
        publish({ ...next, phase: 'idle', checkedAt: next.checkedAt || Date.now() }); return;
      }
      if (p.watching && p.target && next.phase === 'idle') setError('update_unconfirmed');
      track(false); setSettling(false); p.target = null; p.completeAt = null;
      publish(next);
    } catch { if (epoch === p.epoch) unavailable(); }
    finally { p.refreshing = false; }
  }, [publish, track, unavailable]);

  useEffect(() => {
    try { progress.current.reloadedRevision = readUpdateReloadMarker(sessionStorage.getItem(updateReloadStorageKey), Date.now()); } catch { /* optional reload-loop guard */ }
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (!open && !watching) return;
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [open, watching, refresh]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    const p = progress.current;
    if (p.posting) return;
    p.posting = true; p.epoch++;
    setBusy(true); setError(null);
    if (action === 'apply') {
      p.target = typeof extra.revision === 'string' ? extra.revision : null;
      p.completeAt = null; p.outageAt = null;
      track(true); setSettling(false); setDisconnected(false);
      publish({ ...p.status!, phase: 'downloading', error: null });
    }
    try {
      const response = await fetch('/api/updates', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }), signal: AbortSignal.timeout(40_000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (action === 'apply' && response.status >= 500) unavailable();
        else {
          setError(result.error || 'service_unavailable');
          if (action === 'apply') {
            track(false); p.target = null;
            publish({ ...p.status!, phase: 'idle' });
          }
        }
      }
    } catch {
      if (action === 'apply') unavailable();
      else setError('service_unavailable');
    } finally {
      p.posting = false; setBusy(false);
      void refresh();
    }
  };

  return { status, busy, error, setError, disconnected, watching, settling, refresh, act };
}
