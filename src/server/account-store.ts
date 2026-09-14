import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeUserPreferences, type UserPreferences } from '../account/preferences.ts';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const OAUTH_ATTEMPT_LIFETIME_MS = 10 * 60 * 1_000;
const PASSWORD_KEY_LENGTH = 64;

export type AccountProvider = 'apple' | 'google' | 'local';

type StoredIdentity = {
  provider: 'apple' | 'google';
  subject: string;
};

type StoredPassword = {
  digest: string;
  salt: string;
};

type StoredUser = {
  createdAt: number;
  email: string;
  id: string;
  identities: StoredIdentity[];
  name: string;
  password?: StoredPassword;
  preferences: UserPreferences;
};

type StoredSession = {
  createdAt: number;
  expiresAt: number;
  tokenHash: string;
  userId: string;
};

type StoredOAuthAttempt = {
  codeVerifier?: string;
  expiresAt: number;
  nonce: string;
  provider: 'apple' | 'google';
  stateHash: string;
};

type AccountDatabase = {
  oauthAttempts: StoredOAuthAttempt[];
  sessions: StoredSession[];
  users: StoredUser[];
  version: 1;
};

export type PublicAccount = {
  email: string;
  id: string;
  name: string;
  providers: AccountProvider[];
};

export type OAuthProfile = {
  email: string;
  name: string;
  provider: 'apple' | 'google';
  subject: string;
};

export type OAuthAttempt = Omit<StoredOAuthAttempt, 'stateHash'>;

const emptyDatabase = (): AccountDatabase => ({ oauthAttempts: [], sessions: [], users: [], version: 1 });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 80);

const publicAccount = (user: StoredUser): PublicAccount => ({
  email: user.email,
  id: user.id,
  name: user.name,
  providers: [
    ...(user.password ? ['local' as const] : []),
    ...user.identities.map((identity) => identity.provider),
  ],
});

async function passwordDigest(password: string, salt: string) {
  const result = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, PASSWORD_KEY_LENGTH, {
      N: 16_384,
      maxmem: 32 * 1024 * 1024,
      p: 1,
      r: 8,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return result.toString('base64url');
}

const cleanup = (database: AccountDatabase, now = Date.now()) => {
  database.sessions = database.sessions.filter((session) => session.expiresAt > now);
  database.oauthAttempts = database.oauthAttempts.filter((attempt) => attempt.expiresAt > now);
};

export class AccountStore {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async read(): Promise<AccountDatabase> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AccountDatabase>;
      if (parsed.version !== 1 || !Array.isArray(parsed.users) || !Array.isArray(parsed.sessions)) {
        throw new Error('Unsupported Vector account database');
      }
      return {
        oauthAttempts: Array.isArray(parsed.oauthAttempts) ? parsed.oauthAttempts : [],
        sessions: parsed.sessions,
        users: parsed.users,
        version: 1,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDatabase();
      throw error;
    }
  }

  private async write(database: AccountDatabase) {
    await mkdir(dirname(this.filePath), { mode: 0o700, recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  private mutate<T>(operation: (database: AccountDatabase) => Promise<T> | T): Promise<T> {
    const queued = this.writeQueue.then(async () => {
      const database = await this.read();
      cleanup(database);
      const result = await operation(database);
      await this.write(database);
      return result;
    });
    this.writeQueue = queued.catch(() => undefined);
    return queued;
  }

  async localUserCount() {
    const database = await this.read();
    return database.users.filter((user) => Boolean(user.password)).length;
  }

  async createLocalUser(input: { email: string; name: string; onlyFirst?: boolean; password: string }) {
    const email = normalizeEmail(input.email);
    const name = normalizeName(input.name);
    if (!validEmail(email)) throw new Error('INVALID_EMAIL');
    if (!name) throw new Error('INVALID_NAME');
    if (input.password.length < 12 || input.password.length > 128) throw new Error('INVALID_PASSWORD');

    const salt = randomBytes(18).toString('base64url');
    const digest = await passwordDigest(input.password, salt);
    return this.mutate((database) => {
      if (input.onlyFirst && database.users.some((user) => Boolean(user.password))) throw new Error('REGISTRATION_DISABLED');
      if (database.users.some((user) => user.password && user.email === email)) throw new Error('EMAIL_EXISTS');
      const user: StoredUser = {
        createdAt: Date.now(),
        email,
        id: randomUUID(),
        identities: [],
        name,
        password: { digest, salt },
        preferences: {},
      };
      database.users.push(user);
      return publicAccount(user);
    });
  }

  async authenticateLocal(emailValue: string, password: string) {
    const email = normalizeEmail(emailValue);
    const database = await this.read();
    const user = database.users.find((candidate) => candidate.password && candidate.email === email);
    const fallbackSalt = 'vector-invalid-password-check';
    const candidateDigest = await passwordDigest(password, user?.password?.salt ?? fallbackSalt);
    if (!user?.password) return undefined;
    const expected = Buffer.from(user.password.digest, 'base64url');
    const candidate = Buffer.from(candidateDigest, 'base64url');
    return expected.length === candidate.length && timingSafeEqual(expected, candidate) ? publicAccount(user) : undefined;
  }

  async upsertOAuthUser(profile: OAuthProfile) {
    const email = normalizeEmail(profile.email);
    if (!validEmail(email) || !profile.subject || profile.subject.length > 255) throw new Error('INVALID_OAUTH_PROFILE');
    const name = normalizeName(profile.name) || email.split('@')[0];
    return this.mutate((database) => {
      let user = database.users.find((candidate) => candidate.identities.some(
        (identity) => identity.provider === profile.provider && identity.subject === profile.subject,
      ));
      if (!user) {
        user = {
          createdAt: Date.now(),
          email,
          id: randomUUID(),
          identities: [{ provider: profile.provider, subject: profile.subject }],
          name,
          preferences: {},
        };
        database.users.push(user);
      } else {
        user.email = email;
        user.name = name;
      }
      return publicAccount(user);
    });
  }

  async createSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    await this.mutate((database) => {
      if (!database.users.some((user) => user.id === userId)) throw new Error('UNKNOWN_USER');
      const userSessions = database.sessions.filter((session) => session.userId === userId);
      if (userSessions.length >= 20) {
        const oldest = [...userSessions].sort((left, right) => left.createdAt - right.createdAt)[0];
        database.sessions = database.sessions.filter((session) => session !== oldest);
      }
      database.sessions.push({
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_LIFETIME_MS,
        tokenHash: sha256(token),
        userId,
      });
    });
    return token;
  }

  async session(token: string | undefined) {
    if (!token || token.length > 128) return undefined;
    const database = await this.read();
    const session = database.sessions.find((candidate) => candidate.tokenHash === sha256(token) && candidate.expiresAt > Date.now());
    const user = session && database.users.find((candidate) => candidate.id === session.userId);
    return user ? { account: publicAccount(user), preferences: normalizeUserPreferences(user.preferences) } : undefined;
  }

  async deleteSession(token: string | undefined) {
    if (!token) return;
    await this.mutate((database) => {
      const hash = sha256(token);
      database.sessions = database.sessions.filter((session) => session.tokenHash !== hash);
    });
  }

  async savePreferences(userId: string, value: unknown) {
    const preferences = normalizeUserPreferences(value);
    return this.mutate((database) => {
      const user = database.users.find((candidate) => candidate.id === userId);
      if (!user) throw new Error('UNKNOWN_USER');
      user.preferences = preferences;
      return preferences;
    });
  }

  async createOAuthAttempt(
    provider: 'apple' | 'google',
    state: string,
    nonce: string,
    codeVerifier?: string,
  ) {
    await this.mutate((database) => {
      database.oauthAttempts.push({
        codeVerifier,
        expiresAt: Date.now() + OAUTH_ATTEMPT_LIFETIME_MS,
        nonce,
        provider,
        stateHash: sha256(state),
      });
    });
  }

  async consumeOAuthAttempt(provider: 'apple' | 'google', state: string): Promise<OAuthAttempt | undefined> {
    return this.mutate((database) => {
      const stateHash = sha256(state);
      const index = database.oauthAttempts.findIndex((attempt) => (
        attempt.provider === provider && attempt.stateHash === stateHash && attempt.expiresAt > Date.now()
      ));
      if (index < 0) return undefined;
      const [attempt] = database.oauthAttempts.splice(index, 1);
      return {
        codeVerifier: attempt.codeVerifier,
        expiresAt: attempt.expiresAt,
        nonce: attempt.nonce,
        provider: attempt.provider,
      };
    });
  }
}
