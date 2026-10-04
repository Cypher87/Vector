'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Aircraft, AircraftHistorySnapshot, AircraftTracePoint } from '../domain/aircraft';
import { limitAircraftTracePeriod, type LegTracePeriod } from '../domain/aircraft-trace';
import { appendTracePoint, traceFromHistory, tracePointFromAircraft } from '../domain/flight-profile';
import { loadAircraftLegTrace } from './readsb';

type TraceState = { key: string; points: AircraftTracePoint[] };
type Options = {
  aircraft: Aircraft[]; selectedId?: string; dataBaseUrl: string; lastUpdate?: number;
  live: boolean; enabled: boolean; historyOpen: boolean; snapshots: AircraftHistorySnapshot[]; period: LegTracePeriod;
};

/** One trace source for both the map and profile; replay never requests today's live trace. */
export function useSelectedAircraftTrace({ aircraft, selectedId, dataBaseUrl, lastUpdate, live, enabled, historyOpen, snapshots, period }: Options) {
  const cache = useRef(new Map<string, AircraftTracePoint[]>());
  const cacheBase = useRef(dataBaseUrl);
  const [local, setLocal] = useState<TraceState>();
  const [server, setServer] = useState<TraceState>();
  const key = `${dataBaseUrl}:${selectedId ?? ''}`;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (cacheBase.current !== dataBaseUrl) { cache.current.clear(); cacheBase.current = dataBaseUrl; }
      if (live && lastUpdate) {
        for (const item of aircraft) {
          const point = tracePointFromAircraft(item, lastUpdate / 1_000);
          if (point) cache.current.set(item.id, appendTracePoint(cache.current.get(item.id) ?? [], point));
        }
        for (const [id, points] of cache.current) {
          if ((points.at(-1)?.timestamp ?? 0) < lastUpdate / 1_000 - 1_800) cache.current.delete(id);
        }
      }
      const points = selectedId ? cache.current.get(selectedId) ?? [] : [];
      setLocal((current) => current?.key === key && current.points === points ? current : { key, points });
    });
    return () => cancelAnimationFrame(frame);
  }, [aircraft, dataBaseUrl, key, lastUpdate, live, selectedId]);

  useEffect(() => {
    if (!enabled || !selectedId || historyOpen) return;
    let disposed = false;
    let controller: AbortController;
    let retry: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const points = await loadAircraftLegTrace(dataBaseUrl, selectedId, controller.signal);
        if (!disposed) setServer((current) => points.length || current?.key !== key ? { key, points } : current);
      } catch {
        if (!disposed) setServer((current) => current?.key === key ? current : { key, points: [] });
      } finally {
        clearTimeout(timeout);
        if (!disposed) retry = setTimeout(() => void refresh(), 30_000);
      }
    };
    void refresh();
    return () => { disposed = true; controller?.abort(); clearTimeout(retry); };
  }, [dataBaseUrl, enabled, historyOpen, key, selectedId]);

  const points = useMemo(() => {
    if (!selectedId) return [];
    if (historyOpen) return limitAircraftTracePeriod(traceFromHistory(snapshots, selectedId), period);
    const recorded = local?.key === key ? local.points : [];
    const upstream = server?.key === key ? server.points : [];
    const newest = upstream.at(-1)?.timestamp ?? -Infinity;
    // The first local point starts its own buffer, not a new leg if it joins a server trace.
    const tail = recorded.filter((point) => point.timestamp > newest).map((point, index) =>
      index === 0 && Number.isFinite(newest) ? { ...point, startsLeg: point.timestamp - newest > 300 } : point);
    return limitAircraftTracePeriod([...upstream, ...tail], period);
  }, [historyOpen, key, local, period, selectedId, server, snapshots]);

  return { points, loading: enabled && !historyOpen && !!selectedId && server?.key !== key };
}
