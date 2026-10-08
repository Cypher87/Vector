// The recorder starts independently of browser traffic and stops with the web process.
import { startLogbook } from '../src/server/logbook-runtime.ts';

let recorder;
try { recorder = startLogbook(); }
catch { console.warn('[Vector logbook] Invalid configuration; recording is unavailable.'); }
await import('../dist/standalone/server.js');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  const deadline = setTimeout(() => process.exit(0), 10_000);
  deadline.unref();
  void Promise.resolve(recorder?.stop()).finally(() => process.exit(0));
});
