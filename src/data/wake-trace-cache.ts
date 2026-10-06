import type { AircraftTracePoint } from '../domain/aircraft.ts';
import { mergeWakeTrace, recentWakeTrace, type WakeTracePoint } from '../domain/wake-trace.ts';

type Entry = {
  points: readonly WakeTracePoint[];
  retryAt: number;
  local?: readonly AircraftTracePoint[];
  merged?: readonly WakeTracePoint[];
};
type Request = { controller: AbortController; timeout: ReturnType<typeof setTimeout> };
type Options = {
  load: (id: string, signal: AbortSignal) => Promise<AircraftTracePoint[]>;
  onChange: () => void;
  now?: () => number;
};
const empty: readonly AircraftTracePoint[] = [];
const maximumEntries = 256;
const concurrency = 3;
const requestSpacingMs = 150;

/** One bounded, viewport-driven cache per receiver. Never load full-day traces for decoration. */
export function createWakeTraceCache({ load, onChange, now = Date.now }: Options) {
  const entries = new Map<string, Entry>();
  const active = new Map<string, Request>();
  let wanted: string[] = [];
  let disposed = false;
  let nextRequestAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = (id: string, request: Request) => {
    active.delete(id);
    clearTimeout(request.timeout);
    request.controller.abort();
  };
  const pump = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || !wanted.length || active.size >= concurrency) return;
    const time = now();
    const pending = wanted.filter((id) => !active.has(id));
    const id = pending.find((id) => (entries.get(id)?.retryAt ?? 0) <= time);
    if (!id) {
      const next = Math.min(...pending.map((id) => entries.get(id)?.retryAt ?? Infinity));
      if (Number.isFinite(next)) timer = setTimeout(pump, Math.max(1, next - time));
      return;
    }
    if (time < nextRequestAt) { timer = setTimeout(pump, nextRequestAt - time); return; }
    const controller = new AbortController();
    const request: Request = { controller, timeout: setTimeout(() => {
      // Release the slot even when a failed transport never settles its promise.
      finish([]);
      controller.abort();
    }, 8_000) };
    const finish = (points: AircraftTracePoint[]) => {
      if (disposed || active.get(id) !== request) return;
      active.delete(id);
      clearTimeout(request.timeout);
      const recent = recentWakeTrace(points, now() / 1_000);
      const previous = entries.get(id);
      entries.delete(id);
      entries.set(id, { points: recent.length ? recent : previous?.points ?? [],
        retryAt: now() + (recent.length ? 300_000 : 60_000) });
      while (entries.size > maximumEntries) entries.delete(entries.keys().next().value!);
      if (recent.length) onChange();
      pump();
    };
    active.set(id, request);
    nextRequestAt = time + requestSpacingMs;
    void Promise.resolve().then(() => load(id, controller.signal)).then(finish, () => finish([]));
    pump();
  };

  return {
    setWanted(ids: readonly string[]) {
      if (disposed) return;
      wanted = [...new Set(ids)].filter((id) => /^~?[0-9a-f]{6}$/.test(id)).slice(0, maximumEntries);
      const visible = new Set(wanted);
      for (const [id, request] of active) if (!visible.has(id)) stop(id, request);
      pump();
    },
    get(id: string, local: readonly AircraftTracePoint[] = empty): readonly WakeTracePoint[] {
      const entry = entries.get(id);
      if (!entry?.points.length) return local;
      // Preserve point identities for the renderer's geometry cache; never merge per frame.
      if (entry.local !== local) { entry.local = local; entry.merged = mergeWakeTrace(entry.points, local); }
      entries.delete(id);
      entries.set(id, entry);
      return entry.merged!;
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      for (const [id, request] of active) stop(id, request);
      wanted = [];
      entries.clear();
    },
  };
}
