import type { RuntimeConfig, UnitSystem } from '../domain/aircraft';
import { DEFAULT_RUNTIME_CONFIG } from '../runtime-config.ts';

export type VectorServerConfig = {
  historyBaseUrl: URL;
  liveBaseUrl: URL;
  publicConfig: RuntimeConfig;
};

const DEFAULT_LIVE_URL = 'http://127.0.0.1/tar1090/data/';
const DEFAULT_HISTORY_URL = 'http://127.0.0.1/tar1090/globe_history/';

const configuredText = (
  value: string | undefined,
  fallback: string,
  maximumLength: number,
) => {
  const candidate = value?.trim();
  return candidate && candidate.length <= maximumLength ? candidate : fallback;
};

const configuredUnitSystem = (value: string | undefined): UnitSystem => {
  const candidate = value?.trim().toLowerCase();
  return candidate === 'aeronautical' || candidate === 'imperial' || candidate === 'metric'
    ? candidate
    : 'metric';
};

export function parseUpstreamBaseUrl(value: string, variableName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL`);
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.hostname
  ) {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL without credentials, query parameters or a fragment`);
  }

  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/`;
  return parsed;
}

export function readVectorServerConfig(
  environment: Record<string, string | undefined> = process.env,
): VectorServerConfig {
  return {
    liveBaseUrl: parseUpstreamBaseUrl(
      environment.READSB_LIVE_URL?.trim() || DEFAULT_LIVE_URL,
      'READSB_LIVE_URL',
    ),
    historyBaseUrl: parseUpstreamBaseUrl(
      environment.READSB_HISTORY_URL?.trim() || DEFAULT_HISTORY_URL,
      'READSB_HISTORY_URL',
    ),
    publicConfig: {
      ...DEFAULT_RUNTIME_CONFIG,
      mapStyleUrl: configuredText(environment.VECTOR_MAP_STYLE_URL, DEFAULT_RUNTIME_CONFIG.mapStyleUrl, 2_048),
      siteName: configuredText(environment.VECTOR_SITE_NAME, DEFAULT_RUNTIME_CONFIG.siteName, 80),
      receiverName: configuredText(environment.VECTOR_RECEIVER_TITLE, DEFAULT_RUNTIME_CONFIG.receiverName, 120),
      unitSystem: configuredUnitSystem(environment.VECTOR_UNIT_SYSTEM),
    },
  };
}
