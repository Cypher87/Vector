import type { VectorServerConfig } from './vector-config';

export type ReadsbSource = 'history' | 'live';

export class ReadsbRequestError extends Error {}

const LIVE_FILES = new Set(['aircraft.json', 'receiver.json']);
const TRACE_PATH = /^traces\/([0-9a-f]{2})\/trace_recent_(~?)([0-9a-f]{6})\.json$/i;
const REPLAY_PATH = /^(\d{4})\/(\d{2})\/(\d{2})\/heatmap\/(\d{2})\.bin\.ttf$/;
const MAX_RESOURCE_PATH_LENGTH = 256;

const rejectUnsafePathSyntax = (path: string) => {
  if (
    !path
    || path.length > MAX_RESOURCE_PATH_LENGTH
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('%')
    || path.includes('?')
    || path.includes('#')
    || path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new ReadsbRequestError('The readsb resource path is invalid');
  }
};

const isRealUtcDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

export function validateReadsbResourcePath(source: ReadsbSource, path: string): string {
  rejectUnsafePathSyntax(path);

  if (source === 'live') {
    if (LIVE_FILES.has(path)) return path;

    const match = path.match(TRACE_PATH);
    if (match && match[1].toLowerCase() === match[3].slice(-2).toLowerCase()) return path;
    throw new ReadsbRequestError('This live readsb resource is not allowed');
  }

  const match = path.match(REPLAY_PATH);
  if (!match) throw new ReadsbRequestError('This history resource is not allowed');

  const [, yearText, monthText, dayText, chunkText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const chunk = Number(chunkText);
  if (year < 2000 || year > 2100 || chunk < 0 || chunk > 47 || !isRealUtcDate(year, month, day)) {
    throw new ReadsbRequestError('This history resource is not valid');
  }
  return path;
}

export function parseReadsbProxyRequest(requestUrl: string): {
  path: string;
  source: ReadsbSource;
} {
  const parameters = new URL(requestUrl).searchParams;
  const keys = [...parameters.keys()];
  if (
    keys.some((key) => key !== 'path' && key !== 'source')
    || parameters.getAll('path').length !== 1
    || parameters.getAll('source').length !== 1
  ) {
    throw new ReadsbRequestError('Exactly one source and resource path are required');
  }

  const sourceValue = parameters.get('source');
  if (sourceValue !== 'live' && sourceValue !== 'history') {
    throw new ReadsbRequestError('The readsb source is invalid');
  }

  const path = validateReadsbResourcePath(sourceValue, parameters.get('path') ?? '');
  return { path, source: sourceValue };
}

export function buildReadsbUpstreamUrl(
  config: VectorServerConfig,
  source: ReadsbSource,
  path: string,
): URL {
  const validatedPath = validateReadsbResourcePath(source, path);
  const base = source === 'live' ? config.liveBaseUrl : config.historyBaseUrl;
  const upstream = new URL(validatedPath, base);
  if (upstream.origin !== base.origin || !upstream.pathname.startsWith(base.pathname)) {
    throw new ReadsbRequestError('The readsb resource escaped its configured base');
  }
  return upstream;
}

export const isRedirectStatus = (status: number) => status >= 300 && status < 400;
