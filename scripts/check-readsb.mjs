import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { readVectorServerConfig } from '../src/server/vector-config.ts';
import { loadReadsbResource } from '../src/server/readsb-source.ts';
import { readBoundedFile } from '../src/server/bounded-resource.ts';
import { decodeAircraftDatabase, maximumDatabaseDownloadBytes } from '../src/server/aircraft-database.ts';

try {
  if (process.argv.slice(2).some((arg) => arg !== '--database-only')) throw new Error('Unknown check option');
  const config = readVectorServerConfig();
  if (config.source !== 'local') {
    console.log(`[Vector] Keeping existing ${config.source} data source. No readsb settings changed.`);
  } else {
    const signal = AbortSignal.timeout(30_000);
    const records = await decodeAircraftDatabase(await readBoundedFile(dirname(config.databaseFile), basename(config.databaseFile), maximumDatabaseDownloadBytes, signal), signal);
    console.log(`[Vector] Independent aircraft database is readable (${records.size} records).`);
    if (process.argv.includes('--database-only')) process.exit(0);
    const receiver = JSON.parse((await loadReadsbResource(config, 'live', 'receiver.json', signal)).toString());
    const snapshot = JSON.parse((await loadReadsbResource(config, 'live', 'aircraft.json', signal)).toString());
    if (!Number.isFinite(snapshot.now) || !Array.isArray(snapshot.aircraft)) throw new Error('Invalid aircraft.json');
    console.log(`[Vector] Local readsb is readable (${snapshot.aircraft.length} aircraft).`);
    if (Date.now() / 1000 - snapshot.now > 60) console.warn('[Vector] Warning: aircraft.json is more than one minute old. Check readsb.service.');
    for (const [label, path] of [['Traces', join(config.liveDirectory, 'traces')], ['History', config.historyDirectory]]) {
      try { await access(path, constants.R_OK | constants.X_OK); } catch { console.warn(`[Vector] Warning: ${label} directory is missing or unreadable. See docs/STANDALONE.md.`); }
    }
    if (!receiver.haveReplay) console.warn('[Vector] Warning: readsb replay is disabled. Enable globe history and heatmap output; see docs/STANDALONE.md.');
    if (!receiver.outlineJson) console.warn('[Vector] Warning: readsb does not advertise range outline support.');
  }
} catch (error) {
  console.error(`[Vector] Standalone check failed: ${error.message}. Check configured paths and read-only access for the vector user. See docs/STANDALONE.md.`);
  process.exitCode = 1;
}
