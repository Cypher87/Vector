import { UpdateAuth, validPasswordHash } from './update-auth.mjs';

export const updatePhases = ['idle', 'checking', 'downloading', 'building', 'activating', 'verifying', 'restoring', 'complete', 'failed'];
const runningPhases = new Set(['downloading', 'building', 'activating', 'verifying', 'restoring']);
const revisionPattern = /^[a-f0-9]{40}$/;

/** No browser input can select a URL, branch, command, environment variable or file. */
export class UpdateControl {
  constructor(io) {
    this.io = io;
    this.auth = new UpdateAuth(io.now || Date.now);
    this.now = io.now || Date.now;
    this.phase = 'idle'; this.error = null; this.available = null; this.checkedAt = 0;
    this.checking = false; this.job = null; this.lastCheck = 0;
  }

  async status(authenticated, configured) {
    const current = await this.io.current();
    return { enabled: true, ready: configured && !!current.revision, authenticated, current, phase: this.phase, error: this.error,
      ...(authenticated ? { available: this.available, checkedAt: this.checkedAt || null } : {}),
      ...(!configured ? { error: 'password_not_configured' } : !current.revision ? { error: 'unmanaged_installation' } : {}) };
  }

  async handle(action, body = {}, token = '') {
    const config = await this.io.config();
    const enabled = config.VECTOR_UPDATES_ENABLED === 'true';
    const hash = config.VECTOR_UPDATE_PASSWORD_HASH;
    this.auth.configure(enabled ? hash || '' : '');
    if (!enabled) return { status: action === 'status' ? 200 : 403, body: { enabled: false, error: 'disabled' } };
    const configured = validPasswordHash(hash);
    const authenticated = this.auth.authenticated(token);
    if (action === 'status') return { status: 200, body: await this.status(authenticated, configured) };
    if (!configured) return { status: 503, body: { error: 'password_not_configured' } };
    if (action === 'login') {
      const result = await this.auth.login(body.password, hash);
      return { status: result.status, body: result.token ? { token: result.token } : { error: result.error } };
    }
    if (!authenticated) return { status: 401, body: { error: 'unauthorized' } };
    if (action === 'logout') { this.auth.logout(token); return { status: 200, body: { authenticated: false } }; }
    if (this.job || this.restarting || runningPhases.has(this.phase)) return { status: 409, body: { error: 'busy' } };
    if (action === 'check') {
      if (this.checking || (this.lastCheck && this.now() - this.lastCheck < 60_000)) return { status: 429, body: { error: 'check_limited' } };
      this.checking = true; this.lastCheck = this.now(); this.phase = 'checking'; this.error = null;
      try {
        const current = await this.io.current({ refresh: true });
        if (!revisionPattern.test(current.revision)) throw new Error('unmanaged_installation');
        const latest = await this.io.latest(current.revision);
        if (!revisionPattern.test(latest.revision) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(latest.version)) throw new Error('check_failed');
        this.available = latest.revision === current.revision ? null : latest;
        this.checkedAt = this.now(); this.phase = 'idle';
        return { status: 200, body: await this.status(true, true) };
      } catch (error) {
        this.available = null; this.phase = 'idle'; this.error = error.message === 'unmanaged_installation' ? error.message : 'check_failed';
        return { status: 502, body: { error: this.error } };
      } finally { this.checking = false; }
    }
    if (action !== 'apply') return { status: 400, body: { error: 'invalid_request' } };
    if (this.checking || body.confirm !== true || !this.available || body.revision !== this.available.revision || this.now() - this.checkedAt > 15 * 60_000) {
      return { status: 409, body: { error: 'check_required' } };
    }
    const revision = this.available.revision;
    this.phase = 'downloading'; this.error = null;
    // Mark busy before any async writes, and acknowledge independently of the web process being restarted.
    this.job = this.perform(revision);
    return { status: 202, body: { phase: this.phase } };
  }

  async perform(revision) {
    try {
      await this.io.persist({ phase: this.phase, revision });
      await this.io.install(revision, async (phase) => {
        if (!runningPhases.has(phase)) return;
        this.phase = phase;
        await this.io.persist({ phase, revision });
      });
      this.phase = 'complete'; this.available = null;
    } catch (error) { this.phase = 'failed'; this.error = error.message === 'recovery_required' ? 'recovery_required' : 'update_failed'; }
    finally {
      try { await this.io.persist({ phase: this.phase, error: this.error, revision }); }
      catch { this.phase = 'failed'; this.error = 'recovery_required'; }
      finally { this.restarting = !!this.io.finished; this.job = null; this.io.finished?.(); }
    }
  }
}
