import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeSyncPreferences, type SyncPreferences } from '../sync/preferences.ts';

const DEVICE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
export const PAIRING_CODE_LIFETIME_MS = 10 * 60 * 1_000;
const ORPHAN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

type SyncProfile = {
  createdAt: number;
  id: string;
  preferences: SyncPreferences;
  updatedAt: number;
};

type SyncDevice = {
  createdAt: number;
  expiresAt: number;
  profileId: string;
  tokenHash: string;
};

type PairingCode = {
  codeHash: string;
  expiresAt: number;
  profileId: string;
};

type SyncDatabase = {
  devices: SyncDevice[];
  pairingCodes: PairingCode[];
  profiles: SyncProfile[];
  version: 1;
};

export type SyncSession = {
  preferences: SyncPreferences;
  profileId: string;
};

const emptyDatabase = (): SyncDatabase => ({ devices: [], pairingCodes: [], profiles: [], version: 1 });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const normalizePairingCode = (value: string) => value.trim().toUpperCase().replace(/[\s-]/g, '');
export const formatPairingCode = (value: string) => `${value.slice(0, 3)}-${value.slice(3)}`;

const newPairingCode = () => Array.from(
  { length: 6 },
  () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)],
).join('');

const cleanup = (database: SyncDatabase, now = Date.now()) => {
  database.devices = database.devices.filter((device) => device.expiresAt > now);
  database.pairingCodes = database.pairingCodes.filter((code) => code.expiresAt > now);
  const connectedProfiles = new Set(database.devices.map((device) => device.profileId));
  database.profiles = database.profiles.filter((profile) => (
    connectedProfiles.has(profile.id) || profile.updatedAt > now - ORPHAN_LIFETIME_MS
  ));
  const existingProfiles = new Set(database.profiles.map((profile) => profile.id));
  database.pairingCodes = database.pairingCodes.filter((code) => existingProfiles.has(code.profileId));
};

export class SyncStore {
  private readonly filePath: string;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async read(): Promise<SyncDatabase> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<SyncDatabase>;
      if (
        parsed.version !== 1
        || !Array.isArray(parsed.devices)
        || !Array.isArray(parsed.pairingCodes)
        || !Array.isArray(parsed.profiles)
      ) {
        throw new Error('Unsupported Vector synchronization database');
      }
      return {
        devices: parsed.devices,
        pairingCodes: parsed.pairingCodes,
        profiles: parsed.profiles,
        version: 1,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDatabase();
      throw error;
    }
  }

  private async write(database: SyncDatabase) {
    await mkdir(dirname(this.filePath), { mode: 0o700, recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  private mutate<T>(operation: (database: SyncDatabase) => Promise<T> | T): Promise<T> {
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

  private addDevice(database: SyncDatabase, profileId: string) {
    const currentDevices = database.devices.filter((device) => device.profileId === profileId);
    if (currentDevices.length >= 20) throw new Error('DEVICE_LIMIT');
    const token = randomBytes(32).toString('base64url');
    database.devices.push({
      createdAt: Date.now(),
      expiresAt: Date.now() + DEVICE_LIFETIME_MS,
      profileId,
      tokenHash: sha256(token),
    });
    return token;
  }

  async createProfile(value: unknown) {
    return this.mutate((database) => {
      const now = Date.now();
      const profile: SyncProfile = {
        createdAt: now,
        id: randomUUID(),
        preferences: normalizeSyncPreferences(value),
        updatedAt: now,
      };
      database.profiles.push(profile);
      return {
        preferences: profile.preferences,
        profileId: profile.id,
        token: this.addDevice(database, profile.id),
      };
    });
  }

  async session(token: string | undefined): Promise<SyncSession | undefined> {
    if (!token || token.length > 128) return undefined;
    const database = await this.read();
    const device = database.devices.find((candidate) => candidate.tokenHash === sha256(token) && candidate.expiresAt > Date.now());
    const profile = device && database.profiles.find((candidate) => candidate.id === device.profileId);
    return profile ? { preferences: normalizeSyncPreferences(profile.preferences), profileId: profile.id } : undefined;
  }

  async savePreferences(profileId: string, value: unknown) {
    const preferences = normalizeSyncPreferences(value);
    return this.mutate((database) => {
      const profile = database.profiles.find((candidate) => candidate.id === profileId);
      if (!profile) throw new Error('SYNC_NOT_CONNECTED');
      profile.preferences = preferences;
      profile.updatedAt = Date.now();
      return preferences;
    });
  }

  async createPairingCode(profileId: string) {
    return this.mutate((database) => {
      if (!database.profiles.some((profile) => profile.id === profileId)) throw new Error('SYNC_NOT_CONNECTED');
      database.pairingCodes = database.pairingCodes.filter((code) => code.profileId !== profileId);
      let code = newPairingCode();
      while (database.pairingCodes.some((candidate) => candidate.codeHash === sha256(code))) code = newPairingCode();
      const expiresAt = Date.now() + PAIRING_CODE_LIFETIME_MS;
      database.pairingCodes.push({ codeHash: sha256(code), expiresAt, profileId });
      return { code: formatPairingCode(code), expiresAt };
    });
  }

  async pair(codeValue: string) {
    const code = normalizePairingCode(codeValue);
    if (!PAIRING_CODE_PATTERN.test(code)) throw new Error('PAIRING_CODE_INVALID');
    return this.mutate((database) => {
      const index = database.pairingCodes.findIndex((candidate) => (
        candidate.codeHash === sha256(code) && candidate.expiresAt > Date.now()
      ));
      if (index < 0) throw new Error('PAIRING_CODE_INVALID');
      const [pairingCode] = database.pairingCodes.splice(index, 1);
      const profile = database.profiles.find((candidate) => candidate.id === pairingCode.profileId);
      if (!profile) throw new Error('PAIRING_CODE_INVALID');
      profile.updatedAt = Date.now();
      return {
        preferences: normalizeSyncPreferences(profile.preferences),
        profileId: profile.id,
        token: this.addDevice(database, profile.id),
      };
    });
  }

  async disconnect(token: string | undefined) {
    if (!token) return;
    await this.mutate((database) => {
      const tokenHash = sha256(token);
      database.devices = database.devices.filter((device) => device.tokenHash !== tokenHash);
    });
  }

  async deleteProfile(profileId: string) {
    await this.mutate((database) => {
      database.profiles = database.profiles.filter((profile) => profile.id !== profileId);
      database.devices = database.devices.filter((device) => device.profileId !== profileId);
      database.pairingCodes = database.pairingCodes.filter((code) => code.profileId !== profileId);
    });
  }
}
