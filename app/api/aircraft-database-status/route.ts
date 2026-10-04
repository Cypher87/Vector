import { loadAircraftDatabaseStatus } from '../../../src/server/aircraft-database-status.ts';
import { readVectorServerConfig } from '../../../src/server/vector-config.ts';
import { rejectProxyLoop } from '../../../src/server/readsb-source.ts';
import { ResourceError } from '../../../src/server/bounded-resource.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (new URL(request.url).search) return Response.json({ error: 'Query parameters are not supported' }, { status: 400 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
  try {
    const config = readVectorServerConfig();
    rejectProxyLoop(request, config);
    return Response.json(await loadAircraftDatabaseStatus(config, signal), {
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch (error) {
    return Response.json({ error: 'Aircraft database status is unavailable' }, {
      status: signal.aborted ? 504 : error instanceof ResourceError ? error.status : 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
