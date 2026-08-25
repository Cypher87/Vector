import type { Aircraft, UnitSystem } from '../domain/aircraft';
import { localeForLanguage, translate, type Language, type TranslationKey } from '../i18n';
import { distanceValue, speedValue, verticalRateValue } from '../units';

type AircraftTechnicalDataProps = {
  aircraft: Aircraft;
  distanceKilometres?: number;
  historyMode: boolean;
  language: Language;
  unitSystem: UnitSystem;
};

type TechnicalRow = {
  label: TranslationKey;
  value: string;
};

const sourceLabel = (source: Aircraft['source']) => source === 'mlat'
  ? 'MLAT'
  : source.startsWith('adsb')
    ? 'ADS-B'
    : source.replaceAll('_', ' ').toUpperCase();

const formatArray = (value?: string[]) => value?.length ? value.join(', ') : '—';

function TechnicalSection({
  language,
  rows,
  title,
}: {
  language: Language;
  rows: TechnicalRow[];
  title: TranslationKey;
}) {
  return (
    <section className="technical-section">
      <h4>{translate(language, title)}</h4>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{translate(language, row.label)}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function AircraftTechnicalData({
  aircraft,
  distanceKilometres,
  historyMode,
  language,
  unitSystem,
}: AircraftTechnicalDataProps) {
  const locale = localeForLanguage[language];
  const number = (value?: number, digits = 0) => value === undefined
    ? '—'
    : new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
  const withUnit = (value: number | undefined, unit: string, digits = 0) =>
    value === undefined ? '—' : `${number(value, digits)} ${unit}`;
  const degrees = (value?: number, digits = 1) => value === undefined ? '—' : `${number(value, digits)}°`;
  const altitude = (feet?: number) => {
    if (feet === undefined) return '—';
    return unitSystem === 'metric'
      ? withUnit(feet * 0.3048, 'm')
      : withUnit(feet, 'ft');
  };
  const speed = (knots?: number) => {
    const reading = speedValue(knots, unitSystem, language);
    return `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}`;
  };
  const verticalRate = (feetPerMinute?: number) => {
    const reading = verticalRateValue(feetPerMinute, unitSystem, language);
    return `${reading.value}${reading.unit ? ` ${reading.unit}` : ''}`;
  };
  const boolean = (value?: boolean) => value === undefined
    ? '—'
    : translate(language, value ? 'yes' : 'no');
  const distance = distanceValue(distanceKilometres, unitSystem, language);

  const identityRows: TechnicalRow[] = [
    { label: 'icaoAddress', value: aircraft.id.toUpperCase() },
    { label: 'callsign', value: aircraft.flight || '—' },
    { label: 'registration', value: aircraft.registration ?? '—' },
    { label: 'typeCode', value: aircraft.aircraftType ?? '—' },
    { label: 'typeDescription', value: aircraft.description ?? '—' },
    { label: 'category', value: aircraft.category ?? '—' },
    { label: 'year', value: aircraft.year ?? '—' },
    { label: 'ownerOperator', value: aircraft.ownerOperator ?? '—' },
    { label: 'databaseFlags', value: `0x${aircraft.dbFlags.toString(16).padStart(2, '0').toUpperCase()}` },
  ];

  const movementRows: TechnicalRow[] = [
    { label: 'barometricAltitude', value: aircraft.onGround ? translate(language, 'ground') : altitude(aircraft.barometricAltitudeFt) },
    { label: 'geometricAltitude', value: aircraft.onGround ? translate(language, 'ground') : altitude(aircraft.geometricAltitudeFt) },
    { label: 'groundSpeed', value: speed(aircraft.groundSpeedKts) },
    { label: 'indicatedAirspeed', value: speed(aircraft.indicatedAirSpeedKts) },
    { label: 'trueAirspeed', value: speed(aircraft.trueAirSpeedKts) },
    { label: 'machNumber', value: aircraft.mach === undefined ? '—' : number(aircraft.mach, 3) },
    { label: 'barometricVerticalRate', value: verticalRate(aircraft.barometricVerticalRateFpm) },
    { label: 'geometricVerticalRate', value: verticalRate(aircraft.geometricVerticalRateFpm) },
    { label: 'trueTrack', value: degrees(aircraft.trackDeg, 2) },
    { label: 'trackRate', value: aircraft.trackRateDegPerSecond === undefined ? '—' : `${number(aircraft.trackRateDegPerSecond, 2)} °/s` },
    { label: 'trueHeading', value: degrees(aircraft.trueHeadingDeg, 2) },
    { label: 'magneticHeading', value: degrees(aircraft.magneticHeadingDeg, 2) },
    { label: 'roll', value: degrees(aircraft.rollDeg, 2) },
    {
      label: 'position',
      value: aircraft.latitude === undefined || aircraft.longitude === undefined
        ? '—'
        : `${number(aircraft.latitude, 5)}, ${number(aircraft.longitude, 5)}`,
    },
    { label: 'distance', value: `${distance.value}${distance.unit ? ` ${distance.unit}` : ''}` },
  ];

  const navigationRows: TechnicalRow[] = [
    { label: 'squawk', value: aircraft.squawk ?? '—' },
    { label: 'emergencyState', value: aircraft.emergency?.toUpperCase() ?? '—' },
    { label: 'selectedAltitudeMcp', value: altitude(aircraft.selectedAltitudeMcpFt) },
    { label: 'selectedAltitudeFms', value: altitude(aircraft.selectedAltitudeFmsFt) },
    { label: 'selectedHeading', value: degrees(aircraft.selectedHeadingDeg, 2) },
    { label: 'qnh', value: withUnit(aircraft.navigationQnhHpa, 'hPa', 1) },
    { label: 'navigationModes', value: formatArray(aircraft.navigationModes?.map((mode) => mode.replaceAll('_', ' ').toUpperCase())) },
  ];

  const signalRows: TechnicalRow[] = [
    { label: 'source', value: sourceLabel(aircraft.source) },
    { label: 'signalStrength', value: historyMode ? '—' : withUnit(aircraft.rssiDbfs, 'dBFS', 1) },
    { label: 'messageRate', value: historyMode || aircraft.messageRate === undefined ? '—' : `${number(aircraft.messageRate, 1)} msg/s` },
    { label: 'messageCount', value: historyMode ? '—' : number(aircraft.messages) },
    { label: 'lastSeen', value: historyMode ? '—' : withUnit(aircraft.seenSeconds, 's', 1) },
    { label: 'lastPosition', value: historyMode ? '—' : withUnit(aircraft.positionSeenSeconds, 's', 1) },
    { label: 'adsbVersion', value: aircraft.adsbVersion === undefined ? '—' : `DO-260${aircraft.adsbVersion === 0 ? '' : aircraft.adsbVersion === 1 ? 'A' : 'B'} (${aircraft.adsbVersion})` },
    { label: 'nic', value: number(aircraft.nic) },
    { label: 'containmentRadius', value: withUnit(aircraft.radiusOfContainmentM, 'm') },
    { label: 'nicBaro', value: number(aircraft.nicBaro) },
    { label: 'nacP', value: number(aircraft.nacP) },
    { label: 'nacV', value: number(aircraft.nacV) },
    { label: 'sil', value: aircraft.sil === undefined ? '—' : `${number(aircraft.sil)}${aircraft.silType ? ` · ${aircraft.silType}` : ''}` },
    { label: 'sda', value: number(aircraft.sda) },
    { label: 'gva', value: number(aircraft.gva) },
    { label: 'alert', value: boolean(aircraft.alert) },
    { label: 'spi', value: boolean(aircraft.spi) },
    { label: 'mlatFields', value: formatArray(aircraft.mlatFields) },
    { label: 'tisbFields', value: formatArray(aircraft.tisbFields) },
  ];

  const weatherRows: TechnicalRow[] = [
    {
      label: 'wind',
      value: aircraft.windDirectionDeg === undefined && aircraft.windSpeedKts === undefined
        ? '—'
        : `${degrees(aircraft.windDirectionDeg, 0)} · ${speed(aircraft.windSpeedKts)}`,
    },
    {
      label: 'outsideAirTemperature',
      value: aircraft.outsideAirTemperatureC === undefined
        ? '—'
        : withUnit(unitSystem === 'imperial' ? aircraft.outsideAirTemperatureC * 9 / 5 + 32 : aircraft.outsideAirTemperatureC, unitSystem === 'imperial' ? '°F' : '°C'),
    },
    {
      label: 'totalAirTemperature',
      value: aircraft.totalAirTemperatureC === undefined
        ? '—'
        : withUnit(unitSystem === 'imperial' ? aircraft.totalAirTemperatureC * 9 / 5 + 32 : aircraft.totalAirTemperatureC, unitSystem === 'imperial' ? '°F' : '°C'),
    },
  ];
  const hasWeather = [aircraft.windDirectionDeg, aircraft.windSpeedKts, aircraft.outsideAirTemperatureC, aircraft.totalAirTemperatureC]
    .some((value) => value !== undefined);

  return (
    <div className="technical-data" id="aircraft-technical-data">
      <div className="technical-data-heading">
        <h3>{translate(language, 'technicalData')}</h3>
        <span>readsb · aircraft.json</span>
      </div>
      <TechnicalSection language={language} rows={identityRows} title="identity" />
      <TechnicalSection language={language} rows={movementRows} title="movementAndPosition" />
      <TechnicalSection language={language} rows={navigationRows} title="navigation" />
      <TechnicalSection language={language} rows={signalRows} title="signalAndIntegrity" />
      {hasWeather && <TechnicalSection language={language} rows={weatherRows} title="weather" />}
    </div>
  );
}
