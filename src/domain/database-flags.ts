export type AircraftDatabaseFlag = 'military' | 'interesting' | 'pia' | 'ladd';

const databaseFlagBits: Array<{ bit: number; flag: AircraftDatabaseFlag }> = [
  { bit: 1, flag: 'military' },
  { bit: 2, flag: 'interesting' },
  { bit: 4, flag: 'pia' },
  { bit: 8, flag: 'ladd' },
];

const knownDatabaseFlagMask = databaseFlagBits.reduce((mask, entry) => mask | entry.bit, 0);

export const decodeAircraftDatabaseFlags = (value: number) => {
  const normalized = (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0) >>> 0;
  return {
    flags: databaseFlagBits
      .filter(({ bit }) => (normalized & bit) !== 0)
      .map(({ flag }) => flag),
    unknownMask: (normalized & ~knownDatabaseFlagMask) >>> 0,
  };
};
