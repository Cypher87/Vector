import { parseLogbookFavorites, parseLogbookQuery } from '../../../src/domain/logbook.ts';
import { logbookSettings, startLogbook } from '../../../src/server/logbook-runtime.ts';
import { readVectorServerConfig } from '../../../src/server/vector-config.ts';
import { rejectProxyLoop, vectorProxyHeader } from '../../../src/server/readsb-source.ts';
import { readBoundedResponse, ResourceError } from '../../../src/server/bounded-resource.ts';

export const dynamic = 'force-dynamic';

async function queryLogbook(request: Request) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  let query;
  try {
    query = parseLogbookQuery(new URL(request.url));
    if (request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !request.body) throw new Error('Invalid body');
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
      const body = JSON.parse((await readBoundedResponse(new Response(request.body, {
        headers: { 'content-length': request.headers.get('content-length') || '0' },
      }), 24 * 1024, signal)).toString());
      if (!body || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'favorites')) throw new Error('Invalid body');
      query.favorites = parseLogbookFavorites(body.favorites);
    }
  } catch (error) { return Response.json({ error: 'invalid_query' }, { status: error instanceof ResourceError && error.status === 413 ? 413 : 400, headers }); }
  try {
    const config = readVectorServerConfig();
    rejectProxyLoop(request, config);
    if (config.source === 'vector') {
      const url = new URL('api/logbook', config.remoteBaseUrl!);
      url.search = new URL(request.url).search;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
      const response = await fetch(url, { signal, redirect: 'manual', cache: 'no-store',
        headers: { [vectorProxyHeader]: '1', ...(query.favorites === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(query.favorites === undefined ? {} : { method: 'POST', body: JSON.stringify({ favorites: query.favorites }) }),
      });
      const body = await readBoundedResponse(response, 256 * 1024, signal);
      const data = JSON.parse(body.toString());
      if (!Array.isArray(data.entries) || !Number.isInteger(data.total)) throw new Error('Invalid logbook response');
      return Response.json(data, { headers });
    }
    if (!logbookSettings().enabled) return Response.json({ error: 'disabled' }, { status: 503, headers });
    const recorder = startLogbook(config)!;
    return Response.json((await recorder.store).query(query), { headers });
  } catch (error) {
    return Response.json({ error: 'logbook_unavailable' }, { status: error instanceof ResourceError && error.status === 508 ? 508 : 503, headers });
  }
}

export async function GET(request: Request) { return queryLogbook(request); }

// Read-only search: the body avoids long URLs and does not store anyone's favorites.
export async function POST(request: Request) { return queryLogbook(request); }
