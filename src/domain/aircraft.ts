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
  ownerOperator?: string;
  year?: string;
  altitudeFt?: number;
  barometricAltitudeFt?: number;
  geometricAltitudeFt?: number;
  onGround: boolean;
  groundSpeedKts?: number;
  indicatedAirSpeedKts?: number;
  trueAirSpeedKts?: number;
  mach?: number;
  trackDeg?: number;
  trackRateDegPerSecond?: number;
  rollDeg?: number;
  magneticHeadingDeg?: number;
  trueHeadingDeg?: number;
  verticalRateFpm?: number;
  barometricVerticalRateFpm?: number;
  geometricVerticalRateFpm?: number;
  latitude?: number;
  longitude?: number;
  positionSeenSeconds?: number;
  squawk?: string;
  emergency?: string;
  navigationQnhHpa?: number;
  selectedAltitudeMcpFt?: number;
  selectedAltitudeFmsFt?: number;
  selectedHeadingDeg?: number;
  navigationModes?: string[];
  adsbVersion?: number;
  nic?: number;
  radiusOfContainmentM?: number;
  nicBaro?: number;
  nacP?: number;
  nacV?: number;
  sil?: number;
  silType?: string;
  gva?: number;
  sda?: number;
  alert?: boolean;
  spi?: boolean;
  rssiDbfs?: number;
  messageRate?: number;
  mlatFields?: string[];
  tisbFields?: string[];
  windDirectionDeg?: number;
  windSpeedKts?: number;
  outsideAirTemperatureC?: number;
  totalAirTemperatureC?: number;
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
