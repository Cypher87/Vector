import {
  loadReadsbTraceAircraftMetadata,
  loadTar1090AircraftMetadata,
  parseAircraftMetadataRequest,
  Tar1090DatabaseError,
} from '../../../src/server/tar1090-database';
import { readVectorServerConfig } from '../../../src/server/vector-config';
import { combineAircraftMetadata } from '../../../src/domain/aircraft-metadata';

export const dynamic = 'force-dynamic';

const REQUEST_TIMEOUT_MS = 8_000;

export async function GET(request: Request) {
  let ids: string[];
  let liveBaseUrl: URL;
  let tar1090BaseUrl: URL;
  try {
    ids = parseAircraftMetadataRequest(request.url);
    ({ liveBaseUrl, tar1090BaseUrl } = readVectorServerConfig());
  } catch (error) {
    return Response.json(
      { error: error instanceof Tar1090DatabaseError ? error.message : 'Vector server configuration is invalid' },
      { status: error instanceof Tar1090DatabaseError ? 400 : 500 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortForClient = () => controller.abort();
  request.signal.addEventListener('abort', abortForClient, { once: true });
  try {
    const databaseMetadata = await loadTar1090AircraftMetadata(tar1090BaseUrl, ids, controller.signal);
    const unresolvedIds = ids.filter((id) => {
      const metadata = databaseMetadata[id];
      return !metadata?.category && !metadata?.aircraftType && !metadata?.description;
    });
    const traceMetadata = unresolvedIds.length > 0
      ? await loadReadsbTraceAircraftMetadata(liveBaseUrl, unresolvedIds, controller.signal)
      : {};
    const aircraft = Object.fromEntries(ids.flatMap((id) => {
      const metadata = combineAircraftMetadata(traceMetadata[id], databaseMetadata[id] ?? {});
      return Object.values(metadata).some((value) => value !== undefined) ? [[id, metadata]] : [];
    }));
    return Response.json(
      { aircraft },
      { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
    );
  } catch (error) {
    const message = error instanceof Tar1090DatabaseError
      ? error.message
      : controller.signal.aborted ? 'tar1090 database request timed out' : 'tar1090 database is unreachable';
    return Response.json({ error: message }, { status: controller.signal.aborted ? 504 : 502 });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortForClient);
  }
}
