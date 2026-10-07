import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rename, unlink, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ReleaseSwitch } from '../scripts/lib/release-switch.mjs';
import { MigrationFiles } from '../scripts/lib/migration-files.mjs';

async function fixture(mode: 'legacy' | 'links' | 'fresh' = 'legacy') {
  const root = await mkdtemp(join(tmpdir(), 'vector-release-'));
  const release = join(root, 'releases/new');
  const old = join(root, 'releases/old');
  const runtime = join(root, 'runtime/new');
  const oldRuntime = join(root, 'runtime/old');
  for (const directory of [release, old, runtime, oldRuntime]) await mkdir(directory, { recursive: true });
  await mkdir(join(release, 'dist/standalone'), { recursive: true });
  await mkdir(join(runtime, 'bin'));
  await writeFile(join(release, 'dist/standalone/server.js'), 'new build');
  await writeFile(join(release, 'package.json'), '{"version":"0.9.0"}');
  await writeFile(join(runtime, 'bin/node'), 'node');
  if (mode === 'legacy') {
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app/old-build'), 'original');
  } else if (mode === 'links') await symlink(old, join(root, 'app'));
  if (mode !== 'fresh') await symlink(oldRuntime, join(root, 'runtime/node'));
  const tx = new MigrationFiles(join(root, 'backup'));
  const switcher = new ReleaseSwitch(tx, root);
  await switcher.prepare(release, runtime);
  const reload = async () => new ReleaseSwitch(new MigrationFiles(tx.directory, JSON.parse(await readFile(join(tx.directory, 'journal.json'), 'utf8'))), root);
  return { root, release, old, runtime, oldRuntime, tx, switcher, reload, cleanup: () => rm(root, { recursive: true, force: true }) };
}

for (const mode of ['legacy', 'links', 'fresh'] as const) {
  test(`Linux release activation and recovery preserve the ${mode} installation`, { skip: process.platform !== 'linux' }, async () => {
    const f = await fixture(mode);
    try {
      await f.switcher.activate();
      assert.equal(await realpath(join(f.root, 'app')), f.release);
      assert.equal(await realpath(join(f.root, 'runtime/node')), f.runtime);
      await (await f.reload()).restore();
      await (await f.reload()).restore(); // Interrupted recovery is safe to repeat.
      if (mode === 'fresh') {
        await assert.rejects(lstat(join(f.root, 'app')), { code: 'ENOENT' });
        await assert.rejects(lstat(join(f.root, 'runtime/node')), { code: 'ENOENT' });
      } else {
        assert.equal(await realpath(join(f.root, 'runtime/node')), f.oldRuntime);
        if (mode === 'links') assert.equal(await realpath(join(f.root, 'app')), f.old);
        else assert.equal(await readFile(join(f.root, 'app/old-build'), 'utf8'), 'original');
      }
      assert.equal(await readFile(join(f.release, 'dist/standalone/server.js'), 'utf8'), 'new build');
    } finally { await f.cleanup(); }
  });
}

test('Linux interrupted legacy move recovers from the on-disk journal before links are created', { skip: process.platform !== 'linux' }, async () => {
  const f = await fixture();
  try {
    const journal = JSON.parse(await readFile(join(f.tx.directory, 'journal.json'), 'utf8'));
    await rename(join(f.root, 'app'), journal.release.appBefore.target);
    await (await f.reload()).restore();
    assert.equal(await readFile(join(f.root, 'app/old-build'), 'utf8'), 'original');
  } finally { await f.cleanup(); }
});

test('Linux partial activation restores both app and runtime and preserves administrator replacements', { skip: process.platform !== 'linux' }, async () => {
  const f = await fixture('links');
  try {
    await f.switcher.link(join(f.root, 'app'), f.release); // Crash before switching Node.
    await (await f.reload()).restore();
    assert.equal(await realpath(join(f.root, 'app')), f.old);
    await f.switcher.activate();
    await unlink(join(f.root, 'app'));
    await symlink(f.runtime, join(f.root, 'app')); // Unrelated administrator edit.
    await assert.rejects(() => f.switcher.restore(), /preserve a changed installation/);
    assert.equal(await realpath(join(f.root, 'app')), f.runtime);
    assert.equal(await realpath(join(f.root, 'runtime/node')), f.runtime);
  } finally { await f.cleanup(); }
});

test('Linux release validation refuses external paths and missing builds before touching active links', { skip: process.platform !== 'linux' }, async () => {
  const f = await fixture('links');
  try {
    await assert.rejects(() => f.switcher.prepare('/etc', f.runtime), /Invalid release/);
    await unlink(join(f.release, 'dist/standalone/server.js'));
    await assert.rejects(() => f.switcher.prepare(f.release, f.runtime), /Incomplete release/);
    assert.equal(await realpath(join(f.root, 'app')), f.old);
  } finally { await f.cleanup(); }
});
