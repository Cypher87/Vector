import { DatabaseSync } from 'node:sqlite';
import { logbookPageSize, logbookVisitGapMs, parseLogbookSnapshot, type LogbookEntry, type LogbookQuery, type LogbookResponse, type LogbookVisit } from '../domain/logbook.ts';

export const maximumLogbookVisits = 100_000;

/** One batched transaction per poll; WAL keeps logbook searches separate from writes. */
export class LogbookStore {
  private readonly db: DatabaseSync;
  private cleanupAt = 0;
  readonly retentionDays: number;

  constructor(path: string, retentionDays = 90, now = Date.now()) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('Invalid logbook retention');
    this.retentionDays = retentionDays;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS aircraft (hex TEXT PRIMARY KEY, registration TEXT NOT NULL,
        aircraftType TEXT NOT NULL, description TEXT NOT NULL, callsign TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, hex TEXT NOT NULL,
        firstSeen INTEGER NOT NULL, lastSeen INTEGER NOT NULL, callsigns TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS visits_aircraft ON visits(hex, lastSeen DESC);
      CREATE INDEX IF NOT EXISTS visits_recent ON visits(lastSeen DESC);
    `);
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('startedAt', now);
  }

  close() { this.db.close(); }

  record(snapshot: unknown, now = Date.now()) {
    const { stamp, observations } = parseLogbookSnapshot(snapshot, now);
    const lastStamp = this.db.prepare("SELECT value FROM metadata WHERE key='updatedAt'").get()?.value;
    if (typeof lastStamp === 'number' && stamp <= lastStamp) return;
    const latest = this.db.prepare('SELECT id, lastSeen, callsigns FROM visits WHERE hex=? ORDER BY lastSeen DESC, id DESC LIMIT 1');
    const aircraft = this.db.prepare(`INSERT INTO aircraft VALUES (?, ?, ?, ?, ?) ON CONFLICT(hex) DO UPDATE SET
      registration=COALESCE(NULLIF(excluded.registration, ''), registration),
      aircraftType=COALESCE(NULLIF(excluded.aircraftType, ''), aircraftType),
      description=COALESCE(NULLIF(excluded.description, ''), description),
      callsign=COALESCE(NULLIF(excluded.callsign, ''), callsign)`);
    const insert = this.db.prepare('INSERT INTO visits(hex, firstSeen, lastSeen, callsigns) VALUES (?, ?, ?, ?)');
    const update = this.db.prepare('UPDATE visits SET lastSeen=?, callsigns=? WHERE id=?');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of observations) {
        const previous = latest.get(item.hex);
        if (previous && item.at <= Number(previous.lastSeen)) continue;
        aircraft.run(item.hex, item.registration, item.aircraftType, item.description, item.callsign);
        if (!previous || item.at - Number(previous.lastSeen) >= logbookVisitGapMs) {
          insert.run(item.hex, item.at, item.at, item.callsign);
        } else {
          const callsigns = [...new Set([...String(previous.callsigns).split(' · '), item.callsign].filter(Boolean))].slice(-12).join(' · ');
          update.run(item.at, callsigns, previous.id);
        }
      }
      this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)').run('updatedAt', stamp);
      this.prune(now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private prune(now: number) {
    if (now < this.cleanupAt + 3600_000) return;
    this.db.prepare('DELETE FROM visits WHERE lastSeen < ?').run(now - this.retentionDays * 86400_000);
    this.db.prepare('DELETE FROM visits WHERE id IN (SELECT id FROM visits ORDER BY lastSeen DESC, id DESC LIMIT -1 OFFSET ?)').run(maximumLogbookVisits);
    this.db.exec('DELETE FROM aircraft WHERE hex NOT IN (SELECT hex FROM visits)');
    this.cleanupAt = now;
  }

  query(query: LogbookQuery, now = Date.now()): LogbookResponse {
    const days = Math.min(query.days, this.retentionDays);
    const since = now - days * 86400_000;
    const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
    const where = `v.lastSeen >= ? AND (? = '' OR a.hex = ?) AND
      (? = '' OR a.hex LIKE ? ESCAPE '\\' OR a.registration LIKE ? ESCAPE '\\'
        OR a.aircraftType LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM visits s WHERE s.hex=a.hex AND s.lastSeen >= ? AND s.callsigns LIKE ? ESCAPE '\\'))
      ${query.favorites === undefined ? '' : "AND (a.hex IN (SELECT value FROM json_each(?)) OR upper(replace(a.callsign, ' ', '')) IN (SELECT value FROM json_each(?)))"}`;
    const args = [since, query.hex || '', query.hex || '', query.search, pattern, pattern, pattern, pattern, since, pattern];
    if (query.favorites !== undefined) args.push(JSON.stringify(query.favorites), JSON.stringify(query.favoriteCallsigns ?? []));
    const total = Number(this.db.prepare(`SELECT COUNT(DISTINCT a.hex) AS total FROM aircraft a JOIN visits v ON v.hex=a.hex WHERE ${where}`).get(...args)!.total);
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / logbookPageSize)));
    const entries = this.db.prepare(`SELECT a.*, MIN(v.firstSeen) AS firstSeen, MAX(v.lastSeen) AS lastSeen, COUNT(*) AS visits
      FROM aircraft a JOIN visits v ON v.hex=a.hex WHERE ${where} GROUP BY a.hex
      ORDER BY ${query.sort === 'visits' ? 'visits DESC,' : ''} lastSeen DESC, a.hex ASC LIMIT ? OFFSET ?`)
      .all(...args, logbookPageSize, (page - 1) * logbookPageSize) as LogbookEntry[];
    const metadata = Object.fromEntries(this.db.prepare('SELECT key, value FROM metadata').all().map((row) => [row.key, row.value]));
    return { entries, total, page, pageSize: logbookPageSize, days, retentionDays: this.retentionDays,
      startedAt: Number(metadata.startedAt), updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : null,
      ...(query.hex ? { visits: entries.length ? this.db.prepare('SELECT firstSeen, lastSeen, callsigns FROM visits WHERE hex=? AND lastSeen >= ? ORDER BY lastSeen DESC, id DESC LIMIT 50').all(query.hex, since) as LogbookVisit[] : [] } : {}) };
  }
}
