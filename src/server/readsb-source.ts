import type { VectorServerConfig } from './vector-config.ts';
import { validateReadsbResourcePath, type ReadsbSource } from './readsb-proxy.ts';
import { decompressResource, readBoundedFile, readBoundedResponse, ResourceError } from './bounded-resource.ts';
import { lookupLocalAircraftMetadata } from './aircraft-database.ts';

export const maximumReadsbBytes = 32 * 1024 * 1024;
export const vectorProxyHeader = 'x-vector-data-proxy';

export function rejectProxyLoop(request: Request, config: VectorServerConfig) {
  if (config.source === 'vector' && request.headers.has(vectorProxyHeader)) {
    throw new ResourceError('Chained Vector proxies are not supported', 508);
  }
}

export async function loadReadsbResource(config: VectorServerConfig, source: ReadsbSource, path: string, signal?: AbortSignal): Promise<Buffer> {
  validateReadsbResourcePath(source, path);
  let body: Buffer;
  if (config.source === 'local') {
    body = await readBoundedFile(source === 'live' ? config.liveDirectory : config.historyDirectory, path, maximumReadsbBytes, signal);
  } else {
    const url = new URL('api/readsb', config.remoteBaseUrl!);
    url.searchParams.set('source', source);
    url.searchParams.set('path', path);
    body = await readBoundedResponse(await fetch(url, {
      signal, redirect: 'manual', cache: 'no-store', headers: { [vectorProxyHeader]: '1' },
    }), maximumReadsbBytes, signal);
  }
  // readsb uses gzip even for trace_*.json and *.bin.ttf; HTTP may already decode it.
  const decoded = await decompressResource(body, maximumReadsbBytes, signal);
  if (config.source !== 'local' || source !== 'live' || path !== 'aircraft.json') return decoded;
  // A plain readsb installation needn't load a database itself. Enrich live JSON too,
  // not only replay lookups, without replacing receiver measurements or identity fields.
  const snapshot = JSON.parse(decoded.toString());
  if (!Array.isArray(snapshot?.aircraft)) throw new ResourceError('Invalid aircraft snapshot');
  const ids = snapshot.aircraft.flatMap((item: { hex?: unknown } | null) =>
    typeof item?.hex === 'string' && /^[a-f0-9]{6}$/i.test(item.hex) ? [item.hex.toLowerCase()] : []);
  const metadata = await lookupLocalAircraftMetadata(config.databaseFile, ids, signal);
  for (const item of snapshot.aircraft) {
    const record = typeof item?.hex === 'string' ? metadata[item.hex.toLowerCase()] : undefined;
    if (!record) continue;
    item.r ||= record.registration;
    item.t ||= record.aircraftType;
    item.desc ||= record.description;
    item.ownOp ||= record.ownerOperator;
    item.year ??= record.year;
    item.dbFlags ??= record.dbFlags;
  }
  const enriched = Buffer.from(JSON.stringify(snapshot));
  if (enriched.length > maximumReadsbBytes) throw new ResourceError('Resource is too large', 413);
  return enriched;
}
