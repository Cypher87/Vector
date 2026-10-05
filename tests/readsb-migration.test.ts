import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, unlink, statfs, rename, symlink, chmod, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { dataDirectory, argumentValue, patchEnvironment, planReadsb, readerAcl, readerCanAccess, migrationSettings } from '../scripts/lib/readsb-migration.mjs';
import { MigrationFiles, snapshot, atomicWrite } from '../scripts/lib/migration-files.mjs';
import { install } from '../scripts/migrate-install.mjs';
import { grantReadAccess, restoreAccess } from '../scripts/readsb-access.mjs';

const help = '--write-json --write-globe-history --heatmap --json-trace-hist-only --write-json-binCraft-only';
const unit = '[Service]\nEnvironmentFile=/etc/default/readsb\nExecStart=/usr/bin/readsb --write-json /run/readsb $RECEIVER_OPTIONS $DECODER_OPTIONS $NET_OPTIONS $JSON_OPTIONS\n';
const defaults = '# Existing receiver settings\nRECEIVER_OPTIONS="--device-type rtlsdr --gain 42"\nNET_OPTIONS="--net --net-bo-port 30005"\nJSON_OPTIONS="--json-location-accuracy 2"\n';
const vectorEnv = 'READSB_LIVE_URL=http://127.0.0.1/tar1090/data/\nREADSB_HISTORY_URL=http://127.0.0.1/tar1090/globe_history/\nVECTOR_SITE_NAME="My receiver"\nPORT=3000\n';
const fullArgs = ['/usr/bin/readsb', '--write-json', '/run/readsb', '--write-globe-history=/var/globe_history', '--heatmap', '30'];
const vectorUnits = ['vector.service', 'vector-aircraft-db.service', 'vector-aircraft-db.timer'];
const historyUnits = ['vector-readsb-history-clean.service', 'vector-readsb-history-clean.timer'];
const verifyArgs = (names: string[]) => ['verify', ...names.map((name) => join('/etc/systemd/system', name))];

test('detects existing receiver paths, including heatmap override, without a restart', () => {
  const plan = planReadsb({ argv: fullArgs, help, unit, defaults });
  assert.equal(plan.live, '/run/readsb');
  assert.equal(plan.history, '/var/globe_history');
  assert.equal(plan.restart, false);
  assert.equal(plan.defaults, defaults);
  assert.equal(planReadsb({ argv: [...fullArgs, '--heatmap-dir=/srv/readsb-history'], help, unit, defaults }).history, '/srv/readsb-history');
  assert.equal(argumentValue(['readsb', '--heatmap=10', '--heatmap', '20'], '--heatmap'), '20');
});

test('adds missing recording options without touching SDR and network settings; reruns are idempotent', () => {
  const argv = ['/usr/bin/readsb', '--write-json=/run/custom-readsb', '--gain', '42'];
  const plan = planReadsb({ argv, help, unit, defaults });
  assert.equal(plan.restart, true);
  assert.equal(plan.newRecording, true);
  assert.match(plan.defaults, /RECEIVER_OPTIONS="--device-type rtlsdr --gain 42"/);
  assert.match(plan.defaults, /NET_OPTIONS="--net --net-bo-port 30005"/);
  assert.match(plan.defaults, /--write-globe-history \/var\/lib\/readsb\/vector-history --heatmap 30/);
  const updated = planReadsb({ argv: [...argv, ...(parseEnv(plan.defaults).JSON_OPTIONS || '').split(/\s+/)], help, unit, defaults: plan.defaults });
  assert.equal(updated.restart, false);
  assert.equal(updated.defaults, plan.defaults);
});

test('rejects unsafe paths, unsupported builds, shell expressions and custom command rewrites', () => {
  for (const path of ['/', '/var', '/var/lib', '/etc/secret', '/home/me/data', '/run/../etc', '/run/readsb\nExecStart=bad', '/var/lib/vector/sync.json']) assert.throws(() => dataDirectory(path));
  for (const path of ['/run/readsb', '/var/globe_history', '/var/lib/readsb/vector-history', '/mnt/receiver/data']) assert.equal(dataDirectory(path), path);
  assert.throws(() => argumentValue(['readsb', '--heatmap'], '--heatmap'));
  const incomplete = ['/usr/bin/readsb', '--write-json=/run/readsb'];
  assert.throws(() => planReadsb({ argv: incomplete, help: '--write-json', unit, defaults }), /does not support/);
  assert.throws(() => planReadsb({ argv: incomplete, help, unit: unit.replace('$JSON_OPTIONS', '$CUSTOM_OPTIONS'), defaults }), /custom startup/);
  assert.throws(() => planReadsb({ argv: incomplete, help, unit, defaults: defaults.replace('--json-location-accuracy 2', '$(do-not-execute)') }), /expression/);
  assert.throws(() => planReadsb({ argv: [...fullArgs, '--full-trace-dir=/srv/other'], help, unit, defaults }), /full-trace/);
});

test('updates only Vector source settings and removes legacy URLs without losing user preferences', () => {
  const result = migrationSettings(vectorEnv, '/run/readsb', '/var/globe_history');
  assert.equal(parseEnv(result).VECTOR_SITE_NAME, 'My receiver');
  assert.equal(parseEnv(result).PORT, '3000');
  assert.equal(parseEnv(result).READSB_SOURCE, 'local');
  assert.equal(parseEnv(result).READSB_LIVE_URL, undefined);
  assert.equal(migrationSettings(result, '/run/readsb', '/var/globe_history'), result);
  assert.throws(() => patchEnvironment('A="x"', { B: 'bad\nvalue' }));
});

test('read-only ACLs do not widen masked permissions for other users or groups', () => {
  const before = 'user::rwx\nuser:2000:rwx\ngroup::rwx\nmask::r--\nother::---\n';
  const after = readerAcl(before, 900, true);
  assert.match(after, /^user:900:r-x$/m);
  assert.match(after, /^user:2000:r--$/m);
  assert.match(after, /^group::r--$/m);
  assert.match(after, /^default:group::r--$/m);
  assert.match(after, /^default:user:900:r-x$/m);
  assert.equal(readerAcl(after, 900, true), after);
  const parent = readerAcl(before, 900, true, true);
  assert.match(parent, /^user:900:--x$/m);
  assert.doesNotMatch(parent, /default:/);
  assert.match(readerAcl(before, 900, false), /^user:900:r--$/m);
});

test('existing reader access respects owner, named user, group and mask precedence', () => {
  const info = { uid: 100, gid: 200 };
  const publicAcl = 'user::rwx\ngroup::r-x\nother::r-x\n';
  assert.equal(readerCanAccess(publicAcl, info, 900, [], true), true);
  const restricted = 'user::rwx\ngroup::r-x\nother::---\n';
  assert.equal(readerCanAccess(restricted, info, 900, [], true), false);
  assert.equal(readerCanAccess(restricted, info, 900, [200], true), true);
  assert.equal(readerCanAccess(`${publicAcl}user:900:---\nmask::rwx\n`, info, 900, [], true), false);
  assert.equal(readerCanAccess(`${publicAcl}mask::---\n`, info, 900, [200], true), false);
  assert.equal(readerCanAccess(publicAcl.replace('user::rwx', 'user::---'), info, 100, [], true), false);
  assert.equal(readerCanAccess('user::rwx\ngroup::---\ngroup:300:r--\ngroup:400:--x\nmask::r-x\nother::---\n', info, 900, [300, 400], true), true);
  assert.equal(readerCanAccess('user::rwx\ngroup::---\nother::--x\n', info, 900, [], true, true), true);
});

test('write-ahead backup restores original files and refuses to overwrite later edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-migration-files-'));
  try {
    const path = join(root, 'vector.env');
    await writeFile(path, 'original');
    const tx = new MigrationFiles(join(root, 'backup'));
    await tx.write(path, 'new');
    await tx.write(join(root, 'new.conf'), 'generated');
    await writeFile(path, 'administrator edit');
    await assert.rejects(() => tx.rollback(), /preserve later edits/);
    assert.equal(await readFile(path, 'utf8'), 'administrator edit');
    await writeFile(path, 'new');
    await tx.rollback();
    assert.equal(await readFile(path, 'utf8'), 'original');
    await assert.rejects(() => readFile(join(root, 'new.conf')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Exercise the complete migration transaction against a disposable filesystem.
// Only OS/service effects are simulated; no host receiver or network is touched.
async function simulation(argv = fullArgs, env = vectorEnv) {
  const root = await mkdtemp(join(tmpdir(), 'vector-guided-'));
  const map = (path: string) => join(root, path.replaceAll('\\', '/').replace(/^\/+/, ''));
  const calls: string[] = [];
  const verifications: string[][] = [];
  const state = { argv, failHealth: false, failCheck: false, failDatabase: false, failVerify: false, services: ['readsb.service'], choice: 0, remoteUrl: 'http://vector-receiver.example:3000/' };
  const put = async (path: string, body: string) => { await mkdir(join(map(path), '..'), { recursive: true }); await writeFile(map(path), body); };
  await put('/etc/vector/vector.env', env);
  await put('/etc/default/readsb', defaults);
  await put('/etc/systemd/system/vector.service', 'old unit');
  for (const dir of ['/run/readsb', '/var/globe_history', '/var/lib']) await mkdir(map(dir), { recursive: true });
  for (const name of vectorUnits) await put(`/opt/vector/app/packaging/systemd/${name}`, await readFile(new URL(`../packaging/systemd/${name}`, import.meta.url), 'utf8'));
  class Files extends MigrationFiles {
    constructor(directory: string, initial?: ConstructorParameters<typeof MigrationFiles>[1]) { super(map(directory), initial); }
    async write(path: string, content: string, mode = 0o644) { return super.write(map(path), content, mode); }
  }
  const io = {
    log: () => {}, sleep: async () => {},
    ask: async (_question: string, choices?: string[]) => { calls.push('question'); return choices ? state.choice : state.remoteUrl; },
    readFile: async (path: string) => path.startsWith('/proc/5678/') ? '/usr/bin/python3\0/usr/share/readsb-mqtt/main.py\0' : path.startsWith('/proc/') ? `${state.argv.join('\0')}\0` : readFile(map(path), 'utf8'),
    snapshot: (path: string) => snapshot(map(path)),
    atomicWrite: (path: string, content: string) => atomicWrite(map(path), content),
    lstat: (path: string) => lstat(map(path)),
    realpath: async (path: string) => path.startsWith('/proc/5678/') ? '/usr/bin/python3' : '/usr/bin/readsb',
    mkdir: (path: string, options: { recursive: boolean; mode: number }) => mkdir(map(path), options),
    unlink: (path: string) => unlink(map(path)),
    chown: async () => {}, statfs: () => statfs(root), MigrationFiles: Files,
    grantReadAccess: async () => { calls.push('grant ACL'); },
    run: async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (command === 'id') return '900\n';
      if (command === 'systemd-analyze') {
        assert.equal(args[0], 'verify');
        assert.ok(args.length > 1, 'systemd-analyze verify requires at least one unit');
        verifications.push([...args]);
        if (args[1] !== 'readsb.service' && args[1] !== 'readsb-second.service') {
          for (const path of args.slice(1)) await readFile(map(path));
          if (state.failVerify) throw new Error('systemd-analyze failed: invalid Vector unit');
        }
      }
      if (command === 'systemctl') {
        if (args[0] === 'list-units') return state.services.map((name) => `${name} loaded active running readsb`).join('\n');
        if (args[0] === 'show') return `MainPID=${args[1] === 'readsb-mqtt.service' ? 5678 : 1234}\nUser=readsb\nGroup=readsb\nDynamicUser=no\nRootDirectory=\n`;
        if (args[0] === 'cat') return unit;
        if (args[0] === 'restart' && args[1] === 'readsb.service') state.argv = [...argv, ...(parseEnv(await readFile(map('/etc/default/readsb'), 'utf8')).JSON_OPTIONS || '').split(/\s+/)];
        if (['is-active', 'is-enabled'].includes(args[0]) && args.at(-1) !== 'vector.service') throw new Error('not active');
      }
      if (command === 'runuser') {
        if (args.includes('--help')) return help;
        if (args.some((arg) => arg.endsWith('update-aircraft-db.mjs')) && state.failDatabase) throw new Error('download failed');
        if (args.some((arg) => arg.endsWith('check-readsb.mjs')) && state.failCheck) throw new Error('database missing');
      }
      return '';
    },
    fetch: async (url: string) => {
      if (state.failHealth) return new Response(null, { status: 502 });
      return Response.json(url.endsWith('aircraft.json') ? { now: Date.now() / 1000, aircraft: [] } : { haveReplay: true });
    },
  };
  // Adapter deliberately narrows OS effects while keeping the real transaction logic.
  const migrate = (options = {}) => install(options, io as unknown as Parameters<typeof install>[1]);
  const journal = async () => {
    const { id } = JSON.parse(await readFile(map('/var/lib/vector-installer/latest.json'), 'utf8'));
    return JSON.parse(await readFile(map(`/var/lib/vector-installer/${id}/journal.json`), 'utf8'));
  };
  return { root, map, calls, verifications, state, migrate, journal, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('guided migration detects a ready receiver without questions, preserves preferences and is repeatable', async () => {
  const sim = await simulation();
  try {
    await sim.migrate();
    assert.deepEqual(sim.verifications.at(-1), verifyArgs(vectorUnits));
    assert.equal(parseEnv(await readFile(sim.map('/etc/vector/vector.env'), 'utf8')).VECTOR_SITE_NAME, 'My receiver');
    assert.equal(sim.calls.includes('question'), false);
    assert.equal(sim.calls.some((call) => call === 'systemctl restart readsb.service'), false);
    assert.equal(await readFile(sim.map('/etc/default/readsb'), 'utf8'), defaults);
    const first = await readFile(sim.map('/etc/vector/vector.env'), 'utf8');
    await sim.migrate();
    assert.deepEqual(sim.verifications.at(-1), verifyArgs(vectorUnits));
    assert.equal((await sim.journal()).status, 'complete');
    if (process.platform === 'linux') {
      assert.equal((await sim.journal()).files.some((file: { path: string }) => /\.(service|timer)$/.test(file.path)), false, 'unchanged units are still verified, without adding them to the rollback journal');
    }
    assert.equal(await readFile(sim.map('/etc/vector/vector.env'), 'utf8'), first);
    assert.equal(sim.calls.filter((call) => call === 'question').length, 0);
    assert.equal(sim.calls.some((call) => /(?:stop|disable) tar1090/.test(call)), false);
  } finally { await sim.cleanup(); }
});

test('Linux permission helper grants inheritable read-only access and ACL removal tolerates ordinary files', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-acl-'));
  try {
    await writeFile(join(root, 'aircraft.json'), '{}', { mode: 0o600 });
    const execute = async (command: string, args: string[], input?: string) => command === 'id' ? '' : execFileSync(command, args, { input, encoding: 'utf8' });
    const changes: string[] = [];
    await grantReadAccess({ uid: 77777, roots: [root] }, execute, async (entry: { path: string }) => { changes.push(entry.path); });
    assert.ok(changes.includes(join(root, 'aircraft.json')));
    const acl = await execute('getfacl', ['-cpn', root]);
    assert.match(acl, /default:user:77777:r-x/);
    assert.match(await execute('getfacl', ['-cpn', join(root, 'aircraft.json')]), /user:77777:r--/);
    await execute('setfacl', ['-R', '-P', '-x', 'u:77777,d:u:77777', '--', root]);
    await execute('setfacl', ['-R', '-P', '-x', 'u:77777,d:u:77777', '--', root]);
    assert.doesNotMatch(await execute('getfacl', ['-cpn', root]), /user:77777/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux permission writes stay on their opened inode during symlink replacement and rollback preserves later changes', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-acl-race-'));
  const execute = async (command: string, args: string[], input?: string) => command === 'id' ? '' : execFileSync(command, args, { input, encoding: 'utf8' });
  try {
    const data = join(root, 'data');
    const victim = join(root, 'private');
    await mkdir(data, { mode: 0o700 });
    await writeFile(victim, 'untouched', { mode: 0o600 });
    const path = join(data, 'aircraft.json');
    await writeFile(path, '{}', { mode: 0o600 });
    const changes: Parameters<typeof restoreAccess>[0][] = [];
    await grantReadAccess({ uid: 77777, roots: [data] }, execute, async (entry) => {
      changes.push(entry);
      if (entry.path === path) {
        await rename(path, join(data, 'original'));
        await symlink(victim, path);
      }
    });
    assert.doesNotMatch(await execute('getfacl', ['-cpn', victim]), /user:77777/);
    assert.match(await execute('getfacl', ['-cpn', join(data, 'original')]), /user:77777:r--/);
    const fileEntry = changes.find((entry) => entry.path === path);
    assert.ok(fileEntry);
    await restoreAccess(fileEntry, execute); // Does not follow the replacement link.
    assert.doesNotMatch(await execute('getfacl', ['-cpn', victim]), /user:77777/);
    await unlink(path);
    await rename(join(data, 'original'), path);
    await execute('setfacl', ['-m', 'u:77777:rw-', path]);
    await assert.rejects(() => restoreAccess(fileEntry, execute), /Later permission changes/);
    await execute('setfacl', ['--set-file=-', path], fileEntry.after);
    await restoreAccess(fileEntry, execute);
    assert.doesNotMatch(await execute('getfacl', ['-cpn', path]), /user:77777/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux readable receiver output works without any setfacl calls, including on ACL-less filesystems', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-readable-'));
  try {
    await chmod(root, 0o755);
    await writeFile(join(root, 'aircraft.json'), '{}', { mode: 0o644 });
    await mkdir(join(root, 'traces'), { mode: 0o755 });
    const execute = async (command: string, args: string[]) => {
      assert.notEqual(command, 'setfacl', 'Existing readable output must not require ACL support');
      return command === 'id' ? '' : execFileSync(command, args, { encoding: 'utf8' });
    };
    const changes: string[] = [];
    await grantReadAccess({ uid: 77777, roots: [root] }, execute, async (entry) => { changes.push(entry.path); });
    assert.deepEqual(changes, []);
    assert.equal((await lstat(root)).mode & 0o777, 0o755);
    assert.equal((await lstat(join(root, 'aircraft.json'))).mode & 0o777, 0o644);
    // A later readsb-style atomic replacement remains readable without default ACLs.
    await writeFile(join(root, 'next.json'), '{}', { mode: 0o644 });
    await rename(join(root, 'next.json'), join(root, 'aircraft.json'));
    await grantReadAccess({ uid: 77777, roots: [root] }, execute);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Linux unsupported ACLs fail on a disposable probe without modifying receiver permissions', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'vector-no-acl-'));
  try {
    await chmod(root, 0o755);
    const file = join(root, 'aircraft.json');
    await writeFile(file, '{}', { mode: 0o600 });
    const execute = async (command: string, args: string[]) => {
      if (command === 'id') return '';
      if (command === 'setfacl') {
        const target = await realpath(args.at(-1)!);
        assert.match(target, /\.vector-acl-check-/);
        await chmod(args.at(-1)!, 0o640); // Reproduce setfacl's mode-bit fallback on unsupported filesystems.
        throw new Error('Operation not supported');
      }
      return execFileSync(command, args, { encoding: 'utf8' });
    };
    const changes: string[] = [];
    await assert.rejects(() => grantReadAccess({ uid: 77777, roots: [root] }, execute, async (entry) => { changes.push(entry.path); }), /Cannot grant Vector read access.*aircraft\.json.*ACL setup is unavailable/);
    assert.deepEqual(changes, []);
    assert.equal((await lstat(root)).mode & 0o777, 0o755);
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(root), ['aircraft.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('auxiliary readsb-mqtt is excluded before presenting receiver choices', async () => {
  const sim = await simulation();
  try {
    sim.state.services = ['readsb-mqtt.service', 'readsb.service'];
    await sim.migrate();
    assert.equal(sim.calls.includes('question'), false);
    assert.equal(JSON.parse(await readFile(sim.map('/etc/vector/readsb-access.json'), 'utf8')).service, 'readsb.service');
  } finally { await sim.cleanup(); }
});

test('missing recording options ask once, preserve receiver settings and install bounded retention only for a new directory', async () => {
  const sim = await simulation(['/usr/bin/readsb', '--write-json', '/run/readsb']);
  try {
    await sim.migrate();
    assert.deepEqual(sim.verifications.at(-1), verifyArgs([...vectorUnits, ...historyUnits]));
    assert.equal(sim.calls.filter((call) => call === 'question').length, 1);
    assert.ok(sim.calls.includes('systemctl restart readsb.service'));
    assert.match(await readFile(sim.map('/etc/default/readsb'), 'utf8'), /--gain 42/);
    assert.match(await readFile(sim.map('/etc/tmpfiles.d/vector-readsb-history.conf'), 'utf8'), /7d/);
    await sim.migrate();
    assert.deepEqual(sim.verifications.at(-1), verifyArgs([...vectorUnits, ...historyUnits]));
    if (process.platform === 'linux') {
      assert.equal((await sim.journal()).files.some((file: { path: string }) => /\.(service|timer)$/.test(file.path)), false);
    }
    assert.equal(sim.calls.filter((call) => call === 'question').length, 1);
    assert.equal(sim.calls.filter((call) => call === 'systemctl restart readsb.service').length, 1);
  } finally { await sim.cleanup(); }
});

test('a cancelled receiver restart leaves configuration and units untouched', async () => {
  const sim = await simulation(['/usr/bin/readsb', '--write-json=/run/readsb']);
  sim.state.choice = 1;
  try {
    await assert.rejects(() => sim.migrate(), /cancelled/);
    assert.equal(await readFile(sim.map('/etc/vector/vector.env'), 'utf8'), vectorEnv);
    assert.equal(await readFile(sim.map('/etc/default/readsb'), 'utf8'), defaults);
    assert.equal(sim.calls.includes('grant ACL'), false);
  } finally { await sim.cleanup(); }
});

test('failed post-restart health check restores config, unit and readsb options', async () => {
  const sim = await simulation(['/usr/bin/readsb', '--write-json=/run/readsb']);
  sim.state.failHealth = true;
  try {
    await assert.rejects(() => sim.migrate(), /Previous configuration restored/);
    assert.equal(await readFile(sim.map('/etc/vector/vector.env'), 'utf8'), vectorEnv);
    assert.equal(await readFile(sim.map('/etc/systemd/system/vector.service'), 'utf8'), 'old unit');
    assert.equal(await readFile(sim.map('/etc/default/readsb'), 'utf8'), defaults);
    assert.equal(sim.calls.filter((call) => call === 'systemctl restart readsb.service').length, 2);
    assert.equal((await lstat(sim.map('/var/lib/readsb/vector-history'))).isDirectory(), true, 'recordings are never removed during recovery');
  } finally { await sim.cleanup(); }
});

test('a missing database stops migration before changing receiver options or publishing new config', async () => {
  const sim = await simulation(['/usr/bin/readsb', '--write-json=/run/readsb']);
  sim.state.failDatabase = true;
  sim.state.failCheck = true;
  try {
    await assert.rejects(() => sim.migrate(), /Previous configuration restored/);
    assert.equal(await readFile(sim.map('/etc/vector/vector.env'), 'utf8'), vectorEnv);
    assert.equal(await readFile(sim.map('/etc/default/readsb'), 'utf8'), defaults);
    assert.equal(sim.calls.includes('grant ACL'), false);
    assert.equal(sim.calls.includes('systemctl restart readsb.service'), false);
  } finally { await sim.cleanup(); }
});

test('external legacy HTTP sources require an explicit Vector URL and never survive as fallbacks', async () => {
  const remote = vectorEnv.replaceAll('127.0.0.1', 'receiver.example');
  const sim = await simulation(fullArgs, remote);
  try {
    await sim.migrate();
    assert.deepEqual(sim.verifications, [verifyArgs(vectorUnits)]);
    assert.equal(sim.calls.filter((call) => call === 'question').length, 2);
    const migrated = parseEnv(await readFile(sim.map('/etc/vector/vector.env'), 'utf8'));
    assert.equal(migrated.READSB_SOURCE, 'vector');
    assert.equal(migrated.READSB_REMOTE_URL, sim.state.remoteUrl);
    assert.equal(migrated.READSB_LIVE_URL, undefined);
    assert.equal(migrated.READSB_HISTORY_URL, undefined);
    assert.equal(migrated.VECTOR_SITE_NAME, 'My receiver');
    assert.equal(sim.calls.includes('grant ACL'), false);
    await sim.migrate({ keepSource: true });
    assert.deepEqual(sim.verifications, [verifyArgs(vectorUnits), verifyArgs(vectorUnits)]);
    assert.equal(sim.calls.filter((call) => call === 'question').length, 2);
  } finally { await sim.cleanup(); }
});

test('multiple receivers require one explicit selection and missing local receiver offers a fallback', async () => {
  const sim = await simulation();
  try {
    sim.state.services = ['readsb.service', 'readsb-second.service'];
    sim.state.choice = 1;
    await sim.migrate();
    assert.equal(sim.calls.filter((call) => call === 'question').length, 1);
    assert.equal(JSON.parse(await readFile(sim.map('/etc/vector/readsb-access.json'), 'utf8')).service, 'readsb-second.service');
  } finally { await sim.cleanup(); }
  const noReceiver = await simulation();
  try {
    noReceiver.state.services = [];
    await noReceiver.migrate();
    assert.equal(noReceiver.calls.filter((call) => call === 'question').length, 1);
    assert.equal(parseEnv(await readFile(noReceiver.map('/etc/vector/vector.env'), 'utf8')).READSB_REMOTE_URL, noReceiver.state.remoteUrl);
  } finally { await noReceiver.cleanup(); }
});

test('keep-source refuses legacy HTTP before changes but preserves existing Vector connections', async () => {
  const legacy = await simulation();
  try {
    await assert.rejects(() => legacy.migrate({ keepSource: true }), /without --keep-source/);
    assert.equal(await readFile(legacy.map('/etc/vector/vector.env'), 'utf8'), vectorEnv);
    assert.equal(legacy.calls.length, 0);
  } finally { await legacy.cleanup(); }
  const environment = 'READSB_SOURCE=vector\nREADSB_REMOTE_URL=http://vector-receiver.example:3000/\nVECTOR_SITE_NAME="My receiver"\n';
  const remote = await simulation(fullArgs, environment);
  try {
    await remote.migrate();
    assert.equal(await readFile(remote.map('/etc/vector/vector.env'), 'utf8'), environment);
    assert.equal(remote.calls.includes('question'), false);
    assert.equal(remote.calls.includes('grant ACL'), false);
  } finally { await remote.cleanup(); }
});

test('cancelled or invalid remote migrations leave the original source and receiver untouched', async () => {
  for (const answer of ['cancel', 'file:///private', 'https://user:secret@receiver.example/', 'https://receiver.example/?url=elsewhere']) {
    const sim = await simulation();
    try {
      sim.state.services = [];
      sim.state.remoteUrl = answer;
      await assert.rejects(() => sim.migrate());
      assert.equal(await readFile(sim.map('/etc/vector/vector.env'), 'utf8'), vectorEnv);
      assert.equal(sim.calls.includes('grant ACL'), false);
      assert.equal(sim.calls.some((call) => call.startsWith('systemctl restart')), false);
    } finally { await sim.cleanup(); }
  }
});

test('an interrupted journal is recovered before another migration begins', async () => {
  const sim = await simulation();
  try {
    await sim.migrate();
    const pointer = JSON.parse(await readFile(sim.map('/var/lib/vector-installer/latest.json'), 'utf8'));
    const journalPath = sim.map(`/var/lib/vector-installer/${pointer.id}/journal.json`);
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.status = 'pending';
    await writeFile(journalPath, JSON.stringify(journal));
    sim.calls.length = 0;
    await sim.migrate();
    assert.equal(JSON.parse(await readFile(journalPath, 'utf8')).status, 'rolled-back');
    assert.ok(sim.calls.indexOf('systemctl restart vector.service') < sim.calls.findIndex((call) => call.startsWith('systemctl list-units')));
  } finally { await sim.cleanup(); }
});

test('failed Vector unit verification restores configuration before enabling new timers', async () => {
  const sim = await simulation();
  sim.state.failVerify = true;
  try {
    await assert.rejects(() => sim.migrate(), /systemd-analyze failed: invalid Vector unit[\s\S]*Previous configuration restored/);
    assert.equal(await readFile(sim.map('/etc/vector/vector.env'), 'utf8'), vectorEnv);
    assert.equal(await readFile(sim.map('/etc/systemd/system/vector.service'), 'utf8'), 'old unit');
    assert.equal(sim.calls.some((call) => call.startsWith('systemctl enable --now')), false);
    assert.equal((await sim.journal()).status, 'rolled-back');
  } finally { await sim.cleanup(); }
});

test('Linux systemd accepts the actual verification arguments on initial and repeated installs', { skip: process.platform !== 'linux' }, async () => {
  const sim = await simulation(['/usr/bin/readsb', '--write-json=/run/readsb']);
  try {
    await sim.migrate();
    await sim.migrate();
    const unitDir = sim.map('/etc/systemd/system');
    await writeFile(join(unitDir, 'readsb.service'), '[Unit]\nDescription=Isolated readsb validation fixture\n[Service]\nExecStart=/usr/bin/true\n');
    const dropin = join(unitDir, 'readsb.service.d/90-vector-access.conf');
    await writeFile(dropin, (await readFile(dropin, 'utf8')).replaceAll('/opt/vector/runtime/node/bin/node', process.execPath));
    for (const name of vectorUnits.filter((name) => name.endsWith('.service'))) {
      const path = join(unitDir, name);
      await writeFile(path, (await readFile(path, 'utf8')).replaceAll('/opt/vector/runtime/node/bin/node', process.execPath));
    }
    assert.equal(sim.verifications.length, 4);
    for (const args of sim.verifications) {
      // Run the installer's captured arguments against real systemd, mapping only fixture paths.
      execFileSync('systemd-analyze', ['--generators=no', '--man=no', args[0],
        ...args.slice(1).map((path) => sim.map(path.startsWith('/') ? path : `/etc/systemd/system/${path}`))],
      { env: { ...process.env, SYSTEMD_UNIT_PATH: `${unitDir}:/usr/lib/systemd/system` }, encoding: 'utf8' });
    }
  } finally { await sim.cleanup(); }
});
