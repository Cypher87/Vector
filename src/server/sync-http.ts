import { resolve } from 'node:path';
import { SyncStore } from './sync-store.ts';

export const SYNC_COOKIE = 'vector_sync';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const MAX_JSON_BYTES = 32_768;
const noStoreHeaders = { 'cache-control': 'no-store' };
const stores = new Map<string, SyncStore>();

type AttemptWindow = { count: number; resetAt: number };
const pairingAttempts: AttemptWindow = { count: 0, resetAt: 0 };
const profileCreations: AttemptWindow = { count: 0, resetAt: 0 };

export function readSyncStorePath(environment: Record<string, string | undefined> = process.env, cwd = process.cwd()) {
  const configured = environment.VECTOR_SYNC_STORE?.trim();
  if (configured) return resolve(configured);
  return process.platform === 'win32'
    ? resolve(cwd, '.vector', 'sync.json')
    : '/var/lib/vector/sync.json';
}

export function syncStore() {
  const path = readSyncStorePath();
  let store = stores.get(path);
  if (!store) {
    store = new SyncStore(path);
    stores.set(path, store);
  }
  return store;
}

export const parseCookies = (request: Request) => Object.fromEntries(
  (request.headers.get('cookie') ?? '').split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    try {
      return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
    } catch {
      return [];
    }
  }),
);

const secureRequest = (request: Request) => (
  new URL(request.url).protocol === 'https:'
  || request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'https'
);

export const syncCookie = (request: Request, token: string) => [
  `${SYNC_COOKIE}=${encodeURIComponent(token)}`,
  'Path=/',
  'HttpOnly',
  'SameSite=Lax',
  `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  secureRequest(request) ? 'Secure' : '',
].filter(Boolean).join('; ');

export const expiredSyncCookie = (request: Request) => [
  `${SYNC_COOKIE}=`,
  'Path=/',
  'HttpOnly',
  'SameSite=Lax',
  'Max-Age=0',
  secureRequest(request) ? 'Secure' : '',
].filter(Boolean).join('; ');

export function verifySameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new Error('INVALID_ORIGIN');
}

async function requestJson(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_JSON_BYTES) throw new Error('REQUEST_TOO_LARGE');
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new Error('REQUEST_TOO_LARGE');
  try {
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    throw new Error('INVALID_REQUEST');
  }
}

const responseError = (status: number, code: string) => Response.json(
  { error: code },
  { headers: noStoreHeaders, status },
);

function assertWithinLimit(window: AttemptWindow, maximum: number, duration: number) {
  const now = Date.now();
  if (window.resetAt <= now) {
    window.count = 0;
    window.resetAt = now + duration;
  }
  if (window.count >= maximum) throw new Error('RATE_LIMITED');
  window.count += 1;
}

const requestSession = (request: Request) => syncStore().session(parseCookies(request)[SYNC_COOKIE]);

const syncFailure = (error: unknown) => {
  const code = error instanceof Error ? error.message : 'SYNC_FAILED';
  if (code === 'INVALID_ORIGIN') return responseError(403, code);
  if (code === 'SYNC_NOT_CONNECTED') return responseError(401, code);
  if (code === 'RATE_LIMITED') return responseError(429, code);
  if (code === 'DEVICE_LIMIT') return responseError(409, code);
  if (code === 'PAIRING_CODE_INVALID' || code === 'INVALID_REQUEST' || code === 'REQUEST_TOO_LARGE') {
    return responseError(400, code);
  }
  console.error('Vector synchronization request failed:', error);
  return responseError(500, 'SYNC_FAILED');
};

export async function sessionResponse(request: Request) {
  try {
    const session = await requestSession(request);
    return Response.json(session
      ? { connected: true, ...session }
      : { connected: false, preferences: {} }, { headers: noStoreHeaders });
  } catch (error) {
    return syncFailure(error);
  }
}

export async function createProfileResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const existing = await requestSession(request);
    if (existing) return Response.json({ connected: true, ...existing }, { headers: noStoreHeaders });
    assertWithinLimit(profileCreations, 100, 60 * 60 * 1_000);
    const input = await requestJson(request);
    const result = await syncStore().createProfile(input.preferences);
    return Response.json(
      { connected: true, preferences: result.preferences, profileId: result.profileId },
      { headers: { ...noStoreHeaders, 'set-cookie': syncCookie(request, result.token) }, status: 201 },
    );
  } catch (error) {
    return syncFailure(error);
  }
}

export async function savePreferencesResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new Error('SYNC_NOT_CONNECTED');
    const input = await requestJson(request);
    const preferences = await syncStore().savePreferences(session.profileId, input.preferences);
    return Response.json({ preferences }, { headers: noStoreHeaders });
  } catch (error) {
    return syncFailure(error);
  }
}

export async function createPairingCodeResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new Error('SYNC_NOT_CONNECTED');
    return Response.json(await syncStore().createPairingCode(session.profileId), { headers: noStoreHeaders });
  } catch (error) {
    return syncFailure(error);
  }
}

export async function pairResponse(request: Request) {
  try {
    verifySameOrigin(request);
    assertWithinLimit(pairingAttempts, 50, 10 * 60 * 1_000);
    const input = await requestJson(request);
    const result = await syncStore().pair(typeof input.code === 'string' ? input.code : '');
    return Response.json(
      { connected: true, preferences: result.preferences, profileId: result.profileId },
      { headers: { ...noStoreHeaders, 'set-cookie': syncCookie(request, result.token) } },
    );
  } catch (error) {
    return syncFailure(error);
  }
}

export async function disconnectResponse(request: Request) {
  try {
    verifySameOrigin(request);
    await syncStore().disconnect(parseCookies(request)[SYNC_COOKIE]);
    return Response.json(
      { connected: false, preferences: {} },
      { headers: { ...noStoreHeaders, 'set-cookie': expiredSyncCookie(request) } },
    );
  } catch (error) {
    return syncFailure(error);
  }
}

export async function deleteProfileResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const session = await requestSession(request);
    if (!session) throw new Error('SYNC_NOT_CONNECTED');
    await syncStore().deleteProfile(session.profileId);
    return Response.json(
      { connected: false, preferences: {} },
      { headers: { ...noStoreHeaders, 'set-cookie': expiredSyncCookie(request) } },
    );
  } catch (error) {
    return syncFailure(error);
  }
}
