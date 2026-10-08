import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { readVectorServerConfig, type VectorServerConfig } from './vector-config.ts';
import { loadReadsbResource } from './readsb-source.ts';
import { LogbookStore } from './logbook-store.ts';

export function logbookSettings(environment: Record<string, string | undefined> = process.env) {
  const file = environment.VECTOR_LOGBOOK_STORE?.trim() || (environment.VECTOR_SYNC_STORE
    ? resolve(dirname(environment.VECTOR_SYNC_STORE), 'logbook.sqlite')
    : process.platform === 'win32' ? resolve('.vector/logbook.sqlite') : '/var/lib/vector/logbook.sqlite');
  const retention = Number(environment.VECTOR_LOGBOOK_DAYS || 90);
  if (!isAbsolute(file) || file.includes('\0') || !Number.isInteger(retention) || retention < 1 || retention > 365) throw new Error('Invalid logbook configuration');
  return { file, retention, enabled: environment.VECTOR_LOGBOOK_ENABLED !== 'false' };
}

type Recorder = { store: Promise<LogbookStore>; stop: () => Promise<void> };
const globalRecorder = globalThis as typeof globalThis & { __vectorLogbook?: Recorder };

/** Also used by the production launcher, before the web server accepts any requests. */
export function startLogbook(config: VectorServerConfig = readVectorServerConfig()): Recorder | undefined {
  if (config.source !== 'local' || !logbookSettings().enabled) return;
  if (globalRecorder.__vectorLogbook) return globalRecorder.__vectorLogbook;
  const { file, retention } = logbookSettings();
  let database: Promise<LogbookStore> | undefined;
  const openStore = () => database ??= mkdir(dirname(file), { recursive: true }).then(() => new LogbookStore(file, retention))
    .catch((error) => { database = undefined; throw error; });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWarning = 0;
  let pending: Promise<void>;
  const tick = async () => {
    try {
      const database = await openStore();
      const body = await loadReadsbResource(config, 'live', 'aircraft.json', AbortSignal.timeout(8000));
      if (!stopped) database.record(JSON.parse(body.toString()));
    } catch {
      if (!stopped && Date.now() - lastWarning > 300_000) {
        console.warn('[Vector logbook] Recording unavailable; retrying. Existing observations are preserved.');
        lastWarning = Date.now();
      }
    } finally {
      if (!stopped) { timer = setTimeout(() => { pending = tick(); }, 10_000); timer.unref(); }
    }
  };
  pending = tick();
  const recorder = { get store() { return openStore(); }, stop: async () => {
    stopped = true; clearTimeout(timer); await pending;
    await database?.then((store) => store.close()).catch(() => {});
    if (globalRecorder.__vectorLogbook === recorder) delete globalRecorder.__vectorLogbook;
  } };
  globalRecorder.__vectorLogbook = recorder;
  return recorder;
}
