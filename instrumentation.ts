// Development also records after the server receives its first request, even after tabs close.
export async function register() {
  if (process.env.NODE_ENV !== 'development') return;
  const { startLogbook } = await import('./src/server/logbook-runtime.ts');
  try { startLogbook(); } catch { console.warn('[Vector logbook] Recording is unavailable.'); }
}
