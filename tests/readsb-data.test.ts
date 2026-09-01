import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeAircraftTraces, parseActualRangeOutline, parseAircraftSnapshot, parseAircraftTrace } from '../src/data/readsb.ts';

test('parses and closes the readsb actual range outline', () => {
  assert.deepEqual(parseActualRangeOutline({
    actualRange: {
      last24h: {
        points: [
          [52.1, 4.8, 12_000],
          [52.5, 5.4, 20_000],
          [51.9, 5.1, 8_000],
        ],
      },
    },
  }), [[
    [4.8, 52.1],
    [5.4, 52.5],
    [5.1, 51.9],
    [4.8, 52.1],
  ]]);
});

test('ignores malformed actual range points and avoids an antimeridian line', () => {
  assert.deepEqual(parseActualRangeOutline({
    points: [
      [52, 179],
      [52.1, 179.5],
      [null, 5],
      [91, 5],
      [52.2, -179.5],
      [52.3, -179],
    ],
  }), [
    [[179, 52], [179.5, 52.1]],
    [[-179.5, 52.2], [-179, 52.3]],
  ]);
});

test('maps the readsb fields used by the tar1090-style technical overview', () => {
  const snapshot = parseAircraftSnapshot({
    now: 1_724_000_000.5,
    messages: 123_456,
    aircraft: [{
      hex: '484fde',
      type: 'adsb_icao',
      flight: 'RYR58UE ',
      r: 'EI-IJF',
      t: 'B38M',
      desc: 'BOEING 737 MAX 8',
      ownOp: 'RYANAIR',
      year: 2022,
      category: 'A3',
      alt_baro: 39_000,
      alt_geom: 39_475,
      gs: 463.4,
      ias: 244,
      tas: 454,
      mach: 0.788,
      track: 81.25,
      track_rate: -0.31,
      roll: -2.4,
      mag_heading: 77.2,
      true_heading: 80.1,
      baro_rate: 64,
      geom_rate: 128,
      squawk: '2205',
      emergency: 'none',
      nav_qnh: 1013.2,
      nav_altitude_mcp: 39_008,
      nav_altitude_fms: 39_000,
      nav_heading: 78.75,
      nav_modes: ['autopilot', 'althold', 'lnav'],
      lat: 53.1,
      lon: 5.2,
      seen_pos: 0.4,
      version: 2,
      nic: 8,
      rc: 186,
      nic_baro: 1,
      nac_p: 9,
      nac_v: 2,
      sil: 3,
      sil_type: 'perhour',
      gva: 2,
      sda: 2,
      alert: 0,
      spi: 1,
      mlat: ['gs'],
      tisb: ['track'],
      wd: 265,
      ws: 47,
      oat: -52,
      tat: -31,
      messages: 5_772,
      seen: 0.2,
      rssi: -13.7,
      dbFlags: 1,
    }],
  });

  assert.equal(snapshot.aircraft.length, 1);
  assert.deepEqual(snapshot.aircraft[0], {
    id: '484fde',
    flight: 'RYR58UE',
    category: 'A3',
    registration: 'EI-IJF',
    aircraftType: 'B38M',
    description: 'BOEING 737 MAX 8',
    ownerOperator: 'RYANAIR',
    year: '2022',
    altitudeFt: 39_000,
    barometricAltitudeFt: 39_000,
    geometricAltitudeFt: 39_475,
    onGround: false,
    groundSpeedKts: 463.4,
    indicatedAirSpeedKts: 244,
    trueAirSpeedKts: 454,
    mach: 0.788,
    trackDeg: 81.25,
    trackRateDegPerSecond: -0.31,
    rollDeg: -2.4,
    magneticHeadingDeg: 77.2,
    trueHeadingDeg: 80.1,
    verticalRateFpm: 64,
    barometricVerticalRateFpm: 64,
    geometricVerticalRateFpm: 128,
    latitude: 53.1,
    longitude: 5.2,
    positionSeenSeconds: 0.4,
    squawk: '2205',
    emergency: 'none',
    navigationQnhHpa: 1013.2,
    selectedAltitudeMcpFt: 39_008,
    selectedAltitudeFmsFt: 39_000,
    selectedHeadingDeg: 78.75,
    navigationModes: ['autopilot', 'althold', 'lnav'],
    adsbVersion: 2,
    nic: 8,
    radiusOfContainmentM: 186,
    nicBaro: 1,
    nacP: 9,
    nacV: 2,
    sil: 3,
    silType: 'perhour',
    gva: 2,
    sda: 2,
    alert: false,
    spi: true,
    rssiDbfs: -13.7,
    mlatFields: ['gs'],
    tisbFields: ['track'],
    windDirectionDeg: 265,
    windSpeedKts: 47,
    outsideAirTemperatureC: -52,
    totalAirTemperatureC: -31,
    source: 'adsb_icao',
    seenSeconds: 0.2,
    messages: 5_772,
    dbFlags: 1,
  });
});

test('keeps unavailable values absent and recognizes ground aircraft', () => {
  const snapshot = parseAircraftSnapshot({
    aircraft: [
      { hex: 'abc123', alt_baro: 'ground', type: 'unknown-source', messages: 10 },
      { type: 'adsb_icao' },
      null,
    ],
  });

  assert.equal(snapshot.aircraft.length, 1);
  assert.equal(snapshot.aircraft[0].onGround, true);
  assert.equal(snapshot.aircraft[0].altitudeFt, undefined);
  assert.equal(snapshot.aircraft[0].source, 'other');
  assert.equal(snapshot.aircraft[0].flight, 'ABC123');
});

test('rejects a non-object aircraft snapshot', () => {
  assert.throws(() => parseAircraftSnapshot(null), /does not contain an object/);
});

test('parses trace timestamps, flags, ground altitude and skips invalid coordinates', () => {
  assert.deepEqual(parseAircraftTrace({
    timestamp: 1_724_000_000,
    trace: [
      [10, 52.1, 5.1, 12_000, 250, 90, 0],
      [20, 52.2, 5.2, 'ground', 30, 180, 3],
      [30, 92, 5.3, 13_000, 260, 91, 0],
      [1_724_000_040, 52.4, 5.4, 14_000, 270, 92, 2],
    ],
  }), [
    {
      altitudeFt: 12_000,
      latitude: 52.1,
      longitude: 5.1,
      onGround: false,
      stale: false,
      startsLeg: false,
      timestamp: 1_724_000_010,
    },
    {
      altitudeFt: undefined,
      latitude: 52.2,
      longitude: 5.2,
      onGround: true,
      stale: true,
      startsLeg: true,
      timestamp: 1_724_000_020,
    },
    {
      altitudeFt: 14_000,
      latitude: 52.4,
      longitude: 5.4,
      onGround: false,
      stale: false,
      startsLeg: true,
      timestamp: 1_724_000_040,
    },
  ]);
});

test('merges the full and recent traces without duplicating their overlap', () => {
  const point = (timestamp: number): ReturnType<typeof parseAircraftTrace>[number] => ({
    altitudeFt: 10_000,
    latitude: 52,
    longitude: 5,
    onGround: false,
    stale: false,
    startsLeg: false,
    timestamp,
  });

  assert.deepEqual(
    mergeAircraftTraces([point(100), point(200)], [point(150), point(200), point(250)]),
    [point(100), point(200), point(250)],
  );
  assert.deepEqual(mergeAircraftTraces([], [point(250)]), [point(250)]);
});
