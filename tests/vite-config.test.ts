import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('disables Vite console forwarding to prevent a reconnect error loop', async () => {
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.match(config, /forwardConsole:\s*false/);
});
