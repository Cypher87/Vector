export type UpdateBuild = { version: string; revision: string };
export type UpdateStatus = {
  enabled: boolean; ready?: boolean; authenticated?: boolean; current?: UpdateBuild;
  phase?: string; error?: string | null; available?: UpdateBuild | null; checkedAt?: number | null;
  restarting?: boolean; targetRevision?: string | null;
};

export const activeUpdatePhases = new Set(['downloading', 'building', 'activating', 'verifying', 'restoring']);
export const updateReconnectGraceMs = 120_000;
export const updateSettleMs = 6_000;
export const updateReloadStorageKey = 'vector.updateReload';

export function completedUpdateNeedsReload(status: UpdateStatus, browserRevision: string, watched: boolean, reloadedRevision: string | null): boolean {
  const revision = status.current?.revision;
  return status.phase === 'complete' && !status.error && !!revision && /^[a-f0-9]{40}$/.test(revision)
    && revision !== browserRevision && revision !== reloadedRevision && (watched || !!browserRevision);
}

export function readUpdateReloadMarker(value: string | null, now: number): string | null {
  try {
    const marker = JSON.parse(value || 'null');
    return marker && /^[a-f0-9]{40}$/.test(marker.revision) && Number.isFinite(marker.at)
      && now >= marker.at && now - marker.at < 60 * 60_000 ? marker.revision : null;
  } catch { return null; }
}
