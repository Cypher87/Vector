import { resolve } from 'node:path';
import { isSyncDeviceOnline, publishSyncEvent, subscribeToSyncEvents } from './sync-events.ts';
import { SyncStore } from './sync-store.ts';
import type { SyncDeviceMetadata, SyncDeviceSummary } from '../sync/devices.ts';

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

const requestSession = (request: Request) => syncStore().touchSession(
  parseCookies(request)[SYNC_COOKIE],
  identifySyncDevice(request),
);
const publicSession = (result: {
  deviceId: string;
  devices: SyncDeviceSummary[];
  preferences: unknown;
  profileId: string;
  revision: number;
}) => ({
  connected: true,
  deviceId: result.deviceId,
  devices: result.devices.map((device) => ({
    ...device,
    online: isSyncDeviceOnline(result.profileId, device.id),
  })),
  preferences: result.preferences,
  profileId: result.profileId,
  revision: result.revision,
});

export function identifySyncDevice(request: Request): SyncDeviceMetadata {
  const userAgent = (request.headers.get('user-agent') ?? '').slice(0, 512);
  if (!userAgent) return { type: 'unknown' };

  const browser = /Edg(?:A|iOS)?\//.test(userAgent) ? 'Edge'
    : /OPR\//.test(userAgent) ? 'Opera'
      : /SamsungBrowser\//.test(userAgent) ? 'Samsung Internet'
        : /(?:Chrome|CriOS)\//.test(userAgent) ? 'Chrome'
          : /(?:Firefox|FxiOS)\//.test(userAgent) ? 'Firefox'
            : /Safari\//.test(userAgent) && /Version\//.test(userAgent) ? 'Safari'
              : undefined;
  const operatingSystem = /Windows NT/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
      : /(?:iPhone|iPad|iPod)/.test(userAgent) ? 'iOS'
        : /CrOS/.test(userAgent) ? 'ChromeOS'
          : /Macintosh|Mac OS X/.test(userAgent) ? 'macOS'
            : /Linux/.test(userAgent) ? 'Linux'
              : undefined;
  const type = /iPad|Tablet/.test(userAgent) || (/Android/.test(userAgent) && !/Mobile/.test(userAgent))
    ? 'tablet'
    : /Mobile|iPhone|iPod|Android/.test(userAgent) ? 'mobile'
      : browser || operatingSystem ? 'desktop' : 'unknown';
  return { browser, operatingSystem, type };
}

const syncFailure = (error: unknown) => {
  const code = error instanceof Error ? error.message : 'SYNC_FAILED';
  if (code === 'INVALID_ORIGIN') return responseError(403, code);
  if (code === 'SYNC_NOT_CONNECTED') return responseError(401, code);
  if (code === 'RATE_LIMITED') return responseError(429, code);
  if (code === 'DEVICE_LIMIT') return responseError(409, code);
  if (code === 'DEVICE_NOT_FOUND') return responseError(404, code);
  if (code === 'CURRENT_DEVICE') return responseError(400, code);
  if (code === 'DEVICE_NAME_INVALID') return responseError(400, code);
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
      ? publicSession(session)
      : { connected: false, preferences: {} }, { headers: noStoreHeaders });
  } catch (error) {
    return syncFailure(error);
  }
}

export async function createProfileResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const existing = await requestSession(request);
    if (existing) return Response.json(publicSession(existing), { headers: noStoreHeaders });
    assertWithinLimit(profileCreations, 100, 60 * 60 * 1_000);
    const input = await requestJson(request);
    const result = await syncStore().createProfile(input.preferences, identifySyncDevice(request));
    return Response.json(
      publicSession(result),
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
    const result = await syncStore().savePreferencePatch(session.profileId, input.patch);
    if (result.changed) {
      publishSyncEvent(session.profileId, {
        actorDeviceId: session.deviceId,
        revision: result.revision,
        type: 'preferences',
      });
    }
    return Response.json(result, { headers: noStoreHeaders });
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
    const result = await syncStore().pair(
      typeof input.code === 'string' ? input.code : '',
      identifySyncDevice(request),
    );
    publishSyncEvent(result.profileId, { actorDeviceId: result.deviceId, type: 'devices' });
    return Response.json(
      publicSession(result),
      { headers: { ...noStoreHeaders, 'set-cookie': syncCookie(request, result.token) } },
    );
  } catch (error) {
    return syncFailure(error);
  }
}

export async function disconnectResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const token = parseCookies(request)[SYNC_COOKIE];
    const session = await requestSession(request);
    const result = await syncStore().disconnect(token);
    if (session && result) publishSyncEvent(session.profileId, { actorDeviceId: session.deviceId, type: 'devices' });
    return Response.json(
      { connected: false, preferences: {} },
      { headers: { ...noStoreHeaders, 'set-cookie': expiredSyncCookie(request) } },
    );
  } catch (error) {
    return syncFailure(error);
  }
}

export async function disconnectDeviceResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const token = parseCookies(request)[SYNC_COOKIE];
    const session = await requestSession(request);
    if (!session) throw new Error('SYNC_NOT_CONNECTED');
    const input = await requestJson(request);
    if (typeof input.deviceId !== 'string' || input.deviceId.length > 128) throw new Error('INVALID_REQUEST');
    const result = await syncStore().disconnectDevice(session.profileId, token, input.deviceId);
    publishSyncEvent(session.profileId, { actorDeviceId: session.deviceId, type: 'devices' });
    return Response.json(publicSession(result), { headers: noStoreHeaders });
  } catch (error) {
    return syncFailure(error);
  }
}

export async function renameDeviceResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const token = parseCookies(request)[SYNC_COOKIE];
    const session = await requestSession(request);
    if (!session) throw new Error('SYNC_NOT_CONNECTED');
    const input = await requestJson(request);
    if (typeof input.deviceId !== 'string' || input.deviceId.length > 128) throw new Error('INVALID_REQUEST');
    const result = await syncStore().renameDevice(session.profileId, token, input.deviceId, input.name);
    publishSyncEvent(session.profileId, { actorDeviceId: session.deviceId, type: 'devices' });
    return Response.json(publicSession(result), { headers: noStoreHeaders });
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
    publishSyncEvent(session.profileId, { actorDeviceId: session.deviceId, type: 'deleted' });
    return Response.json(
      { connected: false, preferences: {} },
      { headers: { ...noStoreHeaders, 'set-cookie': expiredSyncCookie(request) } },
    );
  } catch (error) {
    return syncFailure(error);
  }
}

export async function eventsResponse(request: Request) {
  try {
    const session = await requestSession(request);
    if (!session) return responseError(401, 'SYNC_NOT_CONNECTED');
    const encoder = new TextEncoder();
    let stop: () => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (event: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            stop();
          }
        };
        const subscription = subscribeToSyncEvents(session.profileId, session.deviceId, send);
        const heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch {
            stop();
          }
        }, 25_000);
        const abort = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          const becameOffline = subscription.unsubscribe();
          if (becameOffline) {
            void syncStore().touchDevice(session.profileId, session.deviceId).then((changed) => {
              if (changed) publishSyncEvent(session.profileId, {
                actorDeviceId: session.deviceId,
                type: 'devices',
              });
            }).catch(() => undefined);
          }
          request.signal.removeEventListener('abort', abort);
          try {
            controller.close();
          } catch {
            // The client may already have closed the stream.
          }
        };
        stop = abort;
        request.signal.addEventListener('abort', abort, { once: true });
        send({ type: 'ready' });
        if (subscription.becameOnline) publishSyncEvent(session.profileId, {
          actorDeviceId: session.deviceId,
          type: 'devices',
        }, send);
        if (request.signal.aborted) abort();
      },
      cancel() {
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        ...noStoreHeaders,
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    return syncFailure(error);
  }
}
