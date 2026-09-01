import type { RuntimeConfig, UnitSystem } from '../domain/aircraft';
import { DEFAULT_RUNTIME_CONFIG } from '../runtime-config.ts';

export type VectorServerConfig = {
  historyBaseUrl: URL;
  liveBaseUrl: URL;
  publicConfig: RuntimeConfig;
  tar1090BaseUrl: URL;
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

const configuredReceiverCoordinates = (
  latitudeValue: string | undefined,
  longitudeValue: string | undefined,
): Pick<RuntimeConfig, 'receiverLatitude' | 'receiverLongitude'> => {
  const latitudeText = latitudeValue?.trim();
  const longitudeText = longitudeValue?.trim();

  if (!latitudeText && !longitudeText) return {};
  if (!latitudeText || !longitudeText) {
    throw new Error('VECTOR_RECEIVER_LATITUDE and VECTOR_RECEIVER_LONGITUDE must be configured together');
  }

  const receiverLatitude = Number(latitudeText);
  const receiverLongitude = Number(longitudeText);
  if (!Number.isFinite(receiverLatitude) || receiverLatitude < -90 || receiverLatitude > 90) {
    throw new Error('VECTOR_RECEIVER_LATITUDE must be a number between -90 and 90');
  }
  if (!Number.isFinite(receiverLongitude) || receiverLongitude < -180 || receiverLongitude > 180) {
    throw new Error('VECTOR_RECEIVER_LONGITUDE must be a number between -180 and 180');
  }

  return { receiverLatitude, receiverLongitude };
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
  const liveBaseUrl = parseUpstreamBaseUrl(
    environment.READSB_LIVE_URL?.trim() || DEFAULT_LIVE_URL,
    'READSB_LIVE_URL',
  );
  const historyBaseUrl = parseUpstreamBaseUrl(
    environment.READSB_HISTORY_URL?.trim() || DEFAULT_HISTORY_URL,
    'READSB_HISTORY_URL',
  );
  const tar1090BaseUrl = environment.READSB_TAR1090_URL?.trim()
    ? parseUpstreamBaseUrl(environment.READSB_TAR1090_URL, 'READSB_TAR1090_URL')
    : new URL('../', liveBaseUrl);

  return {
    liveBaseUrl,
    historyBaseUrl,
    tar1090BaseUrl,
    publicConfig: {
      ...DEFAULT_RUNTIME_CONFIG,
      mapStyleUrl: configuredText(environment.VECTOR_MAP_STYLE_URL, DEFAULT_RUNTIME_CONFIG.mapStyleUrl, 2_048),
      siteName: configuredText(environment.VECTOR_SITE_NAME, DEFAULT_RUNTIME_CONFIG.siteName, 80),
      receiverName: configuredText(environment.VECTOR_RECEIVER_TITLE, DEFAULT_RUNTIME_CONFIG.receiverName, 120),
      ...configuredReceiverCoordinates(
        environment.VECTOR_RECEIVER_LATITUDE,
        environment.VECTOR_RECEIVER_LONGITUDE,
      ),
      unitSystem: configuredUnitSystem(environment.VECTOR_UNIT_SYSTEM),
    },
  };
}
