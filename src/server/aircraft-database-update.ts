import { randomUUID, createHash } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { databaseDownloadUrl, decodeAircraftDatabase, maximumDatabaseDownloadBytes } from './aircraft-database.ts';
import { readBoundedResponse } from './bounded-resource.ts';

export async function updateAircraftDatabase(file: string, options: { fetch?: typeof fetch; minimumRecords?: number } = {}) {
  if (!isAbsolute(file)) throw new Error('The database destination must be absolute');
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o750 });
  // Unique staging files + atomic rename are safe for concurrent manual/timer runs.
  // No persistent lock can get stuck after a power failure.
  const temporary = join(directory, `.${basename(file)}-${randomUUID()}.tmp`);
  try {
    const signal = AbortSignal.timeout(120_000);
    const response = await (options.fetch ?? fetch)(databaseDownloadUrl, { redirect: 'error', signal });
    const body = await readBoundedResponse(response, maximumDatabaseDownloadBytes, signal);
    const records = await decodeAircraftDatabase(body, signal);
    if (records.size < (options.minimumRecords ?? 10_000)) throw new Error('Downloaded aircraft database is unexpectedly small');
    const output = await open(temporary, 'wx', 0o640);
    try { await output.writeFile(body); await output.sync(); } finally { await output.close(); }
    // Atomic publication: readers see the old or the complete new database, never half a file.
    await rename(temporary, file);
    return { records: records.size, sha256: createHash('sha256').update(body).digest('hex'), source: databaseDownloadUrl };
  } finally {
    await rm(temporary, { force: true });
  }
}
