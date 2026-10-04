export type AircraftDatabaseStatus = {
  state: 'ready' | 'missing' | 'unavailable' | 'external';
  location: 'local' | 'receiver';
  updatedAt: number | null;
  records: number | null;
};

export const databaseStaleAfterMs = 48 * 60 * 60 * 1000;

/** Keep the public status small; never forward upstream paths or diagnostics. */
export function parseAircraftDatabaseStatus(value: unknown, now = Date.now()): AircraftDatabaseStatus {
  if (!value || typeof value !== 'object') throw new Error('Invalid aircraft database status');
  const { state, location, updatedAt, records } = value as AircraftDatabaseStatus;
  if (!['ready', 'missing', 'unavailable', 'external'].includes(state) || !['local', 'receiver'].includes(location)) {
    throw new Error('Invalid aircraft database status');
  }
  const hasSnapshot = typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt <= now + 300_000
    && typeof records === 'number' && Number.isInteger(records) && records > 0 && records <= 1_500_000;
  const empty = updatedAt === null && records === null;
  if (!(hasSnapshot || empty) || (state === 'ready' && !hasSnapshot) || (['missing', 'external'].includes(state) && !empty)) {
    throw new Error('Invalid aircraft database status');
  }
  return { state, location, updatedAt, records };
}

export function aircraftDatabaseHealth(status: AircraftDatabaseStatus, now = Date.now()) {
  return status.state === 'ready' && status.updatedAt !== null && now - status.updatedAt > databaseStaleAfterMs ? 'stale' : status.state;
}
