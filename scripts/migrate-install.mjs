import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { networkInterfaces, hostname } from 'node:os';
import { parseEnv } from 'node:util';
import { readFile, mkdir, chown, lstat, realpath, statfs, unlink } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { configPath, ownedHistory, planReadsb, migrationSettings, patchEnvironment, serviceName, dataDirectory } from './lib/readsb-migration.mjs';
import { MigrationFiles, atomicWrite, snapshot } from './lib/migration-files.mjs';
import { grantReadAccess, restoreAccess } from './readsb-access.mjs';
import { ReleaseSwitch } from './lib/release-switch.mjs';

const app = '/opt/vector/app';
const node = '/opt/vector/runtime/node/bin/node';
const admin = '/usr/local/lib/vector';
const backups = '/var/lib/vector-installer';
const unitRoot = '/etc/systemd/system';
const log = (message) => console.log(`[Vector] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const system = { run, ask, readFile, mkdir, chown, lstat, realpath, statfs, unlink, snapshot, atomicWrite,
  MigrationFiles, ReleaseSwitch, grantReadAccess, fetch: (...args) => fetch(...args), sleep, log };

export function run(command, args, input, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${(stderr || error.message).slice(0, 1500)}`));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

export async function ask(question, choices, fallback, yes = false) {
  if (yes && fallback !== undefined) return fallback;
  if (!process.stdin.isTTY) throw new Error(`Input is required: ${question}. Run interactively, or specify the receiver with VECTOR_READSB_SERVICE.`);
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await reader.question(`${question}${choices ? ` (${choices.map((choice, i) => `${i + 1}: ${choice}`).join('; ')})` : ''}${fallback !== undefined ? ` [${choices ? fallback + 1 : fallback}]` : ''}: `)).trim();
      if (!answer && fallback !== undefined) return fallback;
      if (!choices && answer) return answer;
      const index = Number(answer) - 1;
      if (answer && Number.isInteger(index) && index >= 0 && index < choices.length) return index;
    }
  } finally { reader.close(); }
}

export function localUrl(value, addresses) {
  try { const url = new URL(value); return ['localhost', '[::1]', '::1', hostname(), ...addresses].includes(url.hostname) || /^127\./.test(url.hostname); } catch { return false; }
}

async function receiver(service, io) {
  const { run, readFile, realpath } = io;
  const properties = await run('systemctl', ['show', service, '--property=MainPID,User,Group,DynamicUser,RootDirectory']);
  const info = Object.fromEntries(properties.trim().split('\n').map((line) => { const equals = line.indexOf('='); return [line.slice(0, equals), line.slice(equals + 1)]; }));
  if (!/^[1-9]\d*$/.test(info.MainPID || '')) throw new Error('Receiver service is not running');
  if (info.DynamicUser === 'yes' || info.RootDirectory) throw new Error('Isolated receivers need a remote Vector source');
  const argv = (await readFile(`/proc/${info.MainPID}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  const executable = await realpath(`/proc/${info.MainPID}/exe`);
  if (basename(executable) !== 'readsb' || !argv.length || basename(argv[0]) !== 'readsb') {
    throw new Error('Not a readsb decoder; skipping auxiliary service');
  }
  const user = info.User || 'root';
  const uid = Number((await run('id', ['-u', user])).trim());
  const gid = Number((await run('id', ['-g', user])).trim());
  return { service, argv, executable, user, uid, gid, unit: await run('systemctl', ['cat', service]) };
}

async function selectReceiver(environment, yes, io) {
  const { run, ask, log } = io;
  if (environment.READSB_SOURCE === 'vector') return false;
  const listing = await run('systemctl', ['list-units', '--all', '--type=service', '--plain', '--no-legend', 'readsb*.service']);
  const names = process.env.VECTOR_READSB_SERVICE ? [serviceName(process.env.VECTOR_READSB_SERVICE)]
    : [...new Set(listing.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((name) => /^readsb[\w.@-]*\.service$/.test(name)))];
  const available = [];
  for (const name of names) {
    try { available.push(await receiver(name, io)); } catch (error) { log(`${name}: ${error.message}`); }
  }
  if (!available.length) return null;
  const addresses = Object.values(networkInterfaces()).flat().filter(Boolean).map((item) => item.address);
  if (environment.READSB_SOURCE !== 'local' && environment.READSB_LIVE_URL && !localUrl(environment.READSB_LIVE_URL, addresses)) {
    const choice = await ask('Legacy HTTP sources are no longer supported. Which receiver should Vector use?', ['Connect another Vector receiver', 'Use readsb on this machine', 'Cancel installation'], undefined, yes);
    if (choice === 2) throw new Error('Installation cancelled; receiver unchanged');
    if (choice === 0) return null;
  }
  return available.length === 1 ? available[0] : available[await ask('Multiple receivers found. Choose one', available.map((item) => item.service), undefined, yes)];
}

async function asVector(script, file, io, args = [], release) {
  const { run } = io;
  const directory = release?.directory || app;
  return run('runuser', ['-u', 'vector', '--', 'env', '-i', `--chdir=${directory}`, 'HOME=/var/lib/vector', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8',
    release ? `${release.runtime}/bin/node` : node, '--experimental-strip-types', `--env-file=${file}`, `${directory}/scripts/${script}`, ...args], undefined, 180_000);
}

async function readableReceiver(file, requireReplay, io, release) {
  const { run } = io;
  // This check runs with exactly the service user's permissions, not root's.
  const code = `const fs=require('node:fs'); const p=require('node:path'); const d=process.env.READSB_LIVE_DIR; const a=JSON.parse(fs.readFileSync(p.join(d,'aircraft.json'))); const r=JSON.parse(fs.readFileSync(p.join(d,'receiver.json'))); if(!Array.isArray(a.aircraft)||!Number.isFinite(a.now)||Math.abs(Date.now()/1000-a.now)>60)throw Error('Receiver snapshot is not fresh'); if(${requireReplay}&&!r.haveReplay)throw Error('Receiver replay is not enabled');`;
  await run('runuser', ['-u', 'vector', '--', 'env', '-i', `--chdir=${release?.directory || app}`, release ? `${release.runtime}/bin/node` : node, `--env-file=${file}`, '-e', code], undefined, 5000);
}

async function waitFor(check, seconds, io) {
  let last;
  for (let i = 0; i < seconds; i++) {
    try { await check(); return; } catch (error) { last = error; await io.sleep(1000); }
  }
  throw last;
}

async function health(environment, io) {
  const { run, fetch, log } = io;
  const port = Number(environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Vector port');
  const host = environment.HOST && !['0.0.0.0', '::'].includes(environment.HOST) ? environment.HOST : '127.0.0.1';
  const origin = `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
  await waitFor(async () => {
    await run('systemctl', ['is-active', '--quiet', 'vector.service']);
    for (const path of ['/api/config', '/api/readsb?source=live&path=receiver.json', '/api/readsb?source=live&path=aircraft.json']) {
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) throw new Error(`Vector data check returned HTTP ${response.status}`);
      const json = await response.json();
      if (path.endsWith('aircraft.json') && (!Array.isArray(json.aircraft) || !Number.isFinite(json.now) || Math.abs(Date.now() / 1000 - json.now) > 60)) throw new Error('Vector is not receiving fresh aircraft data');
    }
  }, 20, io);
  log(`Installation verified. Open http://<pi-address>:${port}`);
}

async function serviceState(name, io) {
  const { run } = io;
  return { name, active: await run('systemctl', ['is-active', '--quiet', name]).then(() => true, () => false),
    enabled: await run('systemctl', ['is-enabled', '--quiet', name]).then(() => true, () => false) };
}

async function stopVector(io) {
  for (const name of ['vector-aircraft-db.timer', 'vector-aircraft-db.service', 'vector.service']) {
    const load = (await io.run('systemctl', ['show', name, '--property=LoadState', '--value'])).trim();
    if (load !== 'not-found') await io.run('systemctl', ['stop', name]);
  }
}

export async function recover(transaction, io = system) {
  const { run, log } = io;
  log('Restoring the previous installation and configuration. Recorded receiver data will not be deleted.');
  transaction.state.status = 'recovering';
  await transaction.save();
  // Stop writers before restoring configuration/runtime. Keep recovery pending until all services recover.
  await stopVector(io);
  await transaction.rollback({ complete: false });
  if (transaction.state.release) await new io.ReleaseSwitch(transaction).restore();
  for (const acl of [...(transaction.state.acls || [])].reverse()) {
    try { await restoreAccess(acl, run); } catch { log(`Could not restore access on ${acl.path}; later changes preserved and backup retained.`); }
  }
  await run('systemctl', ['daemon-reload']);
  if (transaction.state.receiverRestarted) await run('systemctl', ['restart', transaction.state.receiverRestarted]);
  for (const state of transaction.state.services || []) {
    if (state.enabled) await run('systemctl', ['enable', state.name]);
    else await run('systemctl', ['disable', state.name]).catch(() => {});
    // A web update's parent worker must survive until it records the outcome.
    if (state.name === 'vector-updater.service' && process.env.VECTOR_WEB_UPDATE === '1') continue;
    if (state.active) await run('systemctl', ['restart', state.name]);
    else await run('systemctl', ['stop', state.name]).catch(() => {});
  }
  transaction.state.status = 'rolled-back';
  await transaction.save();
}

async function latest(io) {
  const { readFile, MigrationFiles } = io;
  try {
    const pointer = JSON.parse(await readFile(join(backups, 'latest.json'), 'utf8'));
    if (!/^[0-9A-Za-z-]+$/.test(pointer.id)) throw new Error('Invalid recovery identifier');
    const directory = join(backups, pointer.id);
    return new MigrationFiles(directory, JSON.parse(await readFile(join(directory, 'journal.json'), 'utf8')));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function install({ yes = false, keepSource = false, release } = {}, io = system) {
  const { run, ask, readFile, mkdir, chown, lstat, statfs, unlink, snapshot, atomicWrite, MigrationFiles, grantReadAccess, log } = io;
  const privilegedSource = release?.sourceDirectory || release?.directory || app;
  if (release?.sourceDirectory) {
    const info = await lstat(privilegedSource);
    if (!/^\/opt\/vector\/\.source-[A-Za-z0-9]+$/.test(privilegedSource) || !info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077)) {
      throw new Error('Privileged installer source must be a root-only checkout');
    }
  }
  const prior = await latest(io);
  if (['pending', 'recovering'].includes(prior?.state.status)) {
    log('An interrupted migration was found; recovering it before continuing.');
    await recover(prior, io);
  }
  const original = (await snapshot(configPath))?.content;
  if (!original) throw new Error('Vector configuration is missing');
  const environment = parseEnv(original);
  const legacy = environment.READSB_SOURCE === 'http' || (!environment.READSB_SOURCE && (environment.READSB_LIVE_URL || environment.READSB_HISTORY_URL));
  if (keepSource && legacy) throw new Error('Legacy HTTP sources cannot be retained. Run the installer without --keep-source to migrate to readsb files or another Vector server.');
  if (environment.READSB_SOURCE && !['local', 'vector', 'http'].includes(environment.READSB_SOURCE)) throw new Error('Unsupported READSB_SOURCE; configuration unchanged');
  const selected = keepSource ? false : await selectReceiver(environment, yes, io);
  let candidate = patchEnvironment(original, {}, ['READSB_LIVE_URL', 'READSB_HISTORY_URL', 'READSB_TAR1090_URL']);
  let plan;
  if (selected) {
    const help = await run('runuser', ['-u', 'vector', '--', selected.executable, '--help']);
    plan = planReadsb({ ...selected, help, defaults: (await snapshot('/etc/default/readsb'))?.content || '' });
    if (plan.restart && await ask(`Enable missing readsb recording/output options and briefly restart ${selected.service}?${plan.newRecording ? ' New Vector history is retained for 7 days.' : ''}`, ['Continue', 'Cancel installation'], 0, yes) !== 0) throw new Error('Installation cancelled; receiver unchanged');
    candidate = migrationSettings(original, plan.live, plan.history);
    log(`Detected ${selected.service}; using local readsb files.`);
  } else if (selected === null) {
    const value = await ask('Enter the URL of another Vector receiver (or cancel)', undefined, undefined, yes);
    if (value.trim().toLowerCase() === 'cancel') throw new Error('Installation cancelled; receiver unchanged');
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter a plain HTTP(S) Vector URL without credentials');
    candidate = patchEnvironment(original, { READSB_SOURCE: 'vector', READSB_REMOTE_URL: url.href }, ['READSB_LIVE_URL', 'READSB_HISTORY_URL', 'READSB_TAR1090_URL']);
  }
  const id = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomUUID()}`;
  const transaction = new MigrationFiles(join(backups, id));
  transaction.state.services = await Promise.all(['vector.service', 'vector-aircraft-db.timer', 'vector-readsb-history-clean.timer', ...(release ? ['vector-updater.service'] : [])].map((name) => serviceState(name, io)));
  transaction.state.acls = [];
  await transaction.save();
  await atomicWrite(join(backups, 'latest.json'), JSON.stringify({ id }));
  log(`Recovery backup: ${transaction.directory}`);
  const stagedConfig = `/etc/vector/.migration-${id}.env`;
  try {
    if (release) {
      await new io.ReleaseSwitch(transaction).prepare(release.directory, release.runtime);
      // Dependencies first, entry point last. Hooks execute only root-owned helper copies.
      for (const name of ['lib/release-switch.mjs', 'lib/migration-files.mjs', 'lib/readsb-migration.mjs', 'readsb-access.mjs', 'migrate-install.mjs']) {
        await transaction.write(join(admin, name), await readFile(join(privilegedSource, 'scripts', name), 'utf8'), 0o644, { uid: 0, gid: 0 });
      }
      for (const name of ['lib/update-auth.mjs', 'lib/update-control.mjs', 'lib/migration-files.mjs', 'lib/readsb-migration.mjs', 'set-update-password.mjs', 'update-service.mjs']) {
        await transaction.write(join('/usr/local/lib/vector-updater', name), await readFile(join(privilegedSource, 'scripts', name), 'utf8'), 0o644, { uid: 0, gid: 0 });
      }
    }
    // Running Vector continues using its original configuration until preflight passes.
    const gid = Number((await run('id', ['-g', 'vector'])).trim());
    await transaction.write(stagedConfig, candidate, 0o640, { uid: 0, gid });
    try { log((await asVector('update-aircraft-db.mjs', stagedConfig, io, [], release)).trim()); }
    catch { log('Database download unavailable; checking the last valid copy.'); }
    log((await asVector('check-readsb.mjs', stagedConfig, io, ['--database-only'], release)).trim());
    if (plan) {
      const roots = [...new Set([plan.live, plan.history, plan.recording])];
      for (const root of roots) {
        const info = await lstat(root).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
        if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('Receiver data root is not a regular directory');
        if (!info) {
          if (root !== ownedHistory && root !== '/run/readsb') throw new Error('A configured receiver directory is missing; refusing to create an unknown mount point');
          const space = await statfs('/var/lib');
          if (root === ownedHistory && space.bavail * space.bsize < 1024 ** 3) throw new Error('At least 1 GiB free disk space is required for new receiver history');
          await mkdir(root, { recursive: true, mode: 0o755 });
          await chown(root, selected.uid, selected.gid);
          if (root === ownedHistory) {
            const created = await lstat(root);
            await atomicWrite(join(backups, 'owned-history.json'), JSON.stringify({ path: root, ino: created.ino, dev: created.dev }));
          }
        }
      }
      const owned = await readFile(join(backups, 'owned-history.json'), 'utf8').then(JSON.parse).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (owned && roots.includes(ownedHistory)) {
        const info = await lstat(ownedHistory);
        transaction.state.ownedHistory = owned.path === ownedHistory && info.ino === owned.ino && info.dev === owned.dev;
      }
      const spec = { uid: Number((await run('id', ['-u', 'vector'])).trim()), roots: [...new Set([plan.live, plan.history])], service: selected.service };
      await grantReadAccess(spec, run, async (acl) => { transaction.state.acls.push(acl); await transaction.save(); });
      await transaction.write('/etc/vector/readsb-access.json', JSON.stringify(spec), 0o600);
      const dropinPath = join(unitRoot, `${selected.service}.d/90-vector-access.conf`);
      const existingDropin = await snapshot(dropinPath);
      if (existingDropin && !existingDropin.content.startsWith('# Managed by Vector;')) throw new Error('An unrelated receiver integration already occupies the Vector drop-in path');
      await transaction.write(dropinPath, `# Managed by Vector; receiver command and SDR settings remain unchanged.\n[Service]\nReadWritePaths=${roots.join(' ')}\nExecStartPost=+${release ? `${release.runtime}/bin/node` : node} ${admin}/readsb-access.mjs\n`, 0o644);
      await run('systemd-analyze', ['verify', selected.service]);
      if (plan.restart) {
        const old = await snapshot('/etc/default/readsb');
        await transaction.write('/etc/default/readsb', plan.defaults, old?.mode || 0o644, old || { uid: 0, gid: 0 });
        transaction.state.receiverRestarted = selected.service;
        await transaction.save();
      }
      await run('systemctl', ['daemon-reload']);
      if (plan.restart) await run('systemctl', ['restart', selected.service]);
      await waitFor(() => readableReceiver(stagedConfig, true, io, release), 45, io);
      if (transaction.state.ownedHistory) {
        await transaction.write('/etc/tmpfiles.d/vector-readsb-history.conf', `# Only the history directory created by Vector; existing receiver history is untouched.\ne ${ownedHistory} - - - 7d -\n`);
        await transaction.write(join(unitRoot, 'vector-readsb-history-clean.service'), `[Unit]\nDescription=Clean Vector-created readsb history\n[Service]\nType=oneshot\nExecStart=/usr/bin/systemd-tmpfiles --clean /etc/tmpfiles.d/vector-readsb-history.conf\n`);
        await transaction.write(join(unitRoot, 'vector-readsb-history-clean.timer'), '[Unit]\nDescription=Daily cleanup of Vector-created history\n[Timer]\nOnCalendar=daily\nPersistent=true\n[Install]\nWantedBy=timers.target\n');
      }
    }
    log((await asVector('check-readsb.mjs', stagedConfig, io, [], release)).trim());
    if (release) {
      log('Activating the new application.');
      await stopVector(io);
      await new io.ReleaseSwitch(transaction).activate();
    }
    await transaction.write(configPath, candidate, 0o640, { uid: 0, gid });
    const units = ['vector.service', 'vector-aircraft-db.service', 'vector-aircraft-db.timer'];
    if (release) units.push('vector-updater.service');
    for (const name of units) {
      await transaction.write(join(unitRoot, name), await readFile(join(privilegedSource, 'packaging/systemd', name), 'utf8'));
    }
    if (transaction.state.ownedHistory) units.push('vector-readsb-history-clean.service', 'vector-readsb-history-clean.timer');
    // The rollback journal omits unchanged files; repeat installs must still verify every unit.
    await run('systemd-analyze', ['verify', ...units.map((name) => join(unitRoot, name))]);
    await run('systemctl', ['daemon-reload']);
    await run('systemctl', ['enable', '--now', 'vector-aircraft-db.timer']);
    if (transaction.state.ownedHistory) await run('systemctl', ['enable', '--now', 'vector-readsb-history-clean.timer']);
    await run('systemctl', ['enable', 'vector.service']);
    await run('systemctl', ['restart', 'vector.service']);
    if (release) await run('systemctl', ['enable', '--now', 'vector-updater.service']);
    log('Checking receiver data.');
    await health(parseEnv(candidate), io);
    transaction.state.status = 'complete';
    await transaction.save();
    const source = parseEnv(candidate).READSB_SOURCE;
    log(source === 'vector' ? 'Installation complete: data comes from the configured Vector receiver.'
      : 'Migration complete: Vector reads readsb directly. Other applications and recordings have not been removed.');
  } catch (error) {
    try { await recover(transaction, io); } catch (recoveryError) { throw new Error(`${error.message}\nRecovery needs attention: ${recoveryError.message}\nBackup: ${transaction.directory}`); }
    throw new Error(`${error.message}\nPrevious installation and configuration restored. Backup: ${transaction.directory}`);
  } finally { await unlink(stagedConfig).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

async function detach() {
  const saved = await snapshot('/etc/vector/readsb-access.json');
  if (!saved) return;
  const spec = JSON.parse(saved.content);
  if (!Number.isInteger(spec.uid) || spec.uid <= 0 || !Array.isArray(spec.roots) || spec.roots.length > 3) throw new Error('Invalid receiver access configuration');
  const path = join(unitRoot, `${serviceName(spec.service)}.d/90-vector-access.conf`);
  const dropin = await snapshot(path);
  if (dropin && !dropin.content.startsWith('# Managed by Vector;')) throw new Error('The receiver integration was edited; refusing to remove it');
  if (dropin) await unlink(path);
  // Remove only Vector's named ACL entries. Recordings and other permissions stay.
  for (const root of spec.roots) {
    dataDirectory(root);
    await run('setfacl', ['-R', '-P', '-x', `u:${spec.uid},d:u:${spec.uid}`, '--', root]);
    const parents = root.split('/').slice(1, -1);
    let parent = '';
    for (const part of parents) { parent += `/${part}`; await run('setfacl', ['-x', `u:${spec.uid}`, '--', parent]); }
  }
  await unlink('/etc/vector/readsb-access.json');
  await run('systemctl', ['daemon-reload']);
  log('Receiver integration removed. readsb recordings and their retention job remain independent of Vector.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.getuid?.() !== 0) throw new Error('Installation requires root');
    const args = process.argv.slice(2);
    const releaseIndex = args.indexOf('--release');
    let release;
    if (releaseIndex >= 0) {
      const values = args.splice(releaseIndex, 3);
      if (values.length !== 3) throw new Error('--release requires the release and runtime directories');
      release = { directory: values[1], runtime: values[2] };
    }
    const sourceIndex = args.indexOf('--source');
    if (sourceIndex >= 0) {
      const values = args.splice(sourceIndex, 2);
      if (!release || values.length !== 2) throw new Error('--source requires a release and protected source directory');
      release.sourceDirectory = values[1];
    }
    if (release && !release.sourceDirectory) throw new Error('Release installation requires a protected source checkout');
    if (args.some((arg) => !['--yes', '--keep-source', '--rollback', '--recover-pending', '--detach'].includes(arg))) throw new Error('Unknown installer option');
    if (args.includes('--detach')) await detach();
    else if (args.includes('--recover-pending')) {
      const transaction = await latest(system);
      if (['pending', 'recovering'].includes(transaction?.state.status)) await recover(transaction);
    }
    else if (args.includes('--rollback')) {
      const transaction = await latest(system);
      if (!transaction || transaction.state.status === 'rolled-back') throw new Error('No migration is available to restore');
      await recover(transaction);
      log('Previous installation and configuration restored. New recordings and downloaded metadata are retained.');
    } else await install({ yes: args.includes('--yes'), keepSource: args.includes('--keep-source'), release });
  } catch (error) { console.error(`[Vector] ${error.message}`); process.exitCode = 1; }
}
