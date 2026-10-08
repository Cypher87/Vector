export const logbookVisitGapMs = 30 * 60_000;
export const logbookPageSize = 30;

export type LogbookObservation = {
  hex: string; at: number; callsign: string; registration: string; aircraftType: string; description: string;
};
export type LogbookEntry = Omit<LogbookObservation, 'at'> & {
  firstSeen: number; lastSeen: number; visits: number;
};
export type LogbookVisit = { firstSeen: number; lastSeen: number; callsigns: string };
export type LogbookQuery = { search: string; days: number; page: number; sort: 'recent' | 'visits'; hex?: string };
export type LogbookResponse = {
  entries: LogbookEntry[]; total: number; page: number; pageSize: number; days: number;
  retentionDays: number; startedAt: number; updatedAt: number | null;
  visits?: LogbookVisit[];
};

const cleanText = (value: unknown, maximum: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';

/** Only fresh receiver observations count; never turn a cached snapshot into a visit. */
export function parseLogbookSnapshot(value: unknown, now = Date.now()) {
  if (!value || typeof value !== 'object') throw new Error('Invalid snapshot');
  const snapshot = value as { now?: unknown; aircraft?: unknown };
  const stamp = typeof snapshot.now === 'number' ? snapshot.now * 1000 : NaN;
  if (!Number.isFinite(stamp) || stamp < now - 60_000 || stamp > now + 5000
    || !Array.isArray(snapshot.aircraft) || snapshot.aircraft.length > 20_000) throw new Error('Invalid or stale snapshot');
  const observations = new Map<string, LogbookObservation>();
  for (const raw of snapshot.aircraft) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    // Non-ICAO addresses are not stable aircraft identities.
    if (typeof item.hex !== 'string' || !/^[a-f0-9]{6}$/i.test(item.hex)
      || typeof item.seen !== 'number' || !Number.isFinite(item.seen) || item.seen < 0 || item.seen > 60) continue;
    const hex = item.hex.toLowerCase();
    const at = Math.min(now, Math.floor(stamp - item.seen * 1000));
    const previous = observations.get(hex);
    if (previous && previous.at >= at) continue;
    observations.set(hex, { hex, at, callsign: cleanText(item.flight, 24), registration: cleanText(item.r, 40),
      aircraftType: cleanText(item.t, 12), description: cleanText(item.desc, 180) });
  }
  return { stamp: Math.floor(stamp), observations: [...observations.values()] };
}

export function parseLogbookQuery(url: URL): LogbookQuery {
  const params = url.searchParams;
  if ([...params.keys()].some((key) => !['q', 'days', 'page', 'sort', 'hex'].includes(key))
    || [...params.keys()].some((key) => params.getAll(key).length > 1)) throw new Error('Invalid query');
  const search = (params.get('q') || '').trim();
  const days = Number(params.get('days') || 90);
  const page = Number(params.get('page') || 1);
  const sort = params.get('sort') || 'recent';
  const hex = params.get('hex')?.toLowerCase();
  if (search.length > 80 || ![1, 7, 30, 90].includes(days) || !Number.isInteger(page) || page < 1 || page > 10_000
    || !['recent', 'visits'].includes(sort) || (hex !== undefined && !/^[a-f0-9]{6}$/.test(hex))) throw new Error('Invalid query');
  return { search, days, page, sort: sort as LogbookQuery['sort'], hex };
}
