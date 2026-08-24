export type AircraftSource =
  | 'adsb_icao'
  | 'adsb_icao_nt'
  | 'adsr_icao'
  | 'tisb_icao'
  | 'mlat'
  | 'mode_s'
  | 'other';

export type Aircraft = {
  id: string;
  flight: string;
  category?: string;
  registration?: string;
  aircraftType?: string;
  description?: string;
  altitudeFt?: number;
  onGround: boolean;
  groundSpeedKts?: number;
  trackDeg?: number;
  verticalRateFpm?: number;
  latitude?: number;
  longitude?: number;
  squawk?: string;
  source: AircraftSource;
  seenSeconds: number;
  messages: number;
  dbFlags: number;
};

export type AircraftTracePoint = {
  altitudeFt?: number;
  latitude: number;
  longitude: number;
  onGround: boolean;
  stale: boolean;
  startsLeg: boolean;
  timestamp: number;
};

export type AircraftHistorySnapshot = {
  aircraft: Aircraft[];
  timestamp: number;
};

export type AircraftKind =
  | 'airliner'
  | 'balloon'
  | 'glider'
  | 'ground'
  | 'heavy'
  | 'helicopter'
  | 'high-performance'
  | 'light'
  | 'skydiver'
  | 'small'
  | 'uav'
  | 'ultralight'
  | 'turboprop'
  | 'unknown';

export type Receiver = {
  haveReplay: boolean;
  historyCount: number;
  version?: string;
  refreshMs: number;
  latitude?: number;
  longitude?: number;
};

export type FeedStatus = 'connecting' | 'live' | 'stale' | 'offline';

export type UnitSystem = 'aeronautical' | 'metric' | 'imperial';

export type RuntimeConfig = {
  dataBaseUrl: string;
  historyBaseUrl: string;
  mapStyleUrl: string;
  siteName: string;
  receiverName: string;
  unitSystem: UnitSystem;
};
