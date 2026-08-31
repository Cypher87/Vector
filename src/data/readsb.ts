import type { Aircraft, AircraftHistorySnapshot, AircraftSource, AircraftTracePoint, Receiver, RuntimeConfig, UnitSystem } from '../domain/aircraft';

type UnknownRecord = Record<string, unknown>;

const supportedSources = new Set<AircraftSource>([
  'adsb_icao',
  'adsb_icao_nt',
  'adsr_icao',
  'tisb_icao',
  'mlat',
  'mode_s',
  'other',
]);

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asBoolean = (value: unknown): boolean => value === true;

const asFlag = (value: unknown): boolean | undefined => {
  const candidate = asNumber(value);
  return candidate === undefined ? undefined : candidate !== 0;
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const entries = value.flatMap((entry) => {
    const candidate = asString(entry);
    return candidate ? [candidate] : [];
  });
  return entries.length > 0 ? entries : undefined;
};

const asDisplayString = (value: unknown): string | undefined => {
  const candidate = asString(value);
  if (candidate) return candidate;
  const number = asNumber(value);
  return number === undefined ? undefined : String(number);
};

const sourceFrom = (value: unknown): AircraftSource => {
  const candidate = asString(value) as AircraftSource | undefined;
  return candidate && supportedSources.has(candidate) ? candidate : 'other';
};

const unitSystemFrom = (value: unknown): UnitSystem | undefined => {
  const candidate = asString(value);
  return candidate === 'aeronautical' || candidate === 'imperial' || candidate === 'metric'
    ? candidate
    : undefined;
};

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function fetchBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.arrayBuffer();
}

const dataRequestUrl = (baseUrl: string, file: string) => {
  const [path, query = ''] = baseUrl.split('?', 2);
  if (path !== '/api/readsb') throw new Error('The configured readsb proxy path is invalid');
  const parameters = new URLSearchParams(query);
  parameters.set('path', file);
  return `${path}?${parameters.toString()}`;
};

export async function loadRuntimeConfig(signal?: AbortSignal): Promise<RuntimeConfig> {
  const value = asRecord(await fetchJson('/api/config', signal));
  const dataBaseUrl = value ? asString(value.dataBaseUrl) : undefined;
  const historyBaseUrl = value ? asString(value.historyBaseUrl) : undefined;
  const mapStyleUrl = value ? asString(value.mapStyleUrl) : undefined;
  const siteName = value ? asString(value.siteName) : undefined;
  const receiverName = value ? asString(value.receiverName) : undefined;
  const receiverLatitude = value ? asNumber(value.receiverLatitude) : undefined;
  const receiverLongitude = value ? asNumber(value.receiverLongitude) : undefined;
  const unitSystem = value ? unitSystemFrom(value.unitSystem) : undefined;
  if (!dataBaseUrl || !historyBaseUrl || !mapStyleUrl || !siteName || !receiverName || !unitSystem) {
    throw new Error('/api/config returned an invalid Vector runtime configuration');
  }
  const hasReceiverCoordinates = value
    ? 'receiverLatitude' in value || 'receiverLongitude' in value
    : false;
  if (
    hasReceiverCoordinates
    && (
      receiverLatitude === undefined
      || receiverLatitude < -90
      || receiverLatitude > 90
      || receiverLongitude === undefined
      || receiverLongitude < -180
      || receiverLongitude > 180
    )
  ) {
    throw new Error('/api/config returned invalid receiver coordinates');
  }
  return {
    dataBaseUrl,
    historyBaseUrl,
    mapStyleUrl,
    siteName,
    receiverName,
    ...(hasReceiverCoordinates ? { receiverLatitude, receiverLongitude } : {}),
    unitSystem,
  };
}

export async function loadReceiver(baseUrl: string, signal?: AbortSignal): Promise<Receiver> {
  const value = asRecord(await fetchJson(dataRequestUrl(baseUrl, 'receiver.json'), signal));
  if (!value) throw new Error('receiver.json does not contain an object');

  return {
    haveReplay: asBoolean(value.haveReplay),
    historyCount: Math.max(0, Math.floor(asNumber(value.history) ?? 0)),
    version: asString(value.version),
    refreshMs: Math.min(5_000, Math.max(500, asNumber(value.refresh) ?? 1_000)),
    latitude: asNumber(value.lat),
    longitude: asNumber(value.lon),
  };
}

const replaySourceFrom = (code: number): AircraftSource => {
  if (code === 0) return 'adsb_icao';
  if (code === 1) return 'adsb_icao_nt';
  if (code === 2) return 'adsr_icao';
  if (code === 3) return 'tisb_icao';
  if (code === 5) return 'mlat';
  if (code === 7) return 'mode_s';
  return 'other';
};

const bearingBetween = (from: [number, number] | undefined, to: [number, number]) => {
  if (!from || from[0] === to[0] && from[1] === to[1]) return undefined;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const degrees = (value: number) => value * 180 / Math.PI;
  const fromLatitude = radians(from[1]);
  const toLatitude = radians(to[1]);
  const deltaLongitude = radians(to[0] - from[0]);
  const y = Math.sin(deltaLongitude) * Math.cos(toLatitude);
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude)
    - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(deltaLongitude);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
};

const replayDatePath = (date: Date) => [
  date.getUTCFullYear(),
  String(date.getUTCMonth() + 1).padStart(2, '0'),
  String(date.getUTCDate()).padStart(2, '0'),
].join('/');

export async function loadAircraftReplayChunk(
  historyBaseUrl: string,
  date: Date,
  signal?: AbortSignal,
): Promise<AircraftHistorySnapshot[]> {
  const chunkIndex = date.getUTCHours() * 2 + Math.floor(date.getUTCMinutes() / 30);
  const path = `${replayDatePath(date)}/heatmap/${String(chunkIndex).padStart(2, '0')}.bin.ttf`;
  const buffer = await fetchBinary(dataRequestUrl(historyBaseUrl, path), signal);
  if (buffer.byteLength === 0 || buffer.byteLength % 16 !== 0) throw new Error('Invalid readsb replay file');

  const signed = new Int32Array(buffer);
  const unsigned = new Uint32Array(buffer);
  const bytes = new Uint8Array(buffer);
  const slices: number[] = [];
  for (let index = 0; index < signed.length; index += 4) {
    if (signed[index] === 0x0e7f7c9d) slices.push(index);
  }
  if (slices.length === 0) throw new Error('No readsb replay slices found');

  const identities = new Map<string, { flight?: string; squawk?: string }>();
  const previousPositions = new Map<string, [number, number]>();
  const snapshots = slices.map((sliceStart, sliceIndex): AircraftHistorySnapshot => {
    const sliceEnd = slices[sliceIndex + 1] ?? signed.length;
    const timestamp = unsigned[sliceStart + 2] / 1_000 + unsigned[sliceStart + 1] * 4_294_967.296;
    const aircraft: Aircraft[] = [];

    for (let index = sliceStart + 4; index < sliceEnd; index += 4) {
      const latitudeRaw = signed[index + 1];
      const id = `${(unsigned[index] & 0x01000000) !== 0 ? '~' : ''}${(unsigned[index] & 0x00ffffff).toString(16).padStart(6, '0')}`;
      if (latitudeRaw >= 1_073_741_824) {
        const byteOffset = 4 * (index + 2);
        const flight = String.fromCharCode(...bytes.slice(byteOffset, byteOffset + 8)).replaceAll('\0', '').trim() || undefined;
        identities.set(id, { flight, squawk: String(latitudeRaw & 0xffff).padStart(4, '0') });
        continue;
      }

      const latitude = latitudeRaw / 1_000_000;
      const longitude = signed[index + 2] / 1_000_000;
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;

      let altitudeCode = signed[index + 3] & 0xffff;
      if ((altitudeCode & 0x8000) !== 0) altitudeCode |= -0x10000;
      const onGround = altitudeCode === -123;
      const altitudeFt = altitudeCode === -123 || altitudeCode === -124 ? undefined : altitudeCode * 25;
      const speedCode = signed[index + 3] >> 16;
      const position: [number, number] = [longitude, latitude];
      const identity = identities.get(id);

      aircraft.push({
        id,
        flight: identity?.flight ?? id.toUpperCase(),
        altitudeFt,
        onGround,
        groundSpeedKts: speedCode === -1 ? undefined : speedCode / 10,
        trackDeg: bearingBetween(previousPositions.get(id), position),
        latitude,
        longitude,
        squawk: identity?.squawk,
        source: replaySourceFrom((unsigned[index] >> 27) & 0x1f),
        seenSeconds: 0,
        messages: 0,
        dbFlags: 0,
      });
      previousPositions.set(id, position);
    }

    return { aircraft, timestamp };
  });

  const futurePositions = new Map<string, {
    different?: [number, number];
    nearest: [number, number];
  }>();
  for (let snapshotIndex = snapshots.length - 1; snapshotIndex >= 0; snapshotIndex -= 1) {
    snapshots[snapshotIndex].aircraft = snapshots[snapshotIndex].aircraft.map((item) => {
      if (item.latitude === undefined || item.longitude === undefined) return item;

      const current: [number, number] = [item.longitude, item.latitude];
      const future = futurePositions.get(item.id);
      const nearestIsCurrent = future
        && future.nearest[0] === current[0]
        && future.nearest[1] === current[1];
      const nextDifferent = nearestIsCurrent ? future.different : future?.nearest;
      futurePositions.set(item.id, {
        nearest: current,
        different: nearestIsCurrent ? future?.different : future?.nearest,
      });

      if (item.trackDeg !== undefined || !nextDifferent) return item;
      const trackDeg = bearingBetween(current, nextDifferent);
      return trackDeg === undefined ? item : { ...item, trackDeg };
    });
  }

  return snapshots;
}

export function parseAircraftSnapshot(input: unknown) {
  const value = asRecord(input);
  if (!value) throw new Error('aircraft.json does not contain an object');

  const records = Array.isArray(value.aircraft) ? value.aircraft : [];
  const aircraft = records.flatMap((candidate): Aircraft[] => {
    const item = asRecord(candidate);
    const rawHex = item ? asString(item.hex) : undefined;
    if (!item || !rawHex) return [];

    const altitude = item.alt_baro;
    const barometricAltitudeFt = asNumber(altitude);
    const geometricAltitudeFt = asNumber(item.alt_geom);
    const barometricVerticalRateFpm = asNumber(item.baro_rate);
    const geometricVerticalRateFpm = asNumber(item.geom_rate);
    const verticalRate = barometricVerticalRateFpm ?? geometricVerticalRateFpm;

    return [{
      id: rawHex.toLowerCase(),
      flight: asString(item.flight) ?? asString(item.r) ?? rawHex.toUpperCase(),
      category: asString(item.category),
      registration: asString(item.r),
      aircraftType: asString(item.t),
      description: asString(item.desc),
      ownerOperator: asString(item.ownOp),
      year: asDisplayString(item.year),
      altitudeFt: barometricAltitudeFt ?? geometricAltitudeFt,
      barometricAltitudeFt,
      geometricAltitudeFt,
      onGround: altitude === 'ground' || item.ground === true,
      groundSpeedKts: asNumber(item.gs),
      indicatedAirSpeedKts: asNumber(item.ias),
      trueAirSpeedKts: asNumber(item.tas),
      mach: asNumber(item.mach),
      trackDeg: asNumber(item.track) ?? asNumber(item.true_heading),
      trackRateDegPerSecond: asNumber(item.track_rate),
      rollDeg: asNumber(item.roll),
      magneticHeadingDeg: asNumber(item.mag_heading),
      trueHeadingDeg: asNumber(item.true_heading),
      verticalRateFpm: verticalRate,
      barometricVerticalRateFpm,
      geometricVerticalRateFpm,
      latitude: asNumber(item.lat),
      longitude: asNumber(item.lon),
      positionSeenSeconds: asNumber(item.seen_pos),
      squawk: asString(item.squawk),
      emergency: asString(item.emergency),
      navigationQnhHpa: asNumber(item.nav_qnh),
      selectedAltitudeMcpFt: asNumber(item.nav_altitude_mcp),
      selectedAltitudeFmsFt: asNumber(item.nav_altitude_fms),
      selectedHeadingDeg: asNumber(item.nav_heading),
      navigationModes: asStringArray(item.nav_modes),
      adsbVersion: asNumber(item.version),
      nic: asNumber(item.nic),
      radiusOfContainmentM: asNumber(item.rc),
      nicBaro: asNumber(item.nic_baro),
      nacP: asNumber(item.nac_p),
      nacV: asNumber(item.nac_v),
      sil: asNumber(item.sil),
      silType: asString(item.sil_type),
      gva: asNumber(item.gva),
      sda: asNumber(item.sda),
      alert: asFlag(item.alert),
      spi: asFlag(item.spi),
      rssiDbfs: asNumber(item.rssi),
      mlatFields: asStringArray(item.mlat),
      tisbFields: asStringArray(item.tisb),
      windDirectionDeg: asNumber(item.wd),
      windSpeedKts: asNumber(item.ws),
      outsideAirTemperatureC: asNumber(item.oat),
      totalAirTemperatureC: asNumber(item.tat),
      source: sourceFrom(item.type),
      seenSeconds: asNumber(item.seen) ?? 0,
      messages: asNumber(item.messages) ?? 0,
      dbFlags: asNumber(item.dbFlags) ?? 0,
    }];
  });

  return {
    now: asNumber(value.now) ?? Date.now() / 1_000,
    messages: asNumber(value.messages) ?? 0,
    aircraft,
  };
}

export async function loadAircraft(baseUrl: string, signal?: AbortSignal) {
  return parseAircraftSnapshot(await fetchJson(dataRequestUrl(baseUrl, 'aircraft.json'), signal));
}

export function parseAircraftTrace(input: unknown): AircraftTracePoint[] {
  const value = asRecord(input);
  const baseTimestamp = value ? asNumber(value.timestamp) : undefined;
  if (!value || baseTimestamp === undefined || !Array.isArray(value.trace)) return [];

  return value.trace.flatMap((candidate): AircraftTracePoint[] => {
    if (!Array.isArray(candidate)) return [];
    const offset = asNumber(candidate[0]);
    const latitude = asNumber(candidate[1]);
    const longitude = asNumber(candidate[2]);
    if (offset === undefined || latitude === undefined || longitude === undefined) return [];
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];

    const altitude = candidate[3];
    const flags = asNumber(candidate[6]) ?? 0;
    return [{
      altitudeFt: asNumber(altitude),
      latitude,
      longitude,
      onGround: altitude === 'ground',
      stale: (flags & 1) !== 0,
      startsLeg: (flags & 2) !== 0,
      timestamp: offset > 1_000_000_000 ? offset : baseTimestamp + offset,
    }];
  });
}

export function mergeAircraftTraces(
  fullTrace: AircraftTracePoint[],
  recentTrace: AircraftTracePoint[],
): AircraftTracePoint[] {
  if (fullTrace.length === 0) return recentTrace;
  const lastFullTimestamp = fullTrace.at(-1)!.timestamp;
  return [
    ...fullTrace,
    ...recentTrace.filter((point) => point.timestamp > lastFullTimestamp),
  ];
}

export async function loadAircraftLegTrace(baseUrl: string, aircraftId: string, signal?: AbortSignal): Promise<AircraftTracePoint[]> {
  const normalizedId = aircraftId.toLowerCase();
  if (!/^~?[0-9a-f]{6}$/.test(normalizedId)) return [];

  const bucket = normalizedId.slice(-2);
  const loadTraceFile = async (kind: 'full' | 'recent') => {
    try {
      const path = `traces/${bucket}/trace_${kind}_${normalizedId}.json`;
      return parseAircraftTrace(await fetchJson(dataRequestUrl(baseUrl, path), signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      return [];
    }
  };

  const [fullTrace, recentTrace] = await Promise.all([
    loadTraceFile('full'),
    loadTraceFile('recent'),
  ]);
  return mergeAircraftTraces(fullTrace, recentTrace);
}
