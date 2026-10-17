'use client';
import { useEffect, useState } from 'react';
import { parseHeatmapResponse, type HeatmapData, type HeatmapPeriod } from '../domain/heatmap';

export type HeatmapState = { period: HeatmapPeriod; status: 'off' | 'loading' | 'ready' | 'error'; loaded: number; total: number; data?: HeatmapData };
export function useHeatmap(enabled: boolean, period: HeatmapPeriod): HeatmapState {
  const [state, setState] = useState<HeatmapState>({ period, status: 'off', loaded: 0, total: 1 });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const poll = async () => {
      clearTimeout(timer);
      if (stopped || document.hidden || request) return;
      const controller = new AbortController(); request = controller;
      let delay = 15_000;
      try {
        const response = await fetch(`/api/heatmap?period=${period}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok && response.status !== 503 || Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw new Error('Heatmap unavailable');
        const text = await response.text();
        if (text.length > 4 * 1024 * 1024) throw new Error('Heatmap too large');
        const result = parseHeatmapResponse(JSON.parse(text));
        if (stopped || controller.signal.aborted || request !== controller) return;
        setState((previous) => ({ period, status: result.status, loaded: result.loaded, total: result.total,
          data: result.status === 'ready' ? result.data : previous.period === period ? previous.data : undefined }));
        delay = result.status === 'loading' ? 1200 : result.status === 'ready' ? 5 * 60_000 : 15_000;
      } catch {
        if (!stopped && !controller.signal.aborted) setState((previous) => ({ period, status: 'error', loaded: 0, total: 1,
          data: previous.period === period ? previous.data : undefined }));
      } finally {
        if (request === controller) {
          request = undefined;
          if (!stopped && !document.hidden) timer = setTimeout(() => { void poll(); }, delay);
        }
      }
    };
    const visibility = () => {
      if (document.hidden) { clearTimeout(timer); request?.abort(); }
      else { request?.abort(); request = undefined; void poll(); }
    };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [enabled, period]);
  return !enabled ? { period, status: 'off', loaded: 0, total: 1 }
    : state.period !== period || state.status === 'off' ? { period, status: 'loading', loaded: 0, total: 1 } : state;
}
