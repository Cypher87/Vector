import { parseAircraftDatabaseStatus, type AircraftDatabaseStatus } from '../domain/aircraft-database-status.ts';
import { localAircraftDatabaseStatus } from './aircraft-database.ts';
import { readBoundedResponse } from './bounded-resource.ts';
import { vectorProxyHeader } from './readsb-source.ts';
import type { VectorServerConfig } from './vector-config.ts';

export async function loadAircraftDatabaseStatus(config: VectorServerConfig, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<AircraftDatabaseStatus> {
  if (config.source === 'vector') {
    const response = await fetcher(new URL('api/aircraft-database-status', config.remoteBaseUrl!), {
      signal, redirect: 'manual', cache: 'no-store', headers: { [vectorProxyHeader]: '1' },
    });
    const body = await readBoundedResponse(response, 4096, signal);
    const status = parseAircraftDatabaseStatus(JSON.parse(body.toString()));
    return { ...status, location: 'receiver' };
  }
  return localAircraftDatabaseStatus(config.databaseFile, signal);
}
