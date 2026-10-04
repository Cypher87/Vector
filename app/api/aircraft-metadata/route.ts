import { parseAircraftMetadataRequest, Tar1090DatabaseError } from '../../../src/server/tar1090-database.ts';
import { loadVectorAircraftMetadata } from '../../../src/server/aircraft-metadata-source.ts';
import { readVectorServerConfig } from '../../../src/server/vector-config.ts';
import { rejectProxyLoop } from '../../../src/server/readsb-source.ts';
import { ResourceError } from '../../../src/server/bounded-resource.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let ids;
  let config;
  try {
    ids = parseAircraftMetadataRequest(request.url);
    config = readVectorServerConfig();
    rejectProxyLoop(request, config);
  } catch (error) {
    return Response.json({ error: error instanceof Tar1090DatabaseError || error instanceof ResourceError ? error.message : 'Vector server configuration is invalid' },
      { status: error instanceof Tar1090DatabaseError ? 400 : error instanceof ResourceError ? error.status : 500 });
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
  try {
    const aircraft = await loadVectorAircraftMetadata(config, ids, signal);
    return Response.json({ aircraft }, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return Response.json({ error: signal.aborted ? 'Aircraft metadata request timed out' : 'Aircraft metadata is unavailable' },
      { status: signal.aborted ? 504 : 502 });
  }
}
