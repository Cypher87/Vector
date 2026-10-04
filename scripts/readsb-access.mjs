import { lstat, readFile, readdir, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDirectory, readerAcl } from './lib/readsb-migration.mjs';

const execute = promisify(execFile);
// ACL tools operate on an opened inode, never a receiver-controlled pathname that
// could be replaced with a symlink between inspection and the privileged write.
async function pinned(path, operation) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() && !info.isDirectory()) return;
    const descriptor = `/proc/${process.pid}/fd/${handle.fd}`;
    if (await realpath(descriptor) !== path) throw new Error('Receiver path changed during permission setup');
    await operation(descriptor, info);
  } catch (error) {
    if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
  } finally { await handle?.close(); }
}

const normalizeAcl = (text) => text.split('\n').map((line) => line.split('#')[0].trim()).filter(Boolean).sort().join('\n');

export async function restoreAccess(entry, run) {
  await pinned(entry.path, async (descriptor, info) => {
    if (entry.ino !== info.ino || entry.dev !== info.dev) return; // readsb atomically replaced it
    const current = await run('getfacl', ['-cpn', '--', descriptor]);
    if (normalizeAcl(current) === normalizeAcl(entry.after)) await run('setfacl', ['--set-file=-', '--', descriptor], entry.before);
    else if (normalizeAcl(current) !== normalizeAcl(entry.before)) throw new Error('Later permission changes must be preserved');
  });
}

/** @param {(entry: {path: string, before: string, after: string, ino: number, dev: number}) => Promise<void>} [remember] */
export async function grantReadAccess(spec, run, remember = async () => {}) {
  if (!Number.isInteger(spec.uid) || spec.uid <= 0 || !Array.isArray(spec.roots) || spec.roots.length > 3) throw new Error('Invalid reader configuration');
  let visited = 0;
  const grant = async (path, directory, traverseOnly = false) => pinned(path, async (descriptor, info) => {
    const before = await run('getfacl', ['-cpn', '--', descriptor]);
    const after = readerAcl(before, spec.uid, directory, traverseOnly);
    if (normalizeAcl(before) !== normalizeAcl(after)) {
      await remember({ path, before, after, ino: info.ino, dev: info.dev });
      await run('setfacl', ['--set-file=-', '--', descriptor], after);
    }
  });
  for (const configured of new Set(spec.roots)) {
    const root = dataDirectory(await realpath(dataDirectory(configured)));
    // Grant traversal, not listing or data access, on a restrictive parent.
    const parents = root.split('/').slice(1, -1);
    let parent = '';
    for (const part of parents) {
      parent += `/${part}`;
      const info = await lstat(parent);
      if (!(info.mode & 0o001)) await grant(parent, true, true);
    }
    const walk = async (path, isRoot = false) => {
      if (++visited > 200_000) throw new Error('Receiver tree is too large for automatic permission setup');
      const info = await lstat(path).catch((error) => { if (error.code === 'ENOENT' && !isRoot) return null; throw error; });
      if (!info) return; // readsb rotates files while it is running
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) return;
      if (isRoot || (info.isDirectory() ? (info.mode & 0o005) !== 0o005 : !(info.mode & 0o004))) {
        await grant(path, info.isDirectory());
      }
      if (info.isDirectory()) {
        const names = await readdir(path).catch((error) => { if (error.code === 'ENOENT' && !isRoot) return []; throw error; });
        for (const name of names) await walk(join(path, name));
      }
    };
    await walk(root, true);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.getuid?.() !== 0) throw new Error('Receiver permission setup requires root');
    const file = '/etc/vector/readsb-access.json';
    const info = await lstat(file);
    if (!info.isFile() || info.uid !== 0 || info.mode & 0o022) throw new Error('Unsafe reader configuration ownership');
    await grantReadAccess(JSON.parse(await readFile(file, 'utf8')), async (command, args, input) => {
      if (input !== undefined) {
        await new Promise((resolve, reject) => {
          const child = execFile(command, args, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
          child.stdin.end(input);
        });
        return '';
      }
      return (await execute(command, args, { timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout;
    });
  } catch (error) { console.error(`[Vector] Receiver access setup failed: ${error.message}`); process.exitCode = 1; }
}
