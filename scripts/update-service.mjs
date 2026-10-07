import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { readFile, lstat, realpath, mkdir, chmod, chown, unlink, mkdtemp, writeFile } from 'node:fs/promises';
import { promisify, parseEnv } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UpdateControl, updatePhases } from './lib/update-control.mjs';
import { atomicWrite } from './lib/migration-files.mjs';

const execute = promisify(execFile);
const app = '/opt/vector/app';
const socket = '/run/vector-updater/control.sock';
const stateRoot = '/var/lib/vector-updater';
const officialRepository = 'https://github.com/Cypher87/Vector.git';
const environment = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null' };
const revisionPattern = /^[a-f0-9]{40}$/;

export async function boundedJson(request, maximum = 4096) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid_request');
  return result;
}

export async function trustedDownload(url, maximum, fetcher = fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['api.github.com', 'raw.githubusercontent.com'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('untrusted_source');
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Vector-updater', accept: 'application/vnd.github+json' } });
  if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > maximum) throw new Error('download_failed');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('download_too_large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

async function config() {
  const path = '/etc/vector/vector.env';
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) || info.size > 65536) throw new Error('unsafe_configuration');
  return parseEnv(await readFile(path, 'utf8'));
}

async function current() {
  try {
    const directory = await realpath(app);
    if (dirname(directory) !== '/opt/vector/releases') throw new Error('unmanaged');
    const { stdout } = await execute('/usr/sbin/runuser', ['-u', 'vector', '--', '/usr/bin/git', '-c', `safe.directory=${directory}`, '-C', app, 'remote', 'get-url', 'origin'], { env: environment, timeout: 5000 });
    if (stdout.trim() !== officialRepository) throw new Error('custom_source');
    const info = JSON.parse(await readFile(join(app, '.vector-build.json'), 'utf8'));
    if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(info.version) || !revisionPattern.test(info.revision)) throw new Error('invalid_build');
    return { version: info.version, revision: info.revision };
  } catch { return { version: '', revision: '' }; }
}

export async function findLatest(currentRevision, download = trustedDownload) {
  if (!revisionPattern.test(currentRevision)) throw new Error('invalid_revision');
  const ref = JSON.parse(await download('https://api.github.com/repos/Cypher87/Vector/git/ref/heads/main', 16 * 1024));
  const revision = ref.object?.sha;
  if (ref.object?.type !== 'commit' || !revisionPattern.test(revision)) throw new Error('invalid_revision');
  const pkg = JSON.parse(await download(`https://raw.githubusercontent.com/Cypher87/Vector/${revision}/package.json`, 32 * 1024));
  if (revision !== currentRevision) {
    const comparison = JSON.parse(await download(`https://api.github.com/repos/Cypher87/Vector/compare/${currentRevision}...${revision}?per_page=1`, 2 * 1024 * 1024));
    if (comparison.status === 'behind') return { version: pkg.version, revision: currentRevision };
    if (comparison.status !== 'ahead') throw new Error('not_a_forward_update');
  }
  return { version: pkg.version, revision };
}

async function recoverPending(rollback = false) {
  await execute('/usr/bin/flock', ['-w', '20', '/run/lock/vector-install.lock', '/usr/local/lib/vector-installer/current/recover-install.sh', rollback ? '--rollback' : '--recover-pending'],
    { env: { ...environment, VECTOR_WEB_UPDATE: '1' }, timeout: 180_000, maxBuffer: 128 * 1024 });
}

export function phaseFromLine(line) {
  if (line.includes('Restoring the previous')) return 'restoring';
  if (line.includes('Installing locked dependencies')) return 'building';
  if (line.includes('Activating the new application')) return 'activating';
  if (line.includes('Checking receiver data')) return 'verifying';
  return null;
}

async function install(revision, progress) {
  // This revision was approved from the fixed official branch, not supplied as a shell command.
  if (!revisionPattern.test(revision)) throw new Error('invalid_revision');
  const script = await trustedDownload(`https://raw.githubusercontent.com/Cypher87/Vector/${revision}/scripts/install-debian.sh`, 256 * 1024);
  const directory = await mkdtemp(join(stateRoot, 'job-'));
  const installer = join(directory, 'install.sh');
  await writeFile(installer, script, { mode: 0o600, flag: 'wx' });
  let lines = ''; let pending = Promise.resolve(); let lastPhase = '';
  const child = spawn('/bin/bash', [installer, '--yes', '--keep-source'], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...environment, VECTOR_REF: revision, VECTOR_REPOSITORY: officialRepository, VECTOR_WEB_UPDATE: '1' },
  });
  const onData = (chunk) => {
    // Full installer output goes only to the administrator's journal, never to the browser.
    process.stdout.write(chunk);
    lines = (lines + chunk.toString('utf8')).slice(-8192);
    const split = lines.split('\n'); lines = split.pop() || '';
    for (const line of split) {
      const phase = phaseFromLine(line);
      if (phase && phase !== lastPhase) { lastPhase = phase; pending = pending.then(() => progress(phase)).catch(() => {}); }
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  let forcedKill;
  const timeout = setTimeout(() => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
    forcedKill = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ } }, 5000);
  }, 30 * 60_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    await pending;
    if (code !== 0 || (await current()).revision !== revision) {
      await progress('restoring');
      try { await recoverPending(code === 0); } catch { throw new Error('recovery_required'); }
      throw new Error('update_failed');
    }
  } finally {
    clearTimeout(timeout); clearTimeout(forcedKill);
    // Keep this root-only job script for diagnosing failed updates; it contains no password/session.
  }
}

export function createUpdateServer(control) {
  const server = createServer(async (request, response) => {
    const reply = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
    try {
      const action = request.url?.slice(1);
      if (!['status', 'login', 'logout', 'check', 'apply'].includes(action) || request.method !== (action === 'status' ? 'GET' : 'POST')) return reply(404, { error: 'invalid_request' });
      const token = request.headers.authorization?.replace(/^Bearer /, '') || '';
      if (token && !/^[a-f0-9]{64}$/.test(token)) return reply(401, { error: 'unauthorized' });
      const body = request.method === 'POST' ? await boundedJson(request) : {};
      const result = await control.handle(action, body, token);
      reply(result.status, result.body);
    } catch { reply(503, { error: 'service_unavailable' }); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000; server.maxConnections = 24;
  return server;
}

export async function startUpdateService() {
  if (process.getuid?.() !== 0) throw new Error('The update service requires root');
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const statePath = join(stateRoot, 'status.json');
  let writes = Promise.resolve();
  const persist = (state) => {
    writes = writes.catch(() => {}).then(() => atomicWrite(statePath, JSON.stringify(state), 0o600, { uid: 0, gid: 0 }));
    return writes;
  };
  const control = new UpdateControl({ config, current, latest: findLatest, install, persist,
    finished: () => { setTimeout(() => process.exit(0), 1500).unref(); },
  });
  const previous = await readFile(statePath, 'utf8').then(JSON.parse).catch((error) => { if (error.code !== 'ENOENT') console.error('[Vector updater] Could not read previous status'); return null; });
  if (previous && updatePhases.includes(previous.phase)) {
    control.phase = previous.phase;
    control.error = ['update_failed', 'recovery_required'].includes(previous.error) ? previous.error : null;
    if (['downloading', 'building', 'activating', 'verifying', 'restoring'].includes(previous.phase)) {
      try { await recoverPending(); control.error = 'update_failed'; }
      catch { control.error = 'recovery_required'; }
      control.phase = 'failed';
      await persist({ phase: control.phase, error: control.error });
    }
  }
  const existing = await lstat(socket).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) {
    if (!existing.isSocket() || existing.uid !== 0) throw new Error('Refusing to replace an unexpected socket path');
    await unlink(socket);
  }
  const server = createUpdateServer(control);
  server.listen(socket);
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const { stdout } = await execute('/usr/bin/id', ['-g', 'vector'], { env: environment });
  await chown(socket, 0, Number(stdout.trim())); await chmod(socket, 0o660);
  console.log('[Vector updater] Ready; updates require explicit opt-in and administrator authentication.');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startUpdateService().catch((error) => { console.error(`[Vector updater] ${error.message}`); process.exitCode = 1; });
}
