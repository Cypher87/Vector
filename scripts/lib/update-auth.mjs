import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const validPasswordHash = (value) => typeof value === 'string' && /^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(value);

export async function hashUpdatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password of 12–128 characters');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 32, parameters);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyUpdatePassword(password, encoded) {
  if (!validPasswordHash(encoded) || typeof password !== 'string' || password.length > 128) return false;
  const [, salt, expected] = encoded.split(':');
  return timingSafeEqual(await derive(password, salt, 32, parameters), Buffer.from(expected, 'hex'));
}

export class UpdateAuth {
  constructor(now = Date.now) { this.now = now; this.sessions = new Map(); this.attempts = []; this.verifying = false; this.configKey = ''; }
  configure(key) {
    if (key !== this.configKey) { this.sessions.clear(); this.configKey = key; }
  }
  authenticated(token) {
    const now = this.now();
    for (const [value, expiry] of this.sessions) if (expiry <= now) this.sessions.delete(value);
    return typeof token === 'string' && this.sessions.has(token);
  }
  async login(password, hash) {
    const now = this.now();
    this.attempts = this.attempts.filter((stamp) => stamp > now - 15 * 60_000);
    if (this.verifying || this.attempts.length >= 5) return { error: 'rate_limited', status: 429 };
    this.attempts.push(now);
    this.verifying = true;
    try {
      if (!await verifyUpdatePassword(password, hash) || this.configKey !== hash) return { error: 'invalid_password', status: 401 };
      if (this.sessions.size >= 16) this.sessions.delete(this.sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      this.sessions.set(token, now + 15 * 60_000);
      return { token, status: 200 };
    } finally { this.verifying = false; }
  }
  logout(token) { this.sessions.delete(token); }
}
