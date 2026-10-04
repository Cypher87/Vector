import { lstat, readFile, mkdir, open, rename, unlink, chown, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const hash = (body) => createHash('sha256').update(body).digest('hex');
export async function snapshot(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Refusing to replace a non-regular configuration file');
    const content = await readFile(path, 'utf8');
    return { content, mode: info.mode & 0o777, uid: info.uid, gid: info.gid };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function atomicWrite(path, content, mode = 0o600, owner) {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  const temp = join(dirname(path), `.vector-${randomUUID()}.tmp`);
  const file = await open(temp, 'wx', mode);
  try {
    await file.writeFile(content);
    await file.sync();
    if (owner && process.platform !== 'win32') await file.chown(owner.uid, owner.gid);
    await file.close();
    await rename(temp, path);
  } finally { await file.close().catch(() => {}); await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Write-ahead journal. Never overwrite a later administrator edit during recovery. */
export class MigrationFiles {
  constructor(directory, state = { status: 'pending', files: [] }) { this.directory = directory; this.state = state; }
  async save() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await atomicWrite(join(this.directory, 'journal.json'), JSON.stringify(this.state, null, 2));
  }
  async write(path, content, mode = 0o644, owner) {
    const before = await snapshot(path);
    if (before?.content === content && before.mode === mode && (!owner || (owner.uid === before.uid && owner.gid === before.gid))) return;
    if (this.state.files.some((file) => file.path === path)) throw new Error('Configuration was scheduled twice');
    this.state.files.push({ path, before, after: hash(content) });
    await this.save();
    await atomicWrite(path, content, mode, owner);
  }
  async rollback() {
    const conflicts = [];
    for (const file of this.state.files) {
      const current = await snapshot(file.path);
      if (current && hash(current.content) !== file.after && current.content !== file.before?.content) conflicts.push(file.path);
    }
    if (conflicts.length) throw new Error(`Recovery stopped to preserve later edits: ${conflicts.join(', ')}`);
    for (const file of [...this.state.files].reverse()) {
      if (file.before) {
        await atomicWrite(file.path, file.before.content, file.before.mode, file.before);
        if (process.platform !== 'win32') await chown(file.path, file.before.uid, file.before.gid);
        await chmod(file.path, file.before.mode);
      } else await unlink(file.path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
    this.state.status = 'rolled-back';
    await this.save();
  }
}
