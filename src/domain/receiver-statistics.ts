import type { Aircraft } from './aircraft';

export type ReceiverStatistics = {
  adsb: number;
  airborne: number;
  ground: number;
  mlat: number;
  modeS: number;
  other: number;
  positioned: number;
  total: number;
};

export const receiverStatistics = (aircraft: readonly Aircraft[]): ReceiverStatistics => {
  const statistics: ReceiverStatistics = {
    adsb: 0,
    airborne: 0,
    ground: 0,
    mlat: 0,
    modeS: 0,
    other: 0,
    positioned: 0,
    total: aircraft.length,
  };

  for (const item of aircraft) {
    if (item.latitude !== undefined && item.longitude !== undefined) statistics.positioned += 1;
    if (item.onGround) statistics.ground += 1;
    else statistics.airborne += 1;

    if (item.source.startsWith('adsb')) statistics.adsb += 1;
    else if (item.source === 'mlat') statistics.mlat += 1;
    else if (item.source === 'mode_s') statistics.modeS += 1;
    else statistics.other += 1;
  }

  return statistics;
};
