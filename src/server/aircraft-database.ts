import { basename, dirname } from 'node:path';
import { lstat } from 'node:fs/promises';
import type { AircraftMetadata } from '../domain/aircraft.ts';
import type { AircraftDatabaseStatus } from '../domain/aircraft-database-status.ts';
import { decompressResource, readBoundedFile, ResourceError } from './bounded-resource.ts';

export const databaseDownloadUrl = 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/refs/heads/csv/aircraft.csv.gz';
export const maximumDatabaseDownloadBytes = 32 * 1024 * 1024;
export const maximumDatabaseBytes = 128 * 1024 * 1024;

type AircraftDatabaseIndex = { readonly size: number; get(id: string): AircraftMetadata | undefined };

/** Keep one CSV string + numeric line offsets, not 600k+ expanded metadata objects. */
export function parseAircraftDatabase(text: string): AircraftDatabaseIndex {
  const offsets = new Map<number, number>();
  let start = 0;
  while (start < text.length) {
    const lineStart = start;
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    if (line.length > 2048 || /[\x00-\x1f\x7f]/.test(line)) throw new ResourceError('Invalid aircraft database record');
    const fields = line.split(';');
    if (fields.length !== 8 || fields[7] !== '' || !/^[a-f0-9]{6}$/i.test(fields[0])
      || !/^[01]{0,4}$/.test(fields[3]) || fields.some((field) => field.length > 512)) {
      throw new ResourceError('Invalid aircraft database format');
    }
    const id = parseInt(fields[0], 16);
    if (offsets.has(id) || offsets.size >= 1_500_000) throw new ResourceError('Duplicate or excessive aircraft database records');
    offsets.set(id, lineStart);
  }
  if (!offsets.size) throw new ResourceError('Aircraft database is empty');
  return {
    size: offsets.size,
    get(id) {
      if (!/^[a-f0-9]{6}$/i.test(id)) return undefined;
      const offset = offsets.get(parseInt(id, 16));
      if (offset === undefined) return undefined;
      const end = text.indexOf('\n', offset);
      // readsb CSV: hex;r;t;flags;description;year;owner; (validated above).
      const [, registration, aircraftType, flags, description, year, ownerOperator] =
        text.slice(offset, end === -1 ? text.length : end).replace(/\r$/, '').split(';');
      return {
        registration: registration || undefined, aircraftType: aircraftType || undefined,
        description: description || undefined, year: year || undefined, ownerOperator: ownerOperator || undefined,
        dbFlags: [...flags].reduce((value, flag, bit) => value | (Number(flag) << bit), 0),
      };
    },
  };
}

export async function decodeAircraftDatabase(body: Buffer, signal?: AbortSignal) {
  const decoded = await decompressResource(body, maximumDatabaseBytes, signal);
  return parseAircraftDatabase(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
}

/** Bounded cache; reload after an atomic update, keeping the last good data on failure. */
export class AircraftDatabase {
  private records: AircraftDatabaseIndex = { size: 0, get: () => undefined };
  private signature = '';
  private checkAfter = 0;
  private pending?: Promise<void>;
  private state: AircraftDatabaseStatus['state'] = 'missing';
  private updatedAt: number | null = null;
  private readonly file: string;
  private readonly interval: number;
  constructor(file: string, interval = 60_000) { this.file = file; this.interval = interval; }
  private async refresh() {
    this.checkAfter = Date.now() + this.interval;
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs <= 0 || info.mtimeMs > Date.now() + 300_000) throw new Error('Invalid aircraft database file');
      const signatureFor = (info: Awaited<ReturnType<typeof lstat>>) => `${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      const signature = signatureFor(info);
      if (signature === this.signature) { this.state = 'ready'; return; }
      const body = await readBoundedFile(dirname(this.file), basename(this.file), maximumDatabaseDownloadBytes);
      const records = await decodeAircraftDatabase(body);
      // Do not attach the old file's time/count to a concurrently published replacement.
      if (signatureFor(await lstat(this.file)) !== signature) throw new Error('Aircraft database changed during validation');
      this.records = records;
      this.signature = signature;
      // The updater publishes a freshly written file only after full validation.
      // Failed downloads never change this timestamp; existing installations work too.
      this.updatedAt = info.mtimeMs;
      this.state = 'ready';
    } catch (error) {
      this.state = (error as NodeJS.ErrnoException).code === 'ENOENT' && !this.records.size ? 'missing' : 'unavailable';
      // Metadata is optional. Live data and trace metadata must survive a missing/bad DB.
    }
  }
  private async ensureFresh(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (Date.now() >= this.checkAfter && !this.pending) {
      this.pending = this.refresh().finally(() => { this.pending = undefined; });
    }
    await this.pending;
    signal?.throwIfAborted();
  }
  async status(signal?: AbortSignal): Promise<AircraftDatabaseStatus> {
    await this.ensureFresh(signal);
    return { state: this.state, location: 'local', updatedAt: this.updatedAt, records: this.records.size || null };
  }
  async lookup(ids: readonly string[], signal?: AbortSignal): Promise<Record<string, AircraftMetadata>> {
    await this.ensureFresh(signal);
    return Object.fromEntries(ids.flatMap((id) => {
      const value = this.records.get(id);
      return value ? [[id, value]] : [];
    }));
  }
}

let database: { file: string; store: AircraftDatabase } | undefined;
function localDatabase(file: string) {
  if (database?.file !== file) database = { file, store: new AircraftDatabase(file) };
  return database.store;
}
export const lookupLocalAircraftMetadata = (file: string, ids: readonly string[], signal?: AbortSignal) => localDatabase(file).lookup(ids, signal);
export const localAircraftDatabaseStatus = (file: string, signal?: AbortSignal) => localDatabase(file).status(signal);
