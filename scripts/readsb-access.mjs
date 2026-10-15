import { lstat, readFile, readdir, realpath, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDirectory, readerAcl, readerCanAccess } from './lib/readsb-migration.mjs';

const execute = promisify(execFile);
const remoteFilesystems = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'fuse.sshfs', 'autofs']);

/** Inspect the kernel mount table without making a request to the file server. */
export function readerMounts(text) {
  const mounts = text.trim().split('\n').flatMap((line) => {
    const [mount, filesystem] = line.split(' - ');
    const fields = mount.split(' ');
    if (fields.length < 6 || !filesystem) return [];
    return [{ id: fields[0], parent: fields[1], path: fields[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))),
      type: filesystem.split(' ')[0] }];
  });
  const byId = new Map(mounts.map((mount) => [mount.id, mount]));
  const hidden = new Set(mounts.filter((mount) => mount.id !== mount.parent && byId.get(mount.parent)?.path === mount.path).map((mount) => mount.parent));
  const visible = (mount, seen = new Set()) => {
    if (hidden.has(mount.id) || seen.has(mount.id)) return false;
    seen.add(mount.id);
    let parent = byId.get(mount.parent);
    // A stacked mount is visible through its hidden predecessor; children of
    // that predecessor at other paths remain hidden underneath the new mount.
    while (parent && parent.path === mount.path && parent.id !== mount.id) {
      if (seen.has(parent.id)) return false;
      seen.add(parent.id);
      if (parent.id === parent.parent) return true;
      parent = byId.get(parent.parent);
    }
    return !parent || parent.id === mount.id || visible(parent, seen);
  };
  return mounts.filter((mount) => visible(mount)).sort((a, b) => b.path.length - a.path.length);
}

export function readerFilesystem(path, mounts) {
  return mounts.find((mount) => path === mount.path || path.startsWith(mount.path === '/' ? '/' : `${mount.path}/`));
}

/** Startup maintenance concerns live output only, never the historical archive. */
export function liveAccessSpec(spec) {
  const live = spec.liveRoot ?? spec.roots?.[0]; // Older installers stored the live root first.
  if (!Array.isArray(spec.roots) || !spec.roots.includes(live)) throw new Error('Invalid live reader configuration');
  return { ...spec, roots: [dataDirectory(live)] };
}

async function walkLocalAccess(spec, visit, options = {}) {
  if (!Number.isInteger(spec.uid) || spec.uid <= 0 || !Array.isArray(spec.roots) || spec.roots.length > 3) throw new Error('Invalid reader configuration');
  const mounts = readerMounts(options.mountInfo ?? (process.platform === 'linux' ? await readFile('/proc/self/mountinfo', 'utf8') : ''));
  const skipped = new Set();
  const isRemote = (path) => {
    const mount = readerFilesystem(path, mounts);
    if (!mount || !remoteFilesystems.has(mount.type)) return false;
    if (!skipped.has(mount.path)) {
      skipped.add(mount.path);
      options.onSkip?.(mount);
    }
    return true;
  };
  let visited = 0;
  for (const configured of new Set(spec.roots)) {
    // Check before realpath/lstat as even metadata access can block on a hard NFS mount.
    if (isRemote(dataDirectory(configured))) continue;
    const root = dataDirectory(await realpath(configured));
    if (isRemote(root)) continue;
    const parents = root.split('/').slice(1, -1);
    let parent = '';
    for (const part of parents) {
      parent += `/${part}`;
      if (!isRemote(parent)) await visit(parent, await lstat(parent), false, true);
    }
    const walk = async (path, isRoot = false) => {
      if (isRemote(path)) return; // Also exclude a network mount nested below a local root.
      if (++visited > 200_000) throw new Error('Receiver tree is too large for automatic permission setup');
      const info = await lstat(path).catch((error) => { if (error.code === 'ENOENT' && !isRoot) return null; throw error; });
      if (!info || info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) return;
      await visit(path, info, isRoot, false);
      if (info.isDirectory()) {
        const names = await readdir(path).catch((error) => { if (error.code === 'ENOENT' && !isRoot) return []; throw error; });
        for (const name of names) await walk(join(path, name));
      }
    };
    await walk(root, true);
  }
}
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

// setfacl can change ordinary mode bits even when returning EOPNOTSUPP.
// Probe an empty, disposable file on the same filesystem before touching data.
async function checkAclSupport(path, info, run) {
  await pinned(info.isDirectory() ? path : dirname(path), async (directory, parent) => {
    if (parent.dev !== info.dev) throw new Error(`Cannot safely test ACL support for ${path}`);
    const probe = join(directory, `.vector-acl-check-${randomUUID()}`);
    let handle;
    try {
      handle = await open(probe, 'wx', 0o600);
      await run('setfacl', ['-m', 'u:0:r--', '--', `/proc/${process.pid}/fd/${handle.fd}`]);
    } catch (error) {
      throw new Error(`Cannot grant Vector read access to ${path}: ACL setup is unavailable (${error.message}). Existing permissions were not changed; use a filesystem with POSIX ACL support or provide read access to the vector user.`);
    } finally {
      await handle?.close();
      if (handle) await unlink(probe).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  });
}

export async function restoreAccess(entry, run) {
  await pinned(entry.path, async (descriptor, info) => {
    if (entry.ino !== info.ino || entry.dev !== info.dev) return; // readsb atomically replaced it
    const current = await run('getfacl', ['-cpn', '--', descriptor]);
    if (normalizeAcl(current) === normalizeAcl(entry.after)) await run('setfacl', ['--set-file=-', '--', descriptor], entry.before);
    else if (normalizeAcl(current) !== normalizeAcl(entry.before)) throw new Error('Later permission changes must be preserved');
  });
}

/** @param {(entry: {path: string, before: string, after: string, ino: number, dev: number}) => Promise<void>} [remember] */
export async function grantReadAccess(spec, run, remember = async () => {}, options = {}) {
  if (!Number.isInteger(spec.uid) || spec.uid <= 0 || !Array.isArray(spec.roots) || spec.roots.length > 3) throw new Error('Invalid reader configuration');
  const groupText = (await run('id', ['-G', String(spec.uid)])).trim();
  const groups = groupText ? groupText.split(/\s+/).map(Number) : [];
  if (groups.some((group) => !Number.isInteger(group) || group < 0)) throw new Error('Invalid reader groups');
  const supportedDevices = new Set();
  const grant = async (path, directory, traverseOnly = false) => pinned(path, async (descriptor, info) => {
    const before = await run('getfacl', ['-cpn', '--', descriptor]);
    // Public readsb output (usually 0755/0644) needs no ACL or default ACL.
    // This also supports tmpfs/mounts whose kernel does not implement POSIX ACLs.
    if (readerCanAccess(before, info, spec.uid, groups, directory, traverseOnly)) return;
    if (!supportedDevices.has(info.dev)) {
      await checkAclSupport(path, info, run);
      supportedDevices.add(info.dev);
    }
    const after = readerAcl(before, spec.uid, directory, traverseOnly);
    if (normalizeAcl(before) !== normalizeAcl(after)) {
      await remember({ path, before, after, ino: info.ino, dev: info.dev });
      await run('setfacl', ['--set-file=-', '--', descriptor], after);
    }
  });
  await walkLocalAccess(spec, async (path, info, isRoot, traverseOnly) => {
    if (traverseOnly ? !(info.mode & 0o001)
      : isRoot || (info.isDirectory() ? (info.mode & 0o005) !== 0o005 : !(info.mode & 0o004))) {
      await grant(path, info.isDirectory(), traverseOnly);
    }
  }, options);
}

/** Detach only our named ACLs, with the same mount and inode protections as setup. */
export async function removeReadAccess(spec, run, options = {}) {
  await walkLocalAccess(spec, (path) => pinned(path, async (descriptor) => {
    const before = await run('getfacl', ['-cpn', '--', descriptor]);
    const entries = normalizeAcl(before).split('\n');
    const names = [`user:${spec.uid}:`, `default:user:${spec.uid}:`];
    const remove = ['u', 'd:u'].filter((_, index) => entries.some((entry) => entry.startsWith(names[index])));
    if (remove.length) await run('setfacl', ['--no-mask', '-x', remove.map((prefix) => `${prefix}:${spec.uid}`).join(','), '--', descriptor]);
  }), options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.getuid?.() !== 0) throw new Error('Receiver permission setup requires root');
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--live-only')) throw new Error('Unknown reader access option');
    const file = '/etc/vector/readsb-access.json';
    const info = await lstat(file);
    if (!info.isFile() || info.uid !== 0 || info.mode & 0o022) throw new Error('Unsafe reader configuration ownership');
    const spec = JSON.parse(await readFile(file, 'utf8'));
    await grantReadAccess(args.includes('--live-only') ? liveAccessSpec(spec) : spec, async (command, args, input) => {
      if (input !== undefined) {
        await new Promise((resolve, reject) => {
          const child = execFile(command, args, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
          child.stdin.end(input);
        });
        return '';
      }
      return (await execute(command, args, { timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout;
    }, undefined, { onSkip: (mount) => console.log(`[Vector] ${mount.type} storage ${mount.path}: using existing server permissions.`) });
  } catch (error) { console.error(`[Vector] Receiver access setup failed: ${error.message}`); process.exitCode = 1; }
}
