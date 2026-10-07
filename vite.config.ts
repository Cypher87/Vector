import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(({ command }) => {
  let revision = process.env.VECTOR_BUILD_REVISION || '';
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { revision = ''; }
  }
  if (!/^[a-f0-9]{40}$/.test(revision)) revision = '';
  if (command === 'build') {
    const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    writeFileSync(new URL('./.vector-build.json', import.meta.url), JSON.stringify({ version, revision }));
  }
  return {
    define: { __VECTOR_BUILD_REVISION__: JSON.stringify(revision) },
    css: { postcss: { plugins: [tailwindcss()] } },
    optimizeDeps: { exclude: ['maplibre-gl'] },
    server: {
      // Vite 8's console forwarder can recursively report its own failed send
      // when the HMR socket disappears, flooding the browser with errors.
      forwardConsole: false,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [vinext()],
  };
});
