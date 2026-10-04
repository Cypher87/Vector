import type { AircraftMetadata } from '../domain/aircraft.ts';
import { combineAircraftMetadata } from '../domain/aircraft-metadata.ts';
import type { VectorServerConfig } from './vector-config.ts';
import { lookupLocalAircraftMetadata } from './aircraft-database.ts';
import { loadTar1090AircraftMetadata, parseTar1090TraceMetadata } from './tar1090-database.ts';
import { loadReadsbResource, vectorProxyHeader } from './readsb-source.ts';
import { readBoundedResponse, ResourceError } from './bounded-resource.ts';

const traceCache = new Map<string, { expires: number; metadata?: AircraftMetadata }>();

export async function loadVectorAircraftMetadata(config: VectorServerConfig, ids: string[], signal?: AbortSignal): Promise<Record<string, AircraftMetadata>> {
  if (!ids.length || ids.length > 200 || ids.some((id) => !/^[a-f0-9]{6}$/.test(id))) throw new ResourceError('Invalid aircraft IDs', 400);
  if (config.source === 'vector') {
    const url = new URL('api/aircraft-metadata', config.remoteBaseUrl!);
    url.searchParams.set('ids', ids.join(','));
    const body = await readBoundedResponse(await fetch(url, {
      signal, redirect: 'manual', headers: { [vectorProxyHeader]: '1' }, cache: 'no-store',
    }), 1024 * 1024, signal);
    const response = JSON.parse(body.toString());
    if (!response?.aircraft || typeof response.aircraft !== 'object' || Array.isArray(response.aircraft)) throw new ResourceError('Invalid remote metadata');
    return Object.fromEntries(ids.filter((id) => Object.hasOwn(response.aircraft, id)).map((id) => [id, response.aircraft[id]]));
  }
  const records = await lookupLocalAircraftMetadata(config.databaseFile, ids, signal);
  if (config.source === 'http') {
    try {
      const unresolved = ids.filter((id) => !records[id]?.aircraftType && !records[id]?.description);
      const legacySignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(2_000)]);
      const legacy = unresolved.length ? await loadTar1090AircraftMetadata(config.tar1090BaseUrl, unresolved, legacySignal) : {};
      for (const id of ids) if (legacy[id]) records[id] = combineAircraftMetadata(legacy[id], records[id] ?? {});
    } catch { signal?.throwIfAborted(); }
  }
  // Database outages must not prevent trace emitter-category lookup (e.g. balloons).
  const missing = ids.filter((id) => !records[id]?.category && !records[id]?.aircraftType && !records[id]?.description);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (cursor < missing.length) {
      const id = missing[cursor++];
      const key = `${config.source}:${config.liveDirectory}:${config.liveBaseUrl}:${id}`;
      const cached = traceCache.get(key);
      let metadata = cached?.metadata;
      if (!cached || cached.expires < Date.now()) {
        for (const kind of ['recent', 'full']) {
          try {
            const body = await loadReadsbResource(config, 'live', `traces/${id.slice(-2)}/trace_${kind}_${id}.json`, signal);
            metadata = parseTar1090TraceMetadata(JSON.parse(body.toString()));
            if (metadata) break;
          } catch { signal?.throwIfAborted(); }
        }
        traceCache.set(key, { metadata, expires: Date.now() + (metadata ? 3_600_000 : 60_000) });
        if (traceCache.size > 1000) traceCache.delete(traceCache.keys().next().value!);
      }
      if (metadata) records[id] = combineAircraftMetadata(metadata, records[id] ?? {});
    }
  }));
  return records;
}
