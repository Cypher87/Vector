import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat, chmod, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const installerUrl = new URL('../scripts/install-debian.sh', import.meta.url);

test('Node.js and system administration tools are on PATH before Corepack starts', async () => {
  const installer = await readFile(installerUrl, 'utf8');
  const systemPath =
    "readonly SYSTEM_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'";
  const initialPathExport = 'export PATH="$SYSTEM_PATH"';
  const runtimePathExport = 'export PATH="$node_directory/bin:$SYSTEM_PATH"';
  const corepackInvocation =
    '"$node_directory/bin/corepack" enable --install-directory "$node_directory/bin"';

  const systemPathIndex = installer.indexOf(systemPath);
  const initialPathIndex = installer.indexOf(initialPathExport);
  const runtimePathIndex = installer.indexOf(runtimePathExport);
  const runuserIndex = installer.indexOf('runuser -u "$VECTOR_USER"');
  const corepackIndex = installer.indexOf(corepackInvocation);

  assert.notEqual(systemPathIndex, -1, 'the installer must define a safe Debian system PATH');
  assert.notEqual(initialPathIndex, -1, 'the system PATH must be exported for root commands');
  assert.notEqual(runtimePathIndex, -1, 'the isolated Node.js bin directory must be exported');
  assert.notEqual(runuserIndex, -1, 'the installer must execute application commands as vector');
  assert.notEqual(corepackIndex, -1, 'the installer must enable Corepack');
  assert.ok(initialPathIndex < runuserIndex, 'runuser must be discoverable through /usr/sbin');
  assert.ok(
    runtimePathIndex < corepackIndex,
    'Node.js must be discoverable by Corepack\'s env shebang',
  );
});

test('application builds run from a separate release without changing the active checkout', async () => {
  const installer = await readFile(installerUrl, 'utf8');

  assert.match(installer, /local working_directory="\$1"\n\s+shift/);
  assert.match(installer, /--chdir="\$working_directory"/);
  assert.match(
    installer,
    /run_as_vector "\$release_directory" pnpm install --frozen-lockfile/,
  );
  assert.match(installer, /run_as_vector "\$release_directory" pnpm build/);
  assert.doesNotMatch(installer, /git -C "\$VECTOR_APP" (checkout|fetch)/);
  assert.doesNotMatch(installer, /ln -sfn.*VECTOR_RUNTIME\/node/);
  assert.ok(installer.indexOf('pnpm build') < installer.indexOf('--release "$release_directory"'));
});

test('installer uses the guided migration, serializes runs and protects privileged helper code', async () => {
  const installer = await readFile(installerUrl, 'utf8');
  assert.match(installer, /flock -n 9/);
  assert.match(installer, /install -d -o root -g root -m 0755 "\$VECTOR_ROOT"/);
  assert.match(installer, /install -d -o root -g root -m 0755 "\$VECTOR_RECOVERY"/);
  assert.match(installer, /--release "\$release_directory" "\$node_directory" --source "\$source_directory" "\$\{MIGRATION_ARGS\[@\]\}"/);
  assert.ok(installer.indexOf('--recover-pending') < installer.indexOf('apt-get update'));
  assert.ok(installer.indexOf('migrate-install.mjs --detach') < installer.indexOf('rm -rf -- "$VECTOR_ROOT"'));
  assert.match(installer, /--rollback\) ACTION='rollback'/);
  assert.match(installer, /exec "\$VECTOR_RECOVERY\/current\/recover-install.sh" --rollback/);
  assert.ok(installer.indexOf('chown -R root:root "$release_directory"') < installer.indexOf('recovery_directory='));
  assert.match(installer, /git clone --local --no-hardlinks --no-checkout "\$source_directory" "\$release_directory"/);
  assert.match(installer, /chmod 0700 "\$source_directory"/);
  assert.match(installer, /"\$source_directory\/scripts\/\$script" "\$recovery_directory\/\$script"/);
  assert.doesNotMatch(installer, /install .*"\$release_directory\/scripts\//);
  assert.match(installer, /run_as_vector "\$VECTOR_ROOT" git -c safe.directory="\$active_release" -C "\$VECTOR_APP" status --porcelain/);
});

test('a partial source clone produces an independent build checkout without shared writable objects', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-source-isolation-'));
  const origin = join(root, 'origin');
  const source = join(root, 'source');
  const build = join(root, 'build');
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    await mkdir(origin);
    git('init', '--quiet', '--initial-branch=main', origin);
    git('-C', origin, 'config', 'uploadpack.allowFilter', 'true');
    await writeFile(join(origin, 'helper.mjs'), 'trusted helper');
    git('-C', origin, 'add', 'helper.mjs');
    git('-C', origin, '-c', 'user.name=Vector test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
    const revision = git('-C', origin, 'rev-parse', 'HEAD');
    git('clone', '--filter=blob:none', '--no-checkout', pathToFileURL(origin).href, source);
    git('-C', source, 'checkout', '--detach', revision);
    git('clone', '--local', '--no-hardlinks', '--no-checkout', source, build);
    git('-C', build, 'checkout', '--detach', revision);
    assert.equal(await readFile(join(build, 'helper.mjs'), 'utf8'), 'trusted helper');
    await writeFile(join(build, 'helper.mjs'), 'changed during build');
    assert.equal(await readFile(join(source, 'helper.mjs'), 'utf8'), 'trusted helper');
    const objects = '.git/objects/pack';
    const packs = (await readdir(join(source, objects))).filter((name) => name.endsWith('.pack'));
    assert.ok(packs.length > 0);
    for (const pack of packs) {
      assert.notEqual((await stat(join(source, objects, pack))).ino, (await stat(join(build, objects, pack))).ino);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('freezing an updater-built release preserves service read access without weakening private files', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-release-permissions-'));
  const release = join(root, 'release');
  const isRoot = process.getuid?.() === 0;
  const uid = isRoot ? execFileSync('id', ['-u', 'nobody'], { encoding: 'utf8' }).trim() : '';
  const gid = isRoot ? execFileSync('id', ['-g', 'nobody'], { encoding: 'utf8' }).trim() : '';
  const probe = () => spawnSync(process.execPath, ['-e', `
    if (process.getuid() === 0) {
      process.setgroups([]); process.setgid(Number(process.argv[3])); process.setuid(Number(process.argv[2]));
    }
    require(process.argv[1]);
  `, join(release, 'scripts/check-readsb.mjs'), uid, gid], { encoding: 'utf8' });
  try {
    await chmod(root, 0o755);
    // A child keeps the process-wide umask out of concurrent tests. These are
    // actual newly created files, just as with the systemd updater's UMask=0027.
    execFileSync(process.execPath, ['-e', `
      const fs = require('node:fs'); const path = require('node:path');
      const root = process.argv[1]; const release = path.join(root, 'release');
      process.umask(0o027);
      for (const dir of ['scripts', 'dist/standalone', 'public', 'node_modules/.pnpm/probe'])
        fs.mkdirSync(path.join(release, dir), { recursive: true });
      for (const file of ['dist/standalone/server.js', 'public/asset.svg'])
        fs.writeFileSync(path.join(release, file), 'fixture');
      fs.writeFileSync(path.join(release, 'node_modules/.pnpm/probe/index.mjs'), 'export default 42;');
      fs.symlinkSync('.pnpm/probe', path.join(release, 'node_modules/probe'));
      fs.writeFileSync(path.join(root, 'vector.env'), 'private fixture', { mode: 0o640 });
      fs.mkdirSync(path.join(root, 'backup'), { mode: 0o700 });
      fs.writeFileSync(path.join(root, 'backup/config'), 'private fixture', { mode: 0o600 });
    `, root]);
    await writeFile(join(release, 'scripts/check-readsb.mjs'), `
      import assert from 'node:assert/strict';
      import { readFileSync, accessSync, constants } from 'node:fs';
      import value from '../node_modules/probe/index.mjs';
      assert.equal(value, 42);
      for (const file of ['../dist/standalone/server.js', '../public/asset.svg']) {
        const url = new URL(file, import.meta.url);
        assert.equal(readFileSync(url, 'utf8'), 'fixture');
        if (process.argv[2]) assert.throws(() => accessSync(url, constants.W_OK));
      }
      console.log('release readable');
    `, { mode: 0o640 });
    assert.equal((await stat(join(release, 'scripts'))).mode & 0o777, 0o750);
    if (isRoot) {
      const before = probe();
      assert.notEqual(before.status, 0);
      assert.match(before.stderr, /MODULE_NOT_FOUND/);
    }

    const installer = await readFile(installerUrl, 'utf8');
    const freeze = installer.match(/^chown -R root:root "\$release_directory"\n(?:#[^\n]*\n)*chmod[^\n]+$/m)?.[0];
    assert.ok(freeze, 'exercise the actual ownership/permission commands from the installer');
    // Ordinary CI can verify POSIX mode bits; running this test as root also
    // reproduces the real ownership transition and drops all supplementary groups.
    execFileSync('bash', ['-euc', `release_directory="$1"\n${isRoot ? freeze : freeze.split('\n').slice(1).join('\n')}`, 'permissions-test', release]);
    for (const directory of ['', 'scripts', 'dist/standalone', 'public', 'node_modules/.pnpm/probe']) {
      const info = await stat(join(release, directory));
      assert.equal(info.mode & 0o777, 0o755, directory);
      if (isRoot) assert.equal(info.uid, 0);
    }
    for (const file of ['scripts/check-readsb.mjs', 'dist/standalone/server.js', 'public/asset.svg', 'node_modules/probe/index.mjs']) {
      const info = await stat(join(release, file));
      assert.equal(info.mode & 0o777, 0o644, file);
      if (isRoot) assert.equal(info.uid, 0);
    }
    const after = probe();
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /release readable/);
    assert.equal((await stat(join(root, 'vector.env'))).mode & 0o777, 0o640);
    assert.equal((await stat(join(root, 'backup'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, 'backup/config'))).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});
