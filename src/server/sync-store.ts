import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  applySyncPreferencePatch,
  hasSyncPreferencePatch,
  normalizeSyncPreferences,
  normalizeSyncPreferencePatch,
  type SyncPreferencePatch,
  type SyncPreferences,
} from '../sync/preferences.ts';
import type { SyncDeviceMetadata, SyncDeviceSummary } from '../sync/devices.ts';

const DEVICE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
const DEVICE_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1_000;
export const PAIRING_CODE_LIFETIME_MS = 10 * 60 * 1_000;
const ORPHAN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

type SyncProfile = {
  createdAt: number;
  id: string;
  preferences: SyncPreferences;
  revision: number;
  updatedAt: number;
};

type SyncDevice = {
  browser?: string;
  createdAt: number;
  expiresAt: number;
  id: string;
  lastSeenAt: number;
  name?: string;
  operatingSystem?: string;
  profileId: string;
  tokenHash: string;
  type: SyncDeviceMetadata['type'];
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
  version: 3;
};

export type SyncSession = {
  deviceId: string;
  devices: SyncDeviceSummary[];
  preferences: SyncPreferences;
  profileId: string;
  revision: number;
};

const emptyDatabase = (): SyncDatabase => ({ devices: [], pairingCodes: [], profiles: [], version: 3 });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function normalizeDeviceName(value: unknown): string | undefined {
  if (typeof value !== 'string') throw new Error('DEVICE_NAME_INVALID');
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > 40) throw new Error('DEVICE_NAME_INVALID');
  return name || undefined;
}

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
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as {
        devices?: Partial<SyncDevice>[];
        pairingCodes?: Partial<PairingCode>[];
        profiles?: Partial<SyncProfile>[];
        version?: number;
      };
      if (
        ![1, 2, 3].includes(parsed.version ?? 0)
        || !Array.isArray(parsed.devices)
        || !Array.isArray(parsed.pairingCodes)
        || !Array.isArray(parsed.profiles)
      ) {
        throw new Error('Unsupported Vector synchronization database');
      }
      return {
        devices: parsed.devices.map((device) => ({
          browser: typeof device.browser === 'string' ? device.browser : undefined,
          createdAt: typeof device.createdAt === 'number' ? device.createdAt : Date.now(),
          expiresAt: typeof device.expiresAt === 'number' ? device.expiresAt : 0,
          id: typeof device.id === 'string' ? device.id : `legacy-${String(device.tokenHash).slice(0, 16)}`,
          lastSeenAt: typeof device.lastSeenAt === 'number'
            ? device.lastSeenAt
            : typeof device.createdAt === 'number' ? device.createdAt : Date.now(),
          name: typeof device.name === 'string' ? device.name.slice(0, 40).trim() || undefined : undefined,
          operatingSystem: typeof device.operatingSystem === 'string' ? device.operatingSystem : undefined,
          profileId: String(device.profileId ?? ''),
          tokenHash: String(device.tokenHash ?? ''),
          type: ['desktop', 'mobile', 'tablet'].includes(String(device.type))
            ? device.type as SyncDeviceMetadata['type']
            : 'unknown',
        })),
        pairingCodes: parsed.pairingCodes.map((code) => ({
          codeHash: String(code.codeHash ?? ''),
          expiresAt: typeof code.expiresAt === 'number' ? code.expiresAt : 0,
          profileId: String(code.profileId ?? ''),
        })),
        profiles: parsed.profiles.map((profile) => ({
          createdAt: typeof profile.createdAt === 'number' ? profile.createdAt : Date.now(),
          id: String(profile.id ?? ''),
          preferences: normalizeSyncPreferences(profile.preferences),
          revision: typeof profile.revision === 'number' && profile.revision > 0 ? Math.floor(profile.revision) : 1,
          updatedAt: typeof profile.updatedAt === 'number' ? profile.updatedAt : Date.now(),
        })),
        version: 3,
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

  private addDevice(database: SyncDatabase, profileId: string, metadata: SyncDeviceMetadata) {
    const currentDevices = database.devices.filter((device) => device.profileId === profileId);
    if (currentDevices.length >= 20) throw new Error('DEVICE_LIMIT');
    const token = randomBytes(32).toString('base64url');
    const deviceId = randomUUID();
    const now = Date.now();
    database.devices.push({
      browser: metadata.browser,
      createdAt: now,
      expiresAt: now + DEVICE_LIFETIME_MS,
      id: deviceId,
      lastSeenAt: now,
      operatingSystem: metadata.operatingSystem,
      profileId,
      tokenHash: sha256(token),
      type: metadata.type,
    });
    return { deviceId, token };
  }

  private sessionFor(database: SyncDatabase, token: string | undefined): SyncSession | undefined {
    if (!token || token.length > 128) return undefined;
    const device = database.devices.find((candidate) => (
      candidate.tokenHash === sha256(token) && candidate.expiresAt > Date.now()
    ));
    const profile = device && database.profiles.find((candidate) => candidate.id === device.profileId);
    return profile && device ? {
      deviceId: device.id,
      devices: database.devices
        .filter((candidate) => candidate.profileId === profile.id)
        .sort((left, right) => Number(right.id === device.id) - Number(left.id === device.id) || right.lastSeenAt - left.lastSeenAt)
        .map((candidate) => ({
          browser: candidate.browser,
          createdAt: candidate.createdAt,
          current: candidate.id === device.id,
          id: candidate.id,
          lastSeenAt: candidate.lastSeenAt,
          name: candidate.name,
          operatingSystem: candidate.operatingSystem,
          type: candidate.type,
        })),
      preferences: normalizeSyncPreferences(profile.preferences),
      profileId: profile.id,
      revision: profile.revision,
    } : undefined;
  }

  async createProfile(value: unknown, metadata: SyncDeviceMetadata = { type: 'unknown' }) {
    return this.mutate((database) => {
      const now = Date.now();
      const profile: SyncProfile = {
        createdAt: now,
        id: randomUUID(),
        preferences: normalizeSyncPreferences(value),
        revision: 1,
        updatedAt: now,
      };
      database.profiles.push(profile);
      const device = this.addDevice(database, profile.id, metadata);
      return {
        deviceId: device.deviceId,
        devices: this.sessionFor(database, device.token)?.devices ?? [],
        preferences: profile.preferences,
        profileId: profile.id,
        revision: profile.revision,
        token: device.token,
      };
    });
  }

  async session(token: string | undefined): Promise<SyncSession | undefined> {
    await this.writeQueue;
    const database = await this.read();
    cleanup(database);
    return this.sessionFor(database, token);
  }

  async touchSession(
    token: string | undefined,
    metadata: SyncDeviceMetadata = { type: 'unknown' },
  ): Promise<SyncSession | undefined> {
    if (!token || token.length > 128) return undefined;
    await this.writeQueue;
    const currentDatabase = await this.read();
    cleanup(currentDatabase);
    const currentDevice = currentDatabase.devices.find((candidate) => candidate.tokenHash === sha256(token));
    if (!currentDevice || currentDevice.expiresAt <= Date.now()) return undefined;
    const metadataChanged = (
      (metadata.browser !== undefined && metadata.browser !== currentDevice.browser)
      || (metadata.operatingSystem !== undefined && metadata.operatingSystem !== currentDevice.operatingSystem)
      || (metadata.type !== 'unknown' && metadata.type !== currentDevice.type)
    );
    if (!metadataChanged && currentDevice.lastSeenAt > Date.now() - DEVICE_ACTIVITY_WRITE_INTERVAL_MS) {
      return this.sessionFor(currentDatabase, token);
    }
    return this.mutate((database) => {
      const device = database.devices.find((candidate) => candidate.tokenHash === sha256(token));
      if (!device || device.expiresAt <= Date.now()) return undefined;
      if (metadata.browser !== undefined) device.browser = metadata.browser;
      if (metadata.operatingSystem !== undefined) device.operatingSystem = metadata.operatingSystem;
      if (metadata.type !== 'unknown') device.type = metadata.type;
      device.lastSeenAt = Date.now();
      return this.sessionFor(database, token);
    });
  }

  async savePreferencePatch(profileId: string, value: SyncPreferencePatch | unknown) {
    const patch = normalizeSyncPreferencePatch(value);
    return this.mutate((database) => {
      const profile = database.profiles.find((candidate) => candidate.id === profileId);
      if (!profile) throw new Error('SYNC_NOT_CONNECTED');
      if (!hasSyncPreferencePatch(patch)) {
        return { changed: false, preferences: profile.preferences, revision: profile.revision };
      }
      profile.preferences = applySyncPreferencePatch(profile.preferences, patch);
      profile.revision += 1;
      profile.updatedAt = Date.now();
      return {
        changed: true,
        preferences: profile.preferences,
        revision: profile.revision,
      };
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

  async pair(codeValue: string, metadata: SyncDeviceMetadata = { type: 'unknown' }) {
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
      const device = this.addDevice(database, profile.id, metadata);
      return {
        deviceId: device.deviceId,
        devices: this.sessionFor(database, device.token)?.devices ?? [],
        preferences: normalizeSyncPreferences(profile.preferences),
        profileId: profile.id,
        revision: profile.revision,
        token: device.token,
      };
    });
  }

  async disconnect(token: string | undefined) {
    if (!token) return undefined;
    return this.mutate((database) => {
      const tokenHash = sha256(token);
      const device = database.devices.find((candidate) => candidate.tokenHash === tokenHash);
      database.devices = database.devices.filter((device) => device.tokenHash !== tokenHash);
      return device ? {
        profileId: device.profileId,
      } : undefined;
    });
  }

  async disconnectDevice(profileId: string, token: string | undefined, deviceId: string) {
    if (!token) throw new Error('SYNC_NOT_CONNECTED');
    return this.mutate((database) => {
      const tokenHash = sha256(token);
      const currentDevice = database.devices.find((device) => (
        device.profileId === profileId && device.tokenHash === tokenHash
      ));
      if (!currentDevice) throw new Error('SYNC_NOT_CONNECTED');
      if (currentDevice.id === deviceId) throw new Error('CURRENT_DEVICE');
      const target = database.devices.find((device) => device.profileId === profileId && device.id === deviceId);
      if (!target) throw new Error('DEVICE_NOT_FOUND');
      database.devices = database.devices.filter((device) => device !== target);
      const session = this.sessionFor(database, token);
      if (!session) throw new Error('SYNC_NOT_CONNECTED');
      return session;
    });
  }

  async renameDevice(profileId: string, token: string | undefined, deviceId: string, value: unknown) {
    if (!token) throw new Error('SYNC_NOT_CONNECTED');
    const name = normalizeDeviceName(value);
    return this.mutate((database) => {
      const tokenHash = sha256(token);
      const currentDevice = database.devices.find((device) => (
        device.profileId === profileId && device.tokenHash === tokenHash
      ));
      if (!currentDevice) throw new Error('SYNC_NOT_CONNECTED');
      const target = database.devices.find((device) => device.profileId === profileId && device.id === deviceId);
      if (!target) throw new Error('DEVICE_NOT_FOUND');
      target.name = name;
      const session = this.sessionFor(database, token);
      if (!session) throw new Error('SYNC_NOT_CONNECTED');
      return session;
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
