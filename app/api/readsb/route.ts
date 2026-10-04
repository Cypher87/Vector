import { parseReadsbProxyRequest, ReadsbRequestError } from '../../../src/server/readsb-proxy.ts';
import { loadReadsbResource, rejectProxyLoop } from '../../../src/server/readsb-source.ts';
import { ResourceError } from '../../../src/server/bounded-resource.ts';
import { readVectorServerConfig } from '../../../src/server/vector-config.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let config;
  let resource;
  try {
    resource = parseReadsbProxyRequest(request.url);
    config = readVectorServerConfig();
    rejectProxyLoop(request, config);
  } catch (error) {
    return Response.json({ error: error instanceof ReadsbRequestError || error instanceof ResourceError ? error.message : 'Vector server configuration is invalid' },
      { status: error instanceof ReadsbRequestError ? 400 : error instanceof ResourceError ? error.status : 500 });
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]);
  try {
    const body = await loadReadsbResource(config, resource.source, resource.path, signal);
    return new Response(new Uint8Array(body), { headers: {
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-type': resource.source === 'history' ? 'application/octet-stream' : 'application/json; charset=utf-8',
    } });
  } catch (error) {
    return Response.json({ error: signal.aborted ? 'Receiver request timed out' : error instanceof ResourceError ? error.message : 'Receiver is unreachable' },
      { status: signal.aborted ? 504 : error instanceof ResourceError ? error.status : 502 });
  }
}
