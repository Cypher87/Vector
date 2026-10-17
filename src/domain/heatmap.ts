export const heatmapPeriods = ['1h', '4h', '8h', '24h', '7d'] as const;
export type HeatmapPeriod = typeof heatmapPeriods[number];
export const defaultHeatmapPeriod: HeatmapPeriod = '24h';
export const heatmapPeriodHours: Record<HeatmapPeriod, number> = { '1h': 1, '4h': 4, '8h': 8, '24h': 24, '7d': 168 };
export const isHeatmapPeriod = (value: unknown): value is HeatmapPeriod => (heatmapPeriods as readonly unknown[]).includes(value);
export const parseHeatmapPeriod = (value: unknown): HeatmapPeriod => isHeatmapPeriod(value) ? value : defaultHeatmapPeriod;
export const heatmapChunkSeconds = 1800;
export const heatmapGridZoom = 16;
export const maximumHeatmapPoints = 50_000;
export type HeatmapPoint = [longitude: number, latitude: number, count: number];
export type HeatmapData = { from: number; to: number; first: number | null; last: number | null; gridZoom: number; partial: boolean; points: HeatmapPoint[] };
export type HeatmapResponse = { status: 'loading'; loaded: number; total: number }
  | { status: 'ready'; loaded: number; total: number; data: HeatmapData }
  | { status: 'error'; loaded: number; total: number };

export function heatmapChunkPath(stamp: number) {
  const date = new Date(stamp * 1000);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/heatmap/${String(date.getUTCHours() * 2 + Math.floor(date.getUTCMinutes() / 30)).padStart(2, '0')}.bin.ttf`;
}

export function heatmapCell(longitude: number, latitude: number, zoom = heatmapGridZoom) {
  const size = 2 ** zoom, sin = Math.sin(latitude * Math.PI / 180);
  const x = Math.min(size - 1, Math.max(0, Math.floor((longitude + 180) / 360 * size)));
  const y = Math.min(size - 1, Math.max(0, Math.floor((.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size)));
  return y * size + x;
}

export function heatmapCellCoordinate(cell: number, zoom: number): [number, number] {
  const size = 2 ** zoom, x = cell % size, y = Math.floor(cell / size);
  return [Number(((x + .5) / size * 360 - 180).toFixed(5)),
    Number((Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + .5) / size))) * 180 / Math.PI).toFixed(5))];
}

export function heatmapParentCell(cell: number, fromZoom: number, toZoom: number) {
  const size = 2 ** fromZoom, factor = 2 ** (fromZoom - toZoom);
  return Math.floor(Math.floor(cell / size) / factor) * 2 ** toZoom + Math.floor(cell % size / factor);
}

export function coarsenHeatmap(cells: ReadonlyMap<number, number>, zoom: number) {
  const result = new Map<number, number>();
  for (const [cell, count] of cells) {
    const parent = heatmapParentCell(cell, zoom, zoom - 1);
    result.set(parent, (result.get(parent) ?? 0) + count);
  }
  return result;
}

/** Validate API data before handing it to the map's GPU source. */
export function parseHeatmapResponse(value: unknown): HeatmapResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid heatmap response');
  const result = value as HeatmapResponse;
  if (!Number.isInteger(result.loaded) || !Number.isInteger(result.total) || result.total < 1 || result.total > 337
    || result.loaded < 0 || result.loaded > result.total) throw new Error('Invalid heatmap progress');
  if (result.status === 'loading' || result.status === 'error') return { status: result.status, loaded: result.loaded, total: result.total };
  if (result.status !== 'ready') throw new Error('Invalid heatmap status');
  const data = result.data;
  if (!data || !Number.isInteger(data.gridZoom) || data.gridZoom < 0 || data.gridZoom > heatmapGridZoom
    || !Number.isFinite(data.from) || !Number.isFinite(data.to) || data.from >= data.to || data.to - data.from > 7 * 86400
    || ![data.first, data.last].every((stamp) => stamp === null || Number.isFinite(stamp) && stamp >= data.from && stamp < data.to)
    || (data.first === null) !== (data.last === null) || data.first !== null && data.last! < data.first
    || typeof data.partial !== 'boolean' || !Array.isArray(data.points) || data.points.length > maximumHeatmapPoints
    || !data.points.every((point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
      && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85.052 && Number.isSafeInteger(point[2]) && point[2] > 0)) throw new Error('Invalid heatmap data');
  return result;
}
