import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pruneReleases } from '../scripts/lib/release-retention.mjs';

const localMounts = '1 0 0:1 / / rw - ext4 /dev/test rw\n';
const linux = { skip: process.platform !== 'linux' };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vector-retention-'));
  const root = join(directory, 'vector'), backups = join(directory, 'backups');
  const releases = join(root, 'releases');
  const history = join(directory, 'history');
  await mkdir(releases, { recursive: true }); await mkdir(backups); await mkdir(history);
  await writeFile(join(history, 'recording'), 'keep history');
  const build = (n: number) => join(releases, `build-${String(n).padStart(8, '0')}`);
  const id = (n: number) => `${String(n).padStart(17, '0')}-12345678-1234-1234-1234-123456789abc`;
  const state = (n: number, status = 'complete') => ({ status, release: { directory: build(n),
    appBefore: n === 1 ? { kind: 'missing' } : { kind: 'link', target: build(n - 1) } } });
  const journal = async (n: number, value: unknown) => {
    await mkdir(join(backups, id(n)), { recursive: true });
    await writeFile(join(backups, id(n), 'journal.json'), JSON.stringify(value));
  };
  for (let n = 1; n <= 5; n++) {
    await mkdir(build(n)); await writeFile(join(build(n), 'app'), String(n));
    await journal(n, state(n));
  }
  await symlink(build(5), join(root, 'app'));
  await writeFile(join(backups, 'latest.json'), JSON.stringify({ id: id(5) }));
  const prune = (mountInfo = localMounts) => pruneReleases({ root, backups, mountInfo, ownerUid: process.getuid!() });
  return { directory, root, backups, releases, history, build, id, state, journal, prune,
    cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('retention keeps the active build and two predecessors; history, unknown builds and symlink targets survive', linux, async () => {
  const f = await fixture();
  try {
    await symlink(f.history, join(f.build(1), 'node_modules'));
    await mkdir(f.build(99)); // Unjournaled build is not ours to delete automatically.
    assert.deepEqual(new Set(await f.prune()), new Set([f.build(1), f.build(2)]));
    for (const n of [3, 4, 5, 99]) assert.ok((await lstat(f.build(n))).isDirectory());
    assert.equal(await readFile(join(f.history, 'recording'), 'utf8'), 'keep history');
    assert.deepEqual(await f.prune(), [], 'repeated cleanup tolerates already removed builds');
    assert.ok((await lstat(join(f.backups, f.id(5), 'journal.json'))).isFile());
  } finally { await f.cleanup(); }
});

for (const status of ['pending', 'recovering']) {
  test(`retention preserves every build during ${status} recovery`, linux, async () => {
    const f = await fixture();
    try {
      await f.journal(2, f.state(2, status));
      assert.deepEqual(await f.prune(), []);
      assert.ok((await lstat(f.build(1))).isDirectory());
    } finally { await f.cleanup(); }
  });
}

test('retention skips release symlinks and mounted directories including nested NFS history', linux, async () => {
  const f = await fixture();
  try {
    await rm(f.build(1), { recursive: true });
    await symlink(f.history, f.build(1));
    const mount = `2 1 0:2 / ${f.build(2)}/recordings rw - nfs4 pi:/history rw\n`;
    assert.deepEqual(await f.prune(localMounts + mount), []);
    assert.ok((await lstat(f.build(1))).isSymbolicLink());
    assert.equal(await readFile(join(f.history, 'recording'), 'utf8'), 'keep history');
  } finally { await f.cleanup(); }
});

test('retention refuses remote storage and unsafe journal paths without deleting builds', linux, async () => {
  const f = await fixture();
  try {
    await assert.rejects(() => f.prune(localMounts + `2 1 0:2 / ${f.root} rw - nfs4 pi:/apps rw\n`), /local storage/);
    await writeFile(join(f.backups, 'latest.json'), '{"id":"../../outside"}');
    await assert.rejects(() => f.prune(), /Invalid recovery pointer/);
    assert.ok((await lstat(f.build(1))).isDirectory());
  } finally { await f.cleanup(); }
});

test('retention does not clean after rollback or a manually changed active build', linux, async () => {
  const f = await fixture();
  try {
    await f.journal(5, f.state(5, 'rolled-back'));
    assert.deepEqual(await f.prune(), []);
    await f.journal(5, f.state(5));
    await unlink(join(f.root, 'app')); await symlink(f.build(4), join(f.root, 'app'));
    assert.deepEqual(await f.prune(), []);
  } finally { await f.cleanup(); }
});

test('retention fails closed on corrupt or symlinked recovery journals', linux, async () => {
  const f = await fixture();
  try {
    const path = join(f.backups, f.id(1), 'journal.json');
    await writeFile(path, 'broken json');
    await assert.rejects(() => f.prune());
    await unlink(path); await symlink(join(f.history, 'recording'), path);
    await assert.rejects(() => f.prune(), /Unsafe recovery journal/);
    assert.ok((await lstat(f.build(1))).isDirectory());
    assert.equal(await readFile(join(f.history, 'recording'), 'utf8'), 'keep history');
  } finally { await f.cleanup(); }
});
