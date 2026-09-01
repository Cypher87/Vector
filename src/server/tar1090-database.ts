import type { AircraftMetadata } from '../domain/aircraft';
import { combineAircraftMetadata } from '../domain/aircraft-metadata.ts';

type UnknownRecord = Record<string, unknown>;
type DatabaseShard = Record<string, unknown>;

export class Tar1090DatabaseError extends Error {}

const ICAO_ID = /^[0-9a-f]{6}$/i;
const DATABASE_VERSION = /^[0-9a-f]{7,40}$/i;
const MAX_IDS_PER_REQUEST = 200;
const MAX_VERSION_RESPONSE_BYTES = 16 * 1_024;
const MAX_SHARD_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const MAX_TRACE_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const VERSION_CACHE_MS = 60 * 60 * 1_000;
const TRACE_CACHE_MS = 60 * 60 * 1_000;
const MISSING_TRACE_CACHE_MS = 5 * 60 * 1_000;
const MAX_CACHED_SHARDS = 128;
const MAX_CACHED_TRACES = 1_000;
const TRACE_LOOKUP_CONCURRENCY = 8;

const versionCache = new Map<string, { expiresAt: number; version: string }>();
const shardCache = new Map<string, DatabaseShard>();
const shardRequests = new Map<string, Promise<DatabaseShard>>();
const traceCache = new Map<string, { expiresAt: number; metadata?: AircraftMetadata }>();
const traceRequests = new Map<string, Promise<AircraftMetadata | undefined>>();

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;

const asText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asDisplayText = (value: unknown) =>
  asText(value) ?? (asNumber(value) === undefined ? undefined : String(value));

const isRedirectStatus = (status: number) => status >= 300 && status < 400;

const databaseUrl = (baseUrl: URL, resourcePath: string) => {
  const url = new URL(resourcePath, baseUrl);
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) {
    throw new Tar1090DatabaseError('The tar1090 database resource escaped its configured base');
  }
  return url;
};

async function fetchDatabaseJson(url: URL, maximumBytes: number, signal?: AbortSignal) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal,
  });
  if (isRedirectStatus(response.status)) throw new Tar1090DatabaseError('tar1090 database redirects are not allowed');
  if (!response.ok) throw new Tar1090DatabaseError(`tar1090 database returned HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Tar1090DatabaseError('tar1090 database response is too large');
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new Tar1090DatabaseError('tar1090 database response is too large');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Tar1090DatabaseError('tar1090 database returned invalid JSON');
  }
}

export function parseAircraftMetadataRequest(requestUrl: string): string[] {
  const parameters = new URL(requestUrl).searchParams;
  if (
    [...parameters.keys()].some((key) => key !== 'ids')
    || parameters.getAll('ids').length !== 1
  ) {
    throw new Tar1090DatabaseError('Exactly one aircraft ID list is required');
  }

  const ids = [...new Set((parameters.get('ids') ?? '').split(',').map((id) => id.trim().toLowerCase()))];
  if (ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST || ids.some((id) => !ICAO_ID.test(id))) {
    throw new Tar1090DatabaseError('The aircraft ID list is invalid');
  }
  return ids;
}

export function parseTar1090AircraftRecord(value: unknown): AircraftMetadata | undefined {
  if (!Array.isArray(value)) return undefined;
  const registration = asText(value[0]);
  const aircraftType = asText(value[1]);
  const flags = asText(value[2]);
  const description = asText(value[3]);
  const dbFlags = flags
    ? Number(flags[0] === '1')
      | Number(flags[1] === '1') << 1
      | Number(flags[2] === '1') << 2
      | Number(flags[3] === '1') << 3
    : undefined;
  if (!registration && !aircraftType && !description && dbFlags === undefined) return undefined;
  return { registration, aircraftType, description, dbFlags };
}

const traceMetadataFromRecord = (value: unknown): AircraftMetadata => {
  const record = asRecord(value);
  if (!record) return {};
  return {
    category: asText(record.category),
    registration: asText(record.r),
    aircraftType: asText(record.t),
    description: asText(record.desc),
    ownerOperator: asText(record.ownOp),
    year: asDisplayText(record.year),
    dbFlags: asNumber(record.dbFlags),
  };
};

const hasMetadata = (metadata: AircraftMetadata) => Object.values(metadata).some((value) => value !== undefined);

export function parseTar1090TraceMetadata(value: unknown): AircraftMetadata | undefined {
  const root = asRecord(value);
  if (!root) return undefined;

  let metadata = traceMetadataFromRecord(root);
  if (Array.isArray(root.trace)) {
    for (const point of root.trace) {
      if (!Array.isArray(point)) continue;
      metadata = combineAircraftMetadata(metadata, traceMetadataFromRecord(point[8]));
    }
  }
  return hasMetadata(metadata) ? metadata : undefined;
}

async function loadDatabaseVersion(baseUrl: URL, signal?: AbortSignal) {
  const cacheKey = baseUrl.toString();
  const cached = versionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.version;

  const value = asRecord(await fetchDatabaseJson(
    databaseUrl(baseUrl, 'version.json'),
    MAX_VERSION_RESPONSE_BYTES,
    signal,
  ));
  const version = value ? asText(value.databaseVersion) : undefined;
  if (!version || !DATABASE_VERSION.test(version)) {
    throw new Tar1090DatabaseError('tar1090 version.json does not contain a valid database version');
  }
  const normalized = version.toLowerCase();
  versionCache.set(cacheKey, { expiresAt: Date.now() + VERSION_CACHE_MS, version: normalized });
  return normalized;
}

async function loadDatabaseShard(baseUrl: URL, version: string, prefix: string, signal?: AbortSignal) {
  const normalizedPrefix = prefix.toUpperCase();
  const cacheKey = `${baseUrl}|${version}|${normalizedPrefix}`;
  const cached = shardCache.get(cacheKey);
  if (cached) return cached;
  const inFlight = shardRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const value = asRecord(await fetchDatabaseJson(
      databaseUrl(baseUrl, `db-${version}/${normalizedPrefix}.js`),
      MAX_SHARD_RESPONSE_BYTES,
      signal,
    ));
    if (!value) throw new Tar1090DatabaseError('tar1090 database shard is invalid');
    shardCache.set(cacheKey, value);
    if (shardCache.size > MAX_CACHED_SHARDS) {
      const oldestKey = shardCache.keys().next().value;
      if (oldestKey) shardCache.delete(oldestKey);
    }
    return value;
  })();
  shardRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    shardRequests.delete(cacheKey);
  }
}

async function lookupAircraft(
  baseUrl: URL,
  version: string,
  aircraftId: string,
  signal?: AbortSignal,
) {
  const normalizedId = aircraftId.toUpperCase();
  let prefix = normalizedId.slice(0, 1);
  for (let level = 1; level < normalizedId.length; level += 1) {
    const shard = await loadDatabaseShard(baseUrl, version, prefix, signal);
    const suffix = normalizedId.slice(level);
    if (Object.prototype.hasOwnProperty.call(shard, suffix)) {
      return parseTar1090AircraftRecord(shard[suffix]);
    }

    const nextPrefix = normalizedId.slice(0, level + 1);
    const children = Array.isArray(shard.children)
      ? shard.children.flatMap((value) => asText(value)?.toUpperCase() ?? [])
      : [];
    if (!children.includes(nextPrefix)) return undefined;
    prefix = nextPrefix;
  }
  return undefined;
}

export async function loadTar1090AircraftMetadata(
  baseUrl: URL,
  aircraftIds: string[],
  signal?: AbortSignal,
) {
  const ids = [...new Set(aircraftIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST || ids.some((id) => !ICAO_ID.test(id))) {
    throw new Tar1090DatabaseError('The aircraft ID list is invalid');
  }
  const version = await loadDatabaseVersion(baseUrl, signal);
  const entries = await Promise.all(ids.map(async (id) => [
    id,
    await lookupAircraft(baseUrl, version, id, signal),
  ] as const));
  return Object.fromEntries(entries.filter((entry): entry is [string, AircraftMetadata] => Boolean(entry[1])));
}

const traceUrl = (baseUrl: URL, aircraftId: string, kind: 'full' | 'recent') => {
  const bucket = aircraftId.slice(-2);
  const url = new URL(`traces/${bucket}/trace_${kind}_${aircraftId}.json`, baseUrl);
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) {
    throw new Tar1090DatabaseError('The readsb trace resource escaped its configured base');
  }
  return url;
};

async function fetchTraceJson(url: URL, signal?: AbortSignal) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal,
  });
  if (isRedirectStatus(response.status)) throw new Tar1090DatabaseError('readsb trace redirects are not allowed');
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Tar1090DatabaseError(`readsb trace returned HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TRACE_RESPONSE_BYTES) {
    throw new Tar1090DatabaseError('readsb trace response is too large');
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_TRACE_RESPONSE_BYTES) {
    throw new Tar1090DatabaseError('readsb trace response is too large');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Tar1090DatabaseError('readsb trace returned invalid JSON');
  }
}

async function loadTraceMetadata(baseUrl: URL, aircraftId: string, signal?: AbortSignal) {
  const cacheKey = `${baseUrl}|${aircraftId}`;
  const cached = traceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.metadata;
  const inFlight = traceRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    let metadata: AircraftMetadata | undefined;
    for (const kind of ['recent', 'full'] as const) {
      const value = await fetchTraceJson(traceUrl(baseUrl, aircraftId, kind), signal);
      metadata = value === undefined ? undefined : parseTar1090TraceMetadata(value);
      if (metadata) break;
    }
    traceCache.set(cacheKey, {
      expiresAt: Date.now() + (metadata ? TRACE_CACHE_MS : MISSING_TRACE_CACHE_MS),
      metadata,
    });
    if (traceCache.size > MAX_CACHED_TRACES) {
      const oldestKey = traceCache.keys().next().value;
      if (oldestKey) traceCache.delete(oldestKey);
    }
    return metadata;
  })();
  traceRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    traceRequests.delete(cacheKey);
  }
}

export async function loadReadsbTraceAircraftMetadata(
  baseUrl: URL,
  aircraftIds: string[],
  signal?: AbortSignal,
) {
  const ids = [...new Set(aircraftIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0 || ids.length > MAX_IDS_PER_REQUEST || ids.some((id) => !ICAO_ID.test(id))) {
    throw new Tar1090DatabaseError('The aircraft ID list is invalid');
  }

  const results = new Map<string, AircraftMetadata>();
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(TRACE_LOOKUP_CONCURRENCY, ids.length) }, async () => {
    while (nextIndex < ids.length) {
      const id = ids[nextIndex];
      nextIndex += 1;
      try {
        const metadata = await loadTraceMetadata(baseUrl, id, signal);
        if (metadata) results.set(id, metadata);
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
  });
  await Promise.all(workers);
  return Object.fromEntries(results);
}
