import { request as httpRequest } from 'node:http';

const cookieName = 'vector_update_admin';
const allowedActions = new Set(['login', 'logout', 'check', 'apply']);
const socketPath = '/run/vector-updater/control.sock';

type Result = { status: number; body: Record<string, unknown> };
type Call = (action: string, body: Record<string, unknown>, token: string) => Promise<Result>;

export const callUpdateService: Call = (action, body, token) => new Promise((resolve, reject) => {
  const payload = JSON.stringify(body);
  const request = httpRequest({ socketPath, path: `/${action}`, method: action === 'status' ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }, (response) => {
    const chunks: Buffer[] = []; let length = 0;
    response.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 16_384) { response.destroy(); reject(new Error('Invalid update response')); }
      else chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      try { resolve({ status: response.statusCode || 503, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
      catch { reject(new Error('Invalid update response')); }
    });
  });
  request.on('error', reject);
  request.setTimeout(40_000, () => request.destroy(new Error('Update service timeout')));
  request.end(action === 'status' ? undefined : payload);
});

export async function readUpdateBody(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('invalid_request');
  if (Number(request.headers.get('content-length') || 0) > 4096 || !request.body) throw new Error('invalid_request');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) throw new Error('invalid_request');
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_request');
    return body as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => {}); }
}

export async function handleUpdateRequest(request: Request, call: Call = callUpdateService, environment: Record<string, string | undefined> = process.env) {
  const headers = new Headers({ 'cache-control': 'no-store', vary: 'Cookie' });
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (environment.VECTOR_UPDATES_ENABLED !== 'true') return reply({ enabled: false, error: 'disabled' }, request.method === 'GET' ? 200 : 403);
  let action = 'status'; let body: Record<string, unknown> = {};
  if (request.method !== 'GET') {
    if (request.method !== 'POST' || request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'invalid_origin' }, 403);
    try { body = await readUpdateBody(request); } catch { return reply({ error: 'invalid_request' }, 400); }
    if (typeof body.action !== 'string' || !allowedActions.has(body.action)) return reply({ error: 'invalid_request' }, 400);
    action = body.action;
    // Only the documented action fields cross the privilege boundary.
    body = action === 'login' ? { password: body.password } : action === 'apply' ? { revision: body.revision, confirm: body.confirm } : {};
  }
  const token = request.headers.get('cookie')?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  const validToken = /^[a-f0-9]{64}$/.test(token) ? token : '';
  try {
    const result = await call(action, body, validToken);
    if (action === 'login' && result.status === 200) {
      if (typeof result.body.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.body.token)) throw new Error('Invalid session');
      headers.set('set-cookie', `${cookieName}=${result.body.token}; HttpOnly; SameSite=Strict; Path=/api/updates; Max-Age=900${new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : ''}`);
      return reply({ authenticated: true });
    }
    if (action === 'logout' || result.status === 401) headers.set('set-cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/updates; Max-Age=0`);
    return reply(result.body, result.status);
  } catch { return reply({ enabled: true, ready: false, error: 'service_unavailable' }, 503); }
}
