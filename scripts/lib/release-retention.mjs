import { lstat, readFile, readlink, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readerFilesystem, readerMounts } from '../readsb-access.mjs';

const journalId = /^\d{17}-[a-f0-9-]{36}$/;
const releaseName = /^(?:build-[A-Za-z0-9]{8}|legacy-[a-f0-9-]{36})$/;
const remoteTypes = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'fuse.sshfs', 'autofs']);

/** Called under the installer lock, only after activation and health verification.
 * Delete only journaled application builds. Never walk history, runtime or state.
 * Unknown directories, mounts, symlinks and unresolved recoveries are preserved.
 * @param {{root?: string, backups?: string, ownerUid?: number, mountInfo?: string}} options
 */
export async function pruneReleases({ root = '/opt/vector', backups = '/var/lib/vector-installer',
  ownerUid = 0, mountInfo } = {}) {
  const mounts = readerMounts(mountInfo ?? await readFile('/proc/self/mountinfo', 'utf8'));
  const releases = join(root, 'releases');
  const remote = (path) => remoteTypes.has(readerFilesystem(path, mounts)?.type);
  for (const path of [root, releases, backups]) {
    if (remote(path)) throw new Error('Automatic build cleanup requires local storage');
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o022) || await realpath(path) !== resolve(path)) {
      throw new Error('Unsafe build/backup directory; cleanup skipped');
    }
  }
  const child = (path) => typeof path === 'string' && dirname(path) === releases
    && resolve(path) === path && releaseName.test(basename(path));
  const json = async (path) => {
    if (remote(path)) throw new Error('Recovery journal is on remote storage');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o022) || info.size > 8 * 1024 * 1024) throw new Error('Unsafe recovery journal; cleanup skipped');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const app = join(root, 'app');
  if (!(await lstat(app)).isSymbolicLink()) return [];
  const active = resolve(dirname(app), await readlink(app));
  if (!child(active) || remote(active) || await realpath(active) !== active) throw new Error('Active build is not a managed local release');
  const pointer = await json(join(backups, 'latest.json'));
  if (!journalId.test(pointer.id)) throw new Error('Invalid recovery pointer');
  const journals = [];
  for (const name of (await readdir(backups)).filter((name) => journalId.test(name)).sort().reverse()) {
    const directory = join(backups, name);
    if (remote(directory)) throw new Error('Recovery journal is on remote storage');
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o022)) throw new Error('Unsafe recovery journal directory');
    const state = await json(join(directory, 'journal.json'));
    if (!['complete', 'rolled-back'].includes(state.status)) return [];
    journals.push({ id: name, state: { status: state.status, release: state.release } });
  }
  const latest = journals.find((item) => item.id === pointer.id)?.state;
  if (latest?.status !== 'complete' || latest.release?.directory !== active) return [];
  const known = new Set(), keep = new Set([active]), prior = [];
  const remember = (path) => { if (child(path)) { known.add(path); return path; } return null; };
  for (const { state } of journals) {
    if (!state.release) continue; // Old configuration-only backup.
    const candidate = remember(state.release.directory);
    const before = remember(state.release.appBefore?.target);
    if (state.status === 'complete' && candidate && candidate !== active) prior.push(candidate);
    if (before && before !== active) prior.push(before);
  }
  for (const path of [...new Set(prior)].slice(0, 2)) keep.add(path);
  // The latest rollback must remain possible even with irregular old journals.
  const previous = remember(latest.release.appBefore?.target);
  if (previous) keep.add(previous);
  const removed = [];
  for (const path of known) {
    if (keep.has(path) || remote(path) || mounts.some((mount) => mount.path === path || mount.path.startsWith(`${path}/`))) continue;
    const info = await lstat(path).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info?.isDirectory() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o022) || await realpath(path) !== path) continue;
    // Recheck the exact targets immediately before deletion. Parent directories
    // are root-owned, and recursive rm does not follow node_modules symlinks.
    if (await realpath(app) !== active || (await json(join(backups, 'latest.json'))).id !== pointer.id) throw new Error('Installation changed during cleanup');
    if (!child(path) || keep.has(path)) throw new Error('Refusing an unvalidated cleanup target');
    await rm(path, { recursive: true });
    removed.push(path);
  }
  return removed;
}
