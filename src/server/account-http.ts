import {
  accountStore,
  assertLoginAllowed,
  authProviders,
  beginOAuth,
  clearFailedLogins,
  expiredSessionCookie,
  finishOAuth,
  oauthResultRedirect,
  parseCookies,
  recordFailedLogin,
  requestSession,
  SESSION_COOKIE,
  sessionCookie,
  verifySameOrigin,
} from './account-service';
import { readAccountServerConfig } from './account-config';

const noStoreHeaders = { 'cache-control': 'no-store' };

const responseError = (status: number, code: string) => Response.json(
  { error: code },
  { headers: noStoreHeaders, status },
);

async function requestJson(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 32_768) throw new Error('REQUEST_TOO_LARGE');
  const text = await request.text();
  if (text.length > 32_768) throw new Error('REQUEST_TOO_LARGE');
  return JSON.parse(text) as Record<string, unknown>;
}

const authFailure = (error: unknown) => {
  const code = error instanceof Error ? error.message : 'AUTH_FAILED';
  if (code === 'INVALID_ORIGIN') return responseError(403, code);
  if (code === 'RATE_LIMITED') return responseError(429, code);
  if (code === 'EMAIL_EXISTS') return responseError(409, code);
  if (code === 'REGISTRATION_DISABLED') return responseError(403, code);
  if (code.startsWith('INVALID_') || code === 'REQUEST_TOO_LARGE') return responseError(400, code);
  console.error('Vector account request failed:', error);
  return responseError(500, 'AUTH_FAILED');
};

export async function providersResponse() {
  try {
    return Response.json(await authProviders(), { headers: noStoreHeaders });
  } catch (error) {
    return authFailure(error);
  }
}

export async function sessionResponse(request: Request) {
  try {
    const session = await requestSession(request);
    return Response.json(session ?? { account: null, preferences: {} }, { headers: noStoreHeaders });
  } catch (error) {
    return authFailure(error);
  }
}

export async function localRegisterResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const providers = await authProviders();
    if (!providers.localRegistration) throw new Error('REGISTRATION_DISABLED');
    const input = await requestJson(request);
    const account = await accountStore().createLocalUser({
      email: typeof input.email === 'string' ? input.email : '',
      name: typeof input.name === 'string' ? input.name : '',
      onlyFirst: readAccountServerConfig().localRegistration === 'first-user',
      password: typeof input.password === 'string' ? input.password : '',
    });
    const token = await accountStore().createSession(account.id);
    return Response.json(
      { account, preferences: {} },
      { headers: { ...noStoreHeaders, 'set-cookie': sessionCookie(request, token) }, status: 201 },
    );
  } catch (error) {
    return authFailure(error);
  }
}

export async function localLoginResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const input = await requestJson(request);
    const email = typeof input.email === 'string' ? input.email : '';
    const password = typeof input.password === 'string' ? input.password : '';
    assertLoginAllowed(email);
    const account = await accountStore().authenticateLocal(email, password);
    if (!account) {
      recordFailedLogin(email);
      return responseError(401, 'INVALID_CREDENTIALS');
    }
    clearFailedLogins(email);
    const token = await accountStore().createSession(account.id);
    const session = await accountStore().session(token);
    return Response.json(session, { headers: { ...noStoreHeaders, 'set-cookie': sessionCookie(request, token) } });
  } catch (error) {
    return authFailure(error);
  }
}

export async function logoutResponse(request: Request) {
  try {
    verifySameOrigin(request);
    await accountStore().deleteSession(parseCookies(request)[SESSION_COOKIE]);
    return Response.json(
      { ok: true },
      { headers: { ...noStoreHeaders, 'set-cookie': expiredSessionCookie(request) } },
    );
  } catch (error) {
    return authFailure(error);
  }
}

export async function preferencesResponse(request: Request) {
  try {
    verifySameOrigin(request);
    const session = await requestSession(request);
    if (!session) return responseError(401, 'UNAUTHENTICATED');
    const body = await requestJson(request);
    const preferences = await accountStore().savePreferences(session.account.id, body.preferences);
    return Response.json({ preferences }, { headers: noStoreHeaders });
  } catch (error) {
    return authFailure(error);
  }
}

export async function oauthStartResponse(provider: 'apple' | 'google', request: Request) {
  try {
    return Response.redirect(await beginOAuth(provider, request), 302);
  } catch (error) {
    console.error(`Vector ${provider} sign-in could not start:`, error);
    return Response.redirect(oauthResultRedirect(request, 'provider_unavailable'), 302);
  }
}

export async function oauthCallbackResponse(provider: 'apple' | 'google', request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 32_768) throw new Error('REQUEST_TOO_LARGE');
    const parameters = request.method === 'POST'
      ? new URLSearchParams(await request.text())
      : new URL(request.url).searchParams;
    if (parameters.get('error')) throw new Error('OAUTH_REJECTED');
    const result = await finishOAuth(provider, request, parameters);
    return new Response(null, {
      headers: {
        location: oauthResultRedirect(request).toString(),
        'set-cookie': sessionCookie(request, result.token),
      },
      status: 303,
    });
  } catch (error) {
    console.error(`Vector ${provider} sign-in failed:`, error);
    return Response.redirect(oauthResultRedirect(request, 'sign_in_failed'), 303);
  }
}
