import { DatabaseSync } from 'node:sqlite';
import type { HeatmapChunk } from './heatmap-chunk.ts';

const maximumCacheBytes = 128 * 1024 * 1024;
// v2 stores connected measured segments, not the old isolated position dots.
const magic = 0x56484d02;

/** Disposable local cache: never create or change anything in the readsb/NFS archive. */
export class HeatmapCache {
  private db: DatabaseSync;
  private readonly maximumBytes: number;
  constructor(path: string, maximumBytes = maximumCacheBytes) {
    this.maximumBytes = maximumBytes;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS chunks (source TEXT NOT NULL, stamp INTEGER NOT NULL, updated INTEGER NOT NULL,
        body BLOB NOT NULL, PRIMARY KEY(source, stamp));`);
  }
  get(source: string, stamp: number, now: number): HeatmapChunk | undefined {
    const row = this.db.prepare('SELECT body, updated FROM chunks WHERE source=? AND stamp=? AND length(body) <= 1200016').get(source, stamp);
    if (!row || stamp >= now - 3600 && Number(row.updated) < now - 60) return;
    const bytes = row.body;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength % 4) return;
    const data = new Uint32Array(bytes.slice().buffer);
    if (data[0] !== magic || data[1] > 16 || (data.length - 4) % 3) return;
    for (let index = 4; index < data.length; index += 3) {
      if (data[index] >= 30 || data[index + 1] >= 2 ** (2 * data[1]) || !data[index + 2]) return;
    }
    return { zoom: data[1], first: data[2] || null, last: data[3] || null, bins: data.slice(4) };
  }
  put(source: string, stamp: number, chunk: HeatmapChunk, now: number) {
    const data = new Uint32Array(chunk.bins.length + 4);
    data.set([magic, chunk.zoom, chunk.first ?? 0, chunk.last ?? 0]); data.set(chunk.bins, 4);
    this.db.prepare('INSERT OR REPLACE INTO chunks VALUES (?, ?, ?, ?)').run(source, stamp, now, new Uint8Array(data.buffer));
    this.db.prepare('DELETE FROM chunks WHERE stamp < ?').run(now - 8 * 86400);
    this.db.exec('DELETE FROM chunks WHERE rowid IN (SELECT rowid FROM chunks ORDER BY stamp DESC, updated DESC LIMIT -1 OFFSET 512)');
    let bytes = Number(this.db.prepare('SELECT COALESCE(SUM(length(body)),0) AS bytes FROM chunks').get()!.bytes);
    for (const row of this.db.prepare('SELECT source, stamp, length(body) AS bytes FROM chunks ORDER BY stamp ASC, updated ASC').all()) {
      if (bytes <= this.maximumBytes) break;
      this.db.prepare('DELETE FROM chunks WHERE source=? AND stamp=?').run(row.source!, row.stamp!); bytes -= Number(row.bytes);
    }
  }
  close() { this.db.close(); }
}
