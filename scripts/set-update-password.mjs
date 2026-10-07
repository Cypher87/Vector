import { emitKeypressEvents } from 'node:readline';
import { hashUpdatePassword } from './lib/update-auth.mjs';
import { snapshot, atomicWrite } from './lib/migration-files.mjs';
import { patchEnvironment } from './lib/readsb-migration.mjs';

async function password(prompt) {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume();
  emitKeypressEvents(process.stdin);
  let value = '';
  try {
    return await new Promise((resolve, reject) => {
      const keypress = (text, key) => {
        if (key?.ctrl && key.name === 'c') { process.stdin.off('keypress', keypress); reject(new Error('Cancelled')); }
        else if (key?.name === 'return') { process.stdin.off('keypress', keypress); resolve(value); }
        else if (key?.name === 'backspace') value = [...value].slice(0, -1).join('');
        else if (text && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text) && value.length + text.length <= 128) value += text;
      };
      process.stdin.on('keypress', keypress);
    });
  } finally { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); }
}

try {
  if (process.getuid?.() !== 0 || !process.stdin.isTTY) throw new Error('Run as root in an interactive terminal');
  const path = '/etc/vector/vector.env';
  const before = await snapshot(path);
  if (!before || before.uid !== 0 || (before.mode & 0o022)) throw new Error('A root-owned Vector configuration is required');
  const first = await password('New update administrator password (12–128 characters): ');
  if (first !== await password('Repeat password: ')) throw new Error('Passwords do not match; configuration unchanged');
  const hash = await hashUpdatePassword(first);
  const current = await snapshot(path);
  if (current?.content !== before.content) throw new Error('Configuration changed in the meantime; try again');
  await atomicWrite(path, patchEnvironment(before.content, { VECTOR_UPDATE_PASSWORD_HASH: hash }), before.mode, before);
  console.log('Password saved as a salted hash. Set VECTOR_UPDATES_ENABLED=true in /etc/vector/vector.env and restart vector to enable browser updates.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
