import { lstat, readlink, realpath, rename, symlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const info = (path) => lstat(path).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });

/** Release links share the configuration's write-ahead journal and recovery boundary. */
export class ReleaseSwitch {
  constructor(transaction, root = '/opt/vector') { this.transaction = transaction; this.root = root; }

  child(path, parent) {
    if (typeof path !== 'string' || dirname(path) !== join(this.root, parent) || resolve(path) !== path) {
      throw new Error('Invalid release/runtime path; refusing to change the active installation');
    }
    return path;
  }

  async before(path, parent, allowDirectory = false) {
    const current = await info(path);
    if (!current) return { kind: 'missing' };
    if (current.isSymbolicLink()) {
      const target = this.child(resolve(dirname(path), await readlink(path)), parent);
      if (!(await info(target))?.isDirectory() || await realpath(target) !== target) throw new Error('Release targets must be regular directories');
      return { kind: 'link', target };
    }
    if (allowDirectory && current.isDirectory()) {
      return { kind: 'directory', target: join(this.root, 'releases', `legacy-${randomUUID()}`) };
    }
    throw new Error(`Unsupported installation path: ${path}`);
  }

  async prepare(directory, runtime) {
    this.child(directory, 'releases');
    this.child(runtime, 'runtime');
    for (const path of [directory, runtime]) {
      const entry = await info(path);
      if (!entry?.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) throw new Error('Release/runtime must be a regular directory');
    }
    for (const path of [join(directory, 'dist/standalone/server.js'), join(directory, 'package.json'), join(runtime, 'bin/node')]) {
      if (!(await info(path))?.isFile()) throw new Error(`Incomplete release: ${path}`);
    }
    this.transaction.state.release = {
      directory, runtime,
      appBefore: await this.before(join(this.root, 'app'), 'releases', true),
      nodeBefore: await this.before(join(this.root, 'runtime/node'), 'runtime'),
    };
    await this.transaction.save();
  }

  entries() {
    const release = this.transaction.state.release;
    if (!release) return [];
    return [
      { path: join(this.root, 'app'), target: this.child(release.directory, 'releases'), before: release.appBefore, parent: 'releases' },
      { path: join(this.root, 'runtime/node'), target: this.child(release.runtime, 'runtime'), before: release.nodeBefore, parent: 'runtime' },
    ].map((entry) => {
      if (!['missing', 'link', 'directory'].includes(entry.before?.kind) || (entry.before.kind === 'directory' && entry.parent !== 'releases')) throw new Error('Invalid previous release');
      if (entry.before.kind !== 'missing') this.child(entry.before.target, entry.parent);
      return entry;
    });
  }

  async check(entry) {
    const current = await info(entry.path);
    if (!current) {
      if (entry.before.kind === 'link') throw new Error(`Active link was removed: ${entry.path}`);
      return;
    }
    if (current.isSymbolicLink()) {
      const target = resolve(dirname(entry.path), await readlink(entry.path));
      if (target === entry.target || (entry.before.kind === 'link' && target === entry.before.target)) return;
    } else if (entry.before.kind === 'directory' && current.isDirectory() && !await info(entry.before.target)) return;
    throw new Error(`Recovery stopped to preserve a changed installation: ${entry.path}`);
  }

  async link(path, target) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await symlink(target, temporary); await rename(temporary, path); }
    finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
  }

  async activate() {
    const entries = this.entries();
    for (const entry of entries) await this.check(entry);
    for (const entry of entries) {
      if (entry.before.kind === 'directory' && (await info(entry.path))?.isDirectory()) {
        await rename(entry.path, entry.before.target);
      }
      await this.link(entry.path, entry.target);
    }
  }

  async restore() {
    const entries = this.entries();
    // Check all links and backups before changing anything; never clobber manual edits.
    for (const entry of entries) {
      await this.check(entry);
      if (entry.before.kind === 'link' && !(await info(entry.before.target))?.isDirectory()) throw new Error('Previous release/runtime is missing');
      if (entry.before.kind === 'directory' && !(await info(entry.path))?.isDirectory() && !(await info(entry.before.target))?.isDirectory()) throw new Error('Previous installation backup is missing');
    }
    for (const entry of entries) {
      if (entry.before.kind === 'link') await this.link(entry.path, entry.before.target);
      else if (entry.before.kind === 'directory') {
        if (!(await info(entry.path))?.isDirectory()) {
          await unlink(entry.path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
          await rename(entry.before.target, entry.path);
        }
      } else await unlink(entry.path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
