import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { coarsenHeatmap, heatmapCellCoordinate, heatmapChunkPath, heatmapChunkSeconds, heatmapGridZoom, heatmapParentCell,
  heatmapPeriodHours, maximumHeatmapPoints, type HeatmapPeriod, type HeatmapResponse } from '../domain/heatmap.ts';
import { ResourceError } from './bounded-resource.ts';
import { HeatmapCache } from './heatmap-cache.ts';
import { summarizeHeatmapChunk, type HeatmapChunk } from './heatmap-chunk.ts';
import { loadReadsbResource } from './readsb-source.ts';
import type { VectorServerConfig } from './vector-config.ts';

type Cache = Pick<HeatmapCache, 'get' | 'put'>;
type Job = { state: HeatmapResponse; expires: number; controller: AbortController };

export function createHeatmapService({ source, cache, load, now = () => Date.now() / 1000, readTimeoutMs = 15_000 }: {
  source: string; cache: Cache; load: (path: string, signal: AbortSignal) => Promise<Uint8Array>; now?: () => number; readTimeoutMs?: number;
}) {
  const jobs = new Map<string, Job>();
  const pendingChunks = new Map<number, Promise<HeatmapChunk | undefined>>();
  const missing = new Map<number, number>();
  let queue: Promise<unknown> = Promise.resolve();
  const waitForChunk = async (task: Promise<HeatmapChunk | undefined>, signal: AbortSignal) => {
    const limit = AbortSignal.any([signal, AbortSignal.timeout(readTimeoutMs)]);
    limit.throwIfAborted();
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(limit.reason); limit.addEventListener('abort', abort, { once: true }); });
    try { return await Promise.race([task, cancelled]); }
    finally { limit.removeEventListener('abort', abort); }
  };
  const chunk = (stamp: number, signal: AbortSignal) => {
    const stored = cache.get(source, stamp, now());
    if (stored) return Promise.resolve(stored);
    if ((missing.get(stamp) ?? 0) > now()) return Promise.resolve(undefined);
    const pending = pendingChunks.get(stamp);
    if (pending) return waitForChunk(pending, signal);
    if (pendingChunks.size >= 8) return Promise.reject(new ResourceError('Heatmap reader is busy', 503));
    // One bounded read/parse at a time, shared between periods and browsers.
    const task = queue.catch(() => {}).then(async () => {
      try {
        signal.throwIfAborted();
        const readSignal = AbortSignal.any([signal, AbortSignal.timeout(readTimeoutMs)]);
        const result = await summarizeHeatmapChunk(await load(heatmapChunkPath(stamp), readSignal), stamp, readSignal);
        cache.put(source, stamp, result, now());
        return result;
      } catch (error) {
        if (error instanceof ResourceError && [404, 410].includes(error.status)) {
          missing.set(stamp, now() + 60); return;
        }
        throw error;
      } finally { pendingChunks.delete(stamp); }
    });
    queue = task; pendingChunks.set(stamp, task); return waitForChunk(task, signal);
  };
  const build = async (period: HeatmapPeriod, to: number, job: Job) => {
    const from = to - heatmapPeriodHours[period] * 3600;
    const start = Math.floor(from / heatmapChunkSeconds) * heatmapChunkSeconds;
    const end = Math.floor((to - 1) / heatmapChunkSeconds) * heatmapChunkSeconds;
    const total = Math.round((end - start) / heatmapChunkSeconds) + 1;
    job.state = { status: 'loading', loaded: 0, total };
    const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(10 * 60_000)]);
    let cells = new Map<number, number>(), zoom = heatmapGridZoom;
    let loaded = 0, readable = 0, failed = 0, errors = 0, first: number | null = null, last: number | null = null;
    try {
      for (let stamp = end; stamp >= start; stamp -= heatmapChunkSeconds) {
        signal.throwIfAborted();
        try {
          const summary = await chunk(stamp, signal);
          if (!summary) failed++;
          else {
            readable++;
            while (zoom > summary.zoom) { cells = coarsenHeatmap(cells, zoom); zoom--; }
            for (let i = 0; i < summary.bins.length; i += 3) {
              const time = stamp + summary.bins[i] * 60;
              if (time < from || time >= to) continue;
              const cell = heatmapParentCell(summary.bins[i + 1], summary.zoom, zoom);
              cells.set(cell, (cells.get(cell) ?? 0) + summary.bins[i + 2]);
              first = Math.min(first ?? time, time); last = Math.max(last ?? time, time);
            }
            while (cells.size > 100_000) { cells = coarsenHeatmap(cells, zoom); zoom--; }
          }
        } catch (error) {
          if (signal.aborted || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw error;
          failed++; errors++;
        }
        loaded++;
        job.state = { status: 'loading', loaded, total };
      }
      while (cells.size > maximumHeatmapPoints) { cells = coarsenHeatmap(cells, zoom); zoom--; }
      job.state = readable === 0 && errors > 0 ? { status: 'error', loaded, total }
        : { status: 'ready', loaded, total, data: { from, to, first, last, gridZoom: zoom, partial: failed > 0,
          points: [...cells].map(([cell, count]) => [...heatmapCellCoordinate(cell, zoom), count]) } };
    } catch { job.state = { status: 'error', loaded, total }; }
    job.expires = now() + (job.state.status === 'error' ? 30 : 300);
  };
  return {
    request(period: HeatmapPeriod): HeatmapResponse {
      const time = now();
      for (const [key, job] of jobs) if (job.expires < time) { job.controller.abort(); jobs.delete(key); }
      for (const [stamp, expires] of missing) if (expires < time) missing.delete(stamp);
      // Polls and multiple devices share a five-minute snapshot, not a new archive scan.
      const key = `${period}:${Math.floor(time / 300)}`;
      const existing = jobs.get(key);
      if (existing) return existing.state;
      if (jobs.size >= 10) return { status: 'error', loaded: 0, total: 1 };
      const job: Job = { state: { status: 'loading', loaded: 0, total: 1 }, expires: time + 600, controller: new AbortController() };
      jobs.set(key, job);
      void build(period, Math.floor(time / 60) * 60, job);
      return job.state;
    },
    dispose() { for (const job of jobs.values()) job.controller.abort(); jobs.clear(); missing.clear(); },
  };
}

export function heatmapCacheFile(environment: Record<string, string | undefined> = process.env) {
  const file = environment.VECTOR_HEATMAP_CACHE?.trim() || (environment.VECTOR_SYNC_STORE
    ? resolve(dirname(environment.VECTOR_SYNC_STORE), 'heatmap-cache.sqlite')
    : process.platform === 'win32' ? resolve('.vector/heatmap-cache.sqlite') : '/var/lib/vector/heatmap-cache.sqlite');
  if (!isAbsolute(file) || file.includes('\0')) throw new Error('Invalid heatmap cache path');
  return file;
}

type Runtime = { key: string; service: ReturnType<typeof createHeatmapService>; cache: HeatmapCache };
const globalRuntime = globalThis as typeof globalThis & { __vectorHeatmap?: Promise<Runtime> };
export async function getHeatmapService(config: VectorServerConfig): Promise<ReturnType<typeof createHeatmapService>> {
  const key = createHash('sha256').update(JSON.stringify([config.source, config.historyDirectory, config.remoteBaseUrl?.href, heatmapCacheFile()])).digest('hex');
  const open = () => {
    const pending = mkdir(dirname(heatmapCacheFile()), { recursive: true }).then(() => {
      const cache = new HeatmapCache(heatmapCacheFile());
      return { key, cache, service: createHeatmapService({ source: key, cache,
        load: (path, signal) => loadReadsbResource(config, 'history', path, signal) }) };
    });
    globalRuntime.__vectorHeatmap = pending;
    void pending.catch(() => { if (globalRuntime.__vectorHeatmap === pending) globalRuntime.__vectorHeatmap = undefined; });
    return pending;
  };
  const pending = globalRuntime.__vectorHeatmap;
  if (!pending) return (await open()).service;
  const existing = await pending;
  if (existing.key === key) return existing.service;
  if (globalRuntime.__vectorHeatmap !== pending) return getHeatmapService(config);
  existing.service.dispose(); existing.cache.close();
  return (await open()).service;
}
