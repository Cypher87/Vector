import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logbookVisitGapMs, parseLogbookSnapshot, parseLogbookQuery } from '../src/domain/logbook.ts';
import { LogbookStore } from '../src/server/logbook-store.ts';
import { logbookSettings } from '../src/server/logbook-runtime.ts';

const now = 1_800_000_000_000;
const item = { hex: 'ABC123', flight: 'VECTOR01', r: 'PH-TEST', t: 'A320', desc: 'Airbus A320', seen: 0 };
const snapshot = (at: number, aircraft: unknown[] = [item]) => ({ now: at / 1000, aircraft });
const query = (params = '') => parseLogbookQuery(new URL(`http://localhost/api/logbook?${params}`));

test('logbook records stable identities without positions, excludes stale/non-ICAO observations and bounds text', () => {
  const parsed = parseLogbookSnapshot(snapshot(now, [item, { ...item, hex: 'def456', seen: 20 },
    { ...item, hex: '~abc123' }, { ...item, hex: 'bad' }, { ...item, hex: 'aaaaaa', seen: NaN },
    { ...item, hex: 'bbbbbb', seen: 61 }, { ...item, hex: 'cccccc', seen: undefined }, null]), now);
  assert.equal(parsed.observations.length, 2);
  assert.equal(parsed.observations[0].hex, 'abc123');
  assert.equal(parsed.observations[1].at, now - 20_000);
  assert.equal(parseLogbookSnapshot(snapshot(now, [{ ...item, flight: '\0' + 'x'.repeat(100) }]), now).observations[0].callsign.length, 24);
  for (const value of [null, {}, { aircraft: [] }, snapshot(now - 61_000), snapshot(now + 6000)]) {
    assert.throws(() => parseLogbookSnapshot(value, now));
  }
});

test('logbook joins short gaps and duplicate snapshots, keeps callsigns, and resumes the same visit after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vector-logbook-'));
  const path = join(dir, 'logbook.sqlite');
  let store = new LogbookStore(path, 90, now);
  try {
    store.record(snapshot(now), now);
    store.record(snapshot(now), now + 10_000);
    store.record(snapshot(now - 1000), now);
    store.record(snapshot(now + 60_000, [{ ...item, flight: 'VECTOR02', r: '', t: '', desc: '' }]), now + 60_000);
    store.close(); store = new LogbookStore(path, 90, now + 120_000);
    store.record(snapshot(now + 120_000), now + 120_000);
    let response = store.query(query(), now + 120_000);
    assert.equal(response.startedAt, now);
    assert.equal(response.entries[0].visits, 1);
    assert.equal(response.entries[0].firstSeen, now);
    assert.equal(response.entries[0].registration, 'PH-TEST');
    assert.equal(response.entries[0].aircraftType, 'A320');
    assert.equal(store.query(query('q=vector02'), now + 120_000).total, 1);
    const next = now + 120_000 + logbookVisitGapMs;
    store.record(snapshot(next), next);
    response = store.query(query('hex=abc123'), next);
    assert.equal(response.entries[0].visits, 2);
    assert.equal(response.visits?.length, 2);
    assert.equal(response.visits?.[0].firstSeen, next);
    assert.equal(response.visits?.[1].callsigns, 'VECTOR01 · VECTOR02');
    assert.equal(response.entries[0].lastSeen, next);
    assert.throws(() => store.record(snapshot(now), next));
    assert.equal(store.query(query(), next).updatedAt, next);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('logbook search is literal, pagination stable, date filters and retention bound results', () => {
  const store = new LogbookStore(':memory:', 30, now);
  try {
    store.record(snapshot(now, Array.from({ length: 40 }, (_, i) => ({ ...item, hex: i.toString(16).padStart(6, '0'), r: `PH-${i}` }))), now);
    assert.equal(store.query(query(), now).total, 40);
    assert.equal(store.query(query(), now).entries.length, 30);
    assert.equal(store.query(query('page=2'), now).entries.length, 10);
    assert.equal(store.query(query('page=999'), now).page, 2);
    for (const q of ['%', '_', "' OR 1=1 --"]) assert.equal(store.query(query(`q=${encodeURIComponent(q)}`), now).total, 0);
    assert.equal(store.query(query('q=ph-1'), now).total, 11);
    const tomorrow = now + 86400_000 * 2;
    store.record(snapshot(tomorrow, [{ ...item, hex: '000001' }]), tomorrow);
    assert.equal(store.query(query('days=1'), tomorrow).total, 1);
    assert.equal(store.query(query('sort=visits'), tomorrow).entries[0].hex, '000001');
    const expired = now + 86400_000 * 31;
    store.record(snapshot(expired, []), expired);
    assert.equal(store.query(query(), expired).total, 1);
    assert.equal(store.query(query(), expired).entries[0].visits, 1);
    assert.equal(store.query(query(), expired).retentionDays, 30);
    assert.equal(store.query(query(), expired).days, 30);
  } finally { store.close(); }
});

test('logbook rejects unbounded or injected queries and invalid configuration', () => {
  for (const params of ['url=https://example.com', 'page=-1', 'page=1.5', 'page=10001', 'days=365', 'sort=lastSeen;DROP', 'hex=../a', 'q=a&q=b', `q=${'x'.repeat(81)}`]) assert.throws(() => query(params));
  assert.throws(() => logbookSettings({ VECTOR_LOGBOOK_STORE: 'relative.sqlite' }));
  assert.throws(() => logbookSettings({ VECTOR_LOGBOOK_DAYS: '0' }));
  assert.throws(() => logbookSettings({ VECTOR_LOGBOOK_DAYS: '366' }));
  assert.equal(logbookSettings({ VECTOR_LOGBOOK_ENABLED: 'false' }).enabled, false);
});
