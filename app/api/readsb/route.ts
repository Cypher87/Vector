import {
  buildReadsbUpstreamUrl,
  isRedirectStatus,
  parseReadsbProxyRequest,
  ReadsbRequestError,
  type ReadsbSource,
} from '../../../src/server/readsb-proxy';
import { readVectorServerConfig } from '../../../src/server/vector-config';

export const dynamic = 'force-dynamic';

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 32 * 1_024 * 1_024;

class UpstreamResponseError extends Error {}

const responseTypeFor = (source: ReadsbSource, path: string) =>
  source === 'history' && path.endsWith('.bin.ttf')
    ? 'application/octet-stream'
    : 'application/json; charset=utf-8';

async function readLimitedBody(response: Response, controller: AbortController) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    controller.abort();
    throw new UpstreamResponseError('Receiver response is too large');
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.byteLength;
    if (totalLength > MAX_RESPONSE_BYTES) {
      controller.abort();
      throw new UpstreamResponseError('Receiver response is too large');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function GET(request: Request) {
  let source: ReadsbSource;
  let path: string;
  let upstreamUrl: URL;
  try {
    ({ source, path } = parseReadsbProxyRequest(request.url));
    upstreamUrl = buildReadsbUpstreamUrl(readVectorServerConfig(), source, path);
  } catch (error) {
    const message = error instanceof ReadsbRequestError
      ? error.message
      : 'Vector server configuration is invalid';
    return Response.json({ error: message }, { status: error instanceof ReadsbRequestError ? 400 : 500 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortForClient = () => controller.abort();
  request.signal.addEventListener('abort', abortForClient, { once: true });

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { accept: source === 'history' ? 'application/octet-stream' : 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (isRedirectStatus(upstream.status)) {
      throw new UpstreamResponseError('Receiver redirects are not allowed');
    }
    if (!upstream.ok) {
      throw new UpstreamResponseError(`Receiver returned HTTP ${upstream.status}`);
    }
    const body = await readLimitedBody(upstream, controller);
    return new Response(body, {
      headers: {
        'cache-control': 'no-store',
        'content-type': responseTypeFor(source, path),
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UpstreamResponseError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    return Response.json(
      { error: controller.signal.aborted ? 'Receiver request timed out' : 'Receiver is unreachable' },
      { status: controller.signal.aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abortForClient);
  }
}
