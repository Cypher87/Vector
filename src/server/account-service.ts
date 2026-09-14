import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AccountStore, type OAuthProfile, type PublicAccount } from './account-store';
import { readAccountServerConfig } from './account-config';

export const SESSION_COOKIE = 'vector_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const stores = new Map<string, AccountStore>();
const failedLogins = new Map<string, { count: number; resetAt: number }>();

export type AuthProviders = {
  apple: boolean;
  google: boolean;
  local: boolean;
  localRegistration: boolean;
};

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
const sha256Base64url = (value: string) => createHash('sha256').update(value).digest('base64url');

export function accountStore() {
  const config = readAccountServerConfig();
  let store = stores.get(config.storePath);
  if (!store) {
    store = new AccountStore(config.storePath);
    stores.set(config.storePath, store);
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

const secureRequest = (request: Request) => {
  const config = readAccountServerConfig();
  return (config.publicUrl ?? new URL(request.url)).protocol === 'https:';
};

export const sessionCookie = (request: Request, token: string) => [
  `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
  'Path=/',
  'HttpOnly',
  'SameSite=Lax',
  `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  secureRequest(request) ? 'Secure' : '',
].filter(Boolean).join('; ');

export const expiredSessionCookie = (request: Request) => [
  `${SESSION_COOKIE}=`,
  'Path=/',
  'HttpOnly',
  'SameSite=Lax',
  'Max-Age=0',
  secureRequest(request) ? 'Secure' : '',
].filter(Boolean).join('; ');

export const requestSession = (request: Request) => accountStore().session(parseCookies(request)[SESSION_COOKIE]);

export function verifySameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const requestOrigin = readAccountServerConfig().publicUrl?.origin ?? new URL(request.url).origin;
  if (origin !== requestOrigin) throw new Error('INVALID_ORIGIN');
}

export async function authProviders(): Promise<AuthProviders> {
  const config = readAccountServerConfig();
  const localRegistration = config.localRegistration === 'always'
    || (config.localRegistration === 'first-user' && await accountStore().localUserCount() === 0);
  return {
    apple: Boolean(config.apple),
    google: Boolean(config.google),
    local: true,
    localRegistration,
  };
}

const loginKey = (email: string) => email.trim().toLowerCase().slice(0, 254);

export function assertLoginAllowed(email: string) {
  const key = loginKey(email);
  const attempt = failedLogins.get(key);
  if (!attempt) return;
  if (attempt.resetAt <= Date.now()) {
    failedLogins.delete(key);
    return;
  }
  if (attempt.count >= 8) throw new Error('RATE_LIMITED');
}

export function recordFailedLogin(email: string) {
  const key = loginKey(email);
  const current = failedLogins.get(key);
  failedLogins.set(key, current && current.resetAt > Date.now()
    ? { ...current, count: current.count + 1 }
    : { count: 1, resetAt: Date.now() + 15 * 60 * 1_000 });
}

export const clearFailedLogins = (email: string) => failedLogins.delete(loginKey(email));

const originFor = (request: Request) => readAccountServerConfig().publicUrl?.origin ?? new URL(request.url).origin;
const callbackUrl = (request: Request, provider: 'apple' | 'google') => (
  new URL(`/api/auth/oauth/${provider}/callback`, originFor(request)).toString()
);

export async function beginOAuth(provider: 'apple' | 'google', request: Request) {
  const config = readAccountServerConfig();
  const state = randomToken();
  const nonce = randomToken();

  if (provider === 'google') {
    if (!config.google) throw new Error('PROVIDER_DISABLED');
    const codeVerifier = randomToken(48);
    await accountStore().createOAuthAttempt(provider, state, nonce, codeVerifier);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.google.clientId,
      code_challenge: sha256Base64url(codeVerifier),
      code_challenge_method: 'S256',
      nonce,
      redirect_uri: callbackUrl(request, provider),
      response_type: 'code',
      scope: 'openid email profile',
      state,
    }).toString();
    return url;
  }

  if (!config.apple) throw new Error('PROVIDER_DISABLED');
  await accountStore().createOAuthAttempt(provider, state, nonce);
  const url = new URL('https://appleid.apple.com/auth/authorize');
  url.search = new URLSearchParams({
    client_id: config.apple.clientId,
    nonce,
    redirect_uri: callbackUrl(request, provider),
    response_mode: 'form_post',
    response_type: 'code',
    scope: 'name email',
    state,
  }).toString();
  return url;
}

type JwtClaims = Record<string, unknown> & {
  aud?: string | string[];
  email?: string;
  email_verified?: boolean | string;
  exp?: number;
  iss?: string;
  name?: string;
  nbf?: number;
  nonce?: string;
  sub?: string;
};

type JsonWebKeyWithId = Record<string, string | undefined> & {
  alg?: string;
  kid?: string;
  kty?: string;
  use?: string;
};
const jwksCache = new Map<string, { expiresAt: number; keys: JsonWebKeyWithId[] }>();

async function jwks(url: string) {
  const cached = jwksCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('JWKS_UNAVAILABLE');
  const parsed = await response.json() as { keys?: JsonWebKeyWithId[] };
  if (!Array.isArray(parsed.keys)) throw new Error('INVALID_JWKS');
  jwksCache.set(url, { expiresAt: Date.now() + 60 * 60 * 1_000, keys: parsed.keys });
  return parsed.keys;
}

async function verifyIdToken(
  token: string,
  input: { audience: string; issuer: string | string[]; jwksUrl: string; nonce: string },
): Promise<JwtClaims> {
  if (token.length > 16_384) throw new Error('INVALID_ID_TOKEN');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('INVALID_ID_TOKEN');
  let header: { alg?: string; kid?: string };
  let claims: JwtClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('INVALID_ID_TOKEN');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('INVALID_ID_TOKEN');
  const key = (await jwks(input.jwksUrl)).find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) {
    throw new Error('INVALID_ID_TOKEN');
  }
  const now = Math.floor(Date.now() / 1_000);
  const issuers = Array.isArray(input.issuer) ? input.issuer : [input.issuer];
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !claims.sub
    || !claims.exp
    || claims.exp <= now - 30
    || (claims.nbf !== undefined && claims.nbf > now + 30)
    || !claims.iss
    || !issuers.includes(claims.iss)
    || !audiences.includes(input.audience)
    || claims.nonce !== input.nonce
  ) {
    throw new Error('INVALID_ID_TOKEN');
  }
  return claims;
}

async function postToken(url: string, parameters: URLSearchParams) {
  const response = await fetch(url, {
    body: parameters,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({})) as { error?: string; id_token?: string };
  if (!response.ok || !body.id_token) throw new Error(body.error ? `OAUTH_${body.error}` : 'OAUTH_TOKEN_FAILED');
  return body.id_token;
}

async function appleClientSecret() {
  const apple = readAccountServerConfig().apple;
  if (!apple) throw new Error('PROVIDER_DISABLED');
  const now = Math.floor(Date.now() / 1_000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: apple.keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    aud: 'https://appleid.apple.com',
    exp: now + 5 * 60,
    iat: now,
    iss: apple.teamId,
    sub: apple.clientId,
  }));
  const signingInput = `${header}.${payload}`;
  const privateKey = createPrivateKey(await readFile(apple.privateKeyFile, 'utf8'));
  const signature = sign('sha256', Buffer.from(signingInput), { dsaEncoding: 'ieee-p1363', key: privateKey });
  return `${signingInput}.${base64url(signature)}`;
}

export async function finishOAuth(
  provider: 'apple' | 'google',
  request: Request,
  parameters: URLSearchParams,
): Promise<{ account: PublicAccount; token: string }> {
  const code = parameters.get('code');
  const state = parameters.get('state');
  if (!code || !state || code.length > 4_096 || state.length > 256) throw new Error('INVALID_OAUTH_CALLBACK');
  const attempt = await accountStore().consumeOAuthAttempt(provider, state);
  if (!attempt) throw new Error('INVALID_OAUTH_STATE');
  const config = readAccountServerConfig();
  let profile: OAuthProfile;

  if (provider === 'google') {
    if (!config.google || !attempt.codeVerifier) throw new Error('PROVIDER_DISABLED');
    const idToken = await postToken('https://oauth2.googleapis.com/token', new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      code,
      code_verifier: attempt.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(request, provider),
    }));
    const claims = await verifyIdToken(idToken, {
      audience: config.google.clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      nonce: attempt.nonce,
    });
    if (!claims.email || ![true, 'true'].includes(claims.email_verified ?? false)) throw new Error('OAUTH_EMAIL_UNVERIFIED');
    profile = {
      email: claims.email,
      name: claims.name || claims.email.split('@')[0],
      provider,
      subject: claims.sub!,
    };
  } else {
    if (!config.apple) throw new Error('PROVIDER_DISABLED');
    const idToken = await postToken('https://appleid.apple.com/auth/token', new URLSearchParams({
      client_id: config.apple.clientId,
      client_secret: await appleClientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(request, provider),
    }));
    const claims = await verifyIdToken(idToken, {
      audience: config.apple.clientId,
      issuer: 'https://appleid.apple.com',
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      nonce: attempt.nonce,
    });
    let submittedName = '';
    try {
      const user = JSON.parse(parameters.get('user') ?? '{}') as { name?: { firstName?: string; lastName?: string } };
      submittedName = [user.name?.firstName, user.name?.lastName].filter(Boolean).join(' ');
    } catch {
      // Apple sends the user object only on the first authorization.
    }
    if (!claims.email) throw new Error('OAUTH_EMAIL_UNAVAILABLE');
    profile = {
      email: claims.email,
      name: submittedName || claims.name || claims.email.split('@')[0],
      provider,
      subject: claims.sub!,
    };
  }

  const account = await accountStore().upsertOAuthUser(profile);
  return { account, token: await accountStore().createSession(account.id) };
}

export const oauthResultRedirect = (request: Request, error?: string) => {
  const url = new URL('/', originFor(request));
  if (error) url.searchParams.set('authError', error);
  return url;
};
