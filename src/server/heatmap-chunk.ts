import { setImmediate } from 'node:timers/promises';
import { heatmapCell, heatmapGridZoom, heatmapParentCell } from '../domain/heatmap.ts';

export type HeatmapChunk = { zoom: number; first: number | null; last: number | null; bins: Uint32Array };
const maximumChunkCells = 100_000;
const cellStride = 2 ** 32;
const maximumConnectionGap = 60;
type Position = { longitude: number; latitude: number; time: number };

function canConnect(from: Position, to: Position) {
  const seconds = to.time - from.time;
  if (seconds <= 0 || seconds > maximumConnectionGap || Math.abs(to.longitude - from.longitude) > 180) return false;
  const latitude = (to.latitude - from.latitude) * Math.PI / 180;
  const longitude = (to.longitude - from.longitude) * Math.PI / 180;
  const haversine = Math.sin(latitude / 2) ** 2
    + Math.cos(from.latitude * Math.PI / 180) * Math.cos(to.latitude * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  const metres = 12_742_000 * Math.asin(Math.min(1, Math.sqrt(haversine)));
  return metres <= seconds * 400 + 1000;
}

/** Read just positions, not hundreds of thousands of aircraft/metadata objects. */
export async function summarizeHeatmapChunk(body: Uint8Array, stamp: number, signal?: AbortSignal): Promise<HeatmapChunk> {
  if (!body.length || body.length % 16 || body.length > 32 * 1024 * 1024) throw new Error('Invalid recording');
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let cells = new Map<number, number>(), zoom = heatmapGridZoom;
  let time: number | undefined, first: number | null = null, last: number | null = null, headers = 0;
  const seen = new Set<number>();
  const previousPositions = new Map<number, Position>();
  for (let offset = 0; offset < body.length; offset += 16) {
    if (offset % (16 * 8192) === 0) { signal?.throwIfAborted(); await setImmediate(); }
    if (view.getUint32(offset, true) === 0x0e7f7c9d) {
      const value = (view.getUint32(offset + 4, true) * 2 ** 32 + view.getUint32(offset + 8, true)) / 1000;
      time = Number.isFinite(value) && value >= stamp && value < stamp + 1800 ? value : undefined;
      if (time !== undefined) headers++;
      for (const [id, previous] of previousPositions) {
        if (time === undefined || previous.time >= time || time - previous.time > maximumConnectionGap) previousPositions.delete(id);
      }
      seen.clear();
      continue;
    }
    if (time === undefined) continue;
    const latRaw = view.getInt32(offset + 4, true);
    if (latRaw >= 0x40000000) continue; // Callsign/squawk record, not a position.
    const id = view.getUint32(offset, true) & 0x01ffffff;
    const lat = latRaw / 1e6, lon = view.getInt32(offset + 8, true) / 1e6;
    if (seen.has(id) || Math.abs(lat) > 85.051128 || Math.abs(lon) > 180) continue;
    seen.add(id);
    const position = { longitude: lon, latitude: lat, time }, previous = previousPositions.get(id);
    if (!previousPositions.has(id) && previousPositions.size >= 20_000) previousPositions.delete(previousPositions.keys().next().value!);
    previousPositions.set(id, position);
    const keyAt = (longitude: number, latitude: number, timestamp: number) =>
      Math.floor((timestamp - stamp) / 60) * cellStride + heatmapCell(longitude, latitude, zoom);
    const add = (key: number) => cells.set(key, (cells.get(key) ?? 0) + 1);
    const end = heatmapCell(lon, lat, zoom);
    if (previous && canConnect(previous, position)) {
      const start = heatmapCell(previous.longitude, previous.latitude, zoom), size = 2 ** zoom;
      const steps = Math.min(128, Math.ceil(Math.max(Math.abs(end % size - start % size), Math.abs(Math.floor(end / size) - Math.floor(start / size))) * 2));
      if (steps) {
        // Cover the measured segment rather than drawing isolated 30-second
        // samples. Never join different aircraft or bridge missing recordings.
        const visited = new Set([keyAt(previous.longitude, previous.latitude, previous.time)]);
        for (let step = 1; step <= steps; step++) {
          const fraction = step / steps;
          const key = keyAt(previous.longitude + (lon - previous.longitude) * fraction,
            previous.latitude + (lat - previous.latitude) * fraction, previous.time + (time - previous.time) * fraction);
          if (!visited.has(key)) { visited.add(key); add(key); }
        }
      } else add(keyAt(lon, lat, time));
    } else add(keyAt(lon, lat, time));
    first = Math.min(first ?? time, time); last = Math.max(last ?? time, time);
    if (cells.size > maximumChunkCells) {
      const smaller = new Map<number, number>();
      for (const [key, count] of cells) {
        const minute = Math.floor(key / cellStride), parent = heatmapParentCell(key % cellStride, zoom, zoom - 1);
        const next = minute * cellStride + parent;
        smaller.set(next, (smaller.get(next) ?? 0) + count);
      }
      cells = smaller; zoom--;
    }
  }
  signal?.throwIfAborted();
  if (!headers) throw new Error('No matching recording slices');
  const bins = new Uint32Array(cells.size * 3);
  let index = 0;
  for (const [key, count] of cells) { bins[index++] = Math.floor(key / cellStride); bins[index++] = key % cellStride; bins[index++] = count; }
  return { zoom, first, last, bins };
}
