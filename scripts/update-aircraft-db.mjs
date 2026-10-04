import { readVectorServerConfig } from '../src/server/vector-config.ts';
import { updateAircraftDatabase } from '../src/server/aircraft-database-update.ts';

try {
  const config = readVectorServerConfig();
  if (config.source !== 'local' && !process.env.VECTOR_AIRCRAFT_DATABASE) {
    console.log('[Vector] Remote mode: no local aircraft database configured.');
  } else {
    const result = await updateAircraftDatabase(config.databaseFile);
    console.log(`[Vector] Aircraft database updated: ${result.records} records, SHA-256 ${result.sha256}`);
  }
} catch (error) {
  console.error(`[Vector] Database update failed; existing database preserved. ${error.message}`);
  process.exitCode = 1;
}
