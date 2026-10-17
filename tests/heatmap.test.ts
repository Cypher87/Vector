import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { coarsenHeatmap, heatmapCell, heatmapCellCoordinate, heatmapChunkPath, heatmapGridZoom, parseHeatmapPeriod, parseHeatmapResponse, type HeatmapResponse } from '../src/domain/heatmap.ts';
import { summarizeHeatmapChunk, type HeatmapChunk } from '../src/server/heatmap-chunk.ts';
import { HeatmapCache } from '../src/server/heatmap-cache.ts';
import { createHeatmapService, heatmapCacheFile } from '../src/server/heatmap-service.ts';
import { ResourceError } from '../src/server/bounded-resource.ts';
import { applySyncPreferencePatch, createSyncPreferencePatch, normalizeSyncPreferences } from '../src/sync/preferences.ts';
import { createTrafficHeatmap, heatmapKernelScale, heatmapDensityProfile } from '../src/map/traffic-heatmap.ts';
import { GET } from '../app/api/heatmap/route.ts';

const now = Date.UTC(2026, 9, 16, 12, 15) / 1000;
function recording(stamp: number, positions = [[52.3, 4.8], [52.3, 4.8], [53, 6]]) {
  const body = Buffer.alloc(16 * (positions.length + 1));
  body.writeUInt32LE(0x0e7f7c9d); body.writeUInt32LE(Math.floor(stamp * 1000 / 2 ** 32), 4); body.writeUInt32LE(stamp * 1000 % 2 ** 32, 8);
  positions.forEach(([lat, lon], i) => { const offset = (i + 1) * 16; body.writeUInt32LE(i + 1, offset); body.writeInt32LE(Math.round(lat * 1e6), offset + 4); body.writeInt32LE(Math.round(lon * 1e6), offset + 8); });
  return body;
}
const chunkStart = Math.floor(now / 1800) * 1800;
async function complete(service: ReturnType<typeof createHeatmapService>, period: Parameters<typeof service.request>[0]) {
  let response: HeatmapResponse = service.request(period);
  for (let i = 0; i < 300 && response.status === 'loading'; i++) { await setTimeout(2); response = service.request(period); }
  assert.notEqual(response.status, 'loading');
  return response;
}

test('heatmap periods, UTC paths and responses reject unbounded or invalid inputs', async () => {
  assert.equal(parseHeatmapPeriod('4h'), '4h'); assert.equal(parseHeatmapPeriod('999d'), '24h');
  assert.equal(heatmapChunkPath(Date.UTC(2026, 9, 16, 23, 45) / 1000), '2026/10/16/heatmap/47.bin.ttf');
  for (const query of ['', 'period=999d', 'period=24h&period=1h', 'period=24h&path=../x', 'url=https://example.com']) {
    const response = await GET(new Request(`http://localhost/api/heatmap?${query}`)); assert.equal(response.status, 400);
  }
  for (const value of [null, {}, { status: 'loading', loaded: 1, total: 10000 }, { status: 'ready', loaded: 1, total: 1, data: { from: now, to: now - 1 } }]) assert.throws(() => parseHeatmapResponse(value));
  assert.equal(parseHeatmapResponse({ status: 'loading', loaded: 2, total: 49 }).status, 'loading');
  assert.throws(() => heatmapCacheFile({ VECTOR_HEATMAP_CACHE: 'relative.sqlite' }));
  assert.equal(heatmapCacheFile({ VECTOR_SYNC_STORE: join(tmpdir(), 'vector', 'sync.json') }), join(tmpdir(), 'vector', 'heatmap-cache.sqlite'));
});

test('one-hour sparse traffic uses the full relative density range, independent of absolute observation counts', () => {
  const data = { from: now - 3600, to: now, first: now - 60, last: now - 60, gridZoom: 16, partial: false,
    points: [[4.8, 52.3, 3]] as [number, number, number][] };
  const sparse = heatmapDensityProfile(data);
  const intensityAt = (profile: typeof sparse, zoom: number) => Number(profile.intensity[4 + zoom * 2]);
  for (const zoom of [6, 8, 10, 12]) {
    assert.ok(Math.abs(.3989422804014327 * intensityAt(sparse, zoom) - .85) < .00001);
  }
  assert.ok(intensityAt(sparse, 8) > heatmapKernelScale(16, 8).intensity * 10);
  const longer = heatmapDensityProfile({ ...data, from: now - 86400,
    points: data.points.map(([lon, lat, count]) => [lon, lat, count * 24]) });
  assert.deepEqual(longer, sparse);
  const cell = heatmapCell(4.8, 52.3);
  const dense = heatmapDensityProfile({ ...data, points: Array.from({ length: 400 }, (_, index) =>
    [...heatmapCellCoordinate(cell + index % 20 + Math.floor(index / 20) * 2 ** 16, 16), 3]) });
  assert.ok(intensityAt(dense, 8) < intensityAt(sparse, 8) / 10);
  assert.equal(dense.weights.length, 400);
  const empty = heatmapDensityProfile({ ...data, points: [] });
  assert.deepEqual(empty.weights, []);
  for (const profile of [sparse, dense, empty]) for (let zoom = 0; zoom <= 22; zoom++) {
    assert.ok(Number.isFinite(intensityAt(profile, zoom)) && intensityAt(profile, zoom) > 0 && intensityAt(profile, zoom) <= 8);
  }
});

test('recording summaries count measured positions, not identities, repeated aircraft or invalid coordinates', async () => {
  const body = recording(chunkStart + 300, [[52.3, 4.8], [52.3, 4.8], [91, 4], [53, 6]]);
  body.writeUInt32LE(1, 32); // duplicate aircraft in the same slice
  const identity = Buffer.alloc(16); identity.writeUInt32LE(5); identity.writeUInt32LE(0x40000000, 4);
  const input = Buffer.concat([Buffer.alloc(3), body, identity]).subarray(3); // unaligned Node Buffer offset
  const summary = await summarizeHeatmapChunk(input, chunkStart);
  assert.equal(summary.zoom, heatmapGridZoom); assert.equal(summary.first, chunkStart + 300);
  assert.equal(summary.bins.length, 6); assert.equal(summary.bins[0], 5);
  assert.equal(summary.bins[2] + summary.bins[5], 2);
  assert.equal((await summarizeHeatmapChunk(recording(chunkStart - 1), chunkStart).catch(() => null)), null);
  await assert.rejects(summarizeHeatmapChunk(new Uint8Array(17), chunkStart));
  await assert.rejects(summarizeHeatmapChunk(body, chunkStart, AbortSignal.abort()));
});

test('heatmap joins consecutive positions of the same aircraft into a narrow continuous corridor', async () => {
  const summary = await summarizeHeatmapChunk(Buffer.concat([
    recording(chunkStart + 300, [[52.3, 4.8]]), recording(chunkStart + 330, [[52.3, 4.9]]),
  ]), chunkStart);
  const cells = new Set(Array.from({ length: summary.bins.length / 3 }, (_, i) => summary.bins[i * 3 + 1]));
  const start = heatmapCell(4.8, 52.3), end = heatmapCell(4.9, 52.3);
  assert.ok(cells.size > 10);
  for (let cell = start; cell <= end; cell++) assert.ok(cells.has(cell));
  assert.ok(summary.bins.every((value, index) => index % 3 !== 0 || value === 5));
  const acrossMinute = await summarizeHeatmapChunk(Buffer.concat([
    recording(chunkStart + 350, [[52.3, 4.8]]), recording(chunkStart + 380, [[52.3, 4.9]]),
  ]), chunkStart);
  assert.ok(acrossMinute.bins.some((value, index) => index % 3 === 0 && value === 5));
  assert.ok(acrossMinute.bins.some((value, index) => index % 3 === 0 && value === 6));
});

test('heatmap never invents connections between aircraft, across reception gaps, or through position jumps', async () => {
  for (const [seconds, longitude, differentId] of [[90, 4.9, false], [30, 10, false], [30, 4.9, true]] as const) {
    const next = recording(chunkStart + 300 + seconds, [[52.3, longitude]]);
    if (differentId) next.writeUInt32LE(2, 16);
    const summary = await summarizeHeatmapChunk(Buffer.concat([recording(chunkStart + 300, [[52.3, 4.8]]), next]), chunkStart);
    assert.equal(summary.bins.length, 6);
    assert.equal(summary.bins[2] + summary.bins[5], 2);
  }
});

test('spatial coarsening preserves all observations rather than dropping less busy cells', () => {
  const cells = new Map([[heatmapCell(4.8, 52.3), 12], [heatmapCell(4.81, 52.301), 2], [heatmapCell(6, 53), 4]]);
  const next = coarsenHeatmap(cells, 16);
  assert.equal([...next.values()].reduce((a, b) => a + b, 0), 18);
  const [lon, lat] = heatmapCellCoordinate(heatmapCell(4.8, 52.3), 16);
  assert.ok(Math.abs(lon - 4.8) < .006 && Math.abs(lat - 52.3) < .006);
});

test('heatmap cache survives restart, refreshes recent chunks, stays bounded and isolates receiver sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vector-heatmap-')), file = join(dir, 'cache.sqlite');
  let cache = new HeatmapCache(file, 1000);
  const summary: HeatmapChunk = { zoom: 16, first: chunkStart, last: chunkStart, bins: new Uint32Array([0, heatmapCell(4.8, 52.3), 3]) };
  try {
    cache.put('pi', chunkStart - 7200, summary, now); cache.put('pi', chunkStart, summary, now);
    assert.equal(cache.get('other', chunkStart, now), undefined);
    assert.equal(cache.get('pi', chunkStart, now + 61), undefined);
    cache.close();
    const oldCache = new DatabaseSync(file);
    try {
      oldCache.prepare('INSERT INTO chunks VALUES (?, ?, ?, ?)').run('legacy', chunkStart - 10800, now,
        new Uint8Array(new Uint32Array([0x56484d01, 16, 0, 0]).buffer));
    } finally { oldCache.close(); }
    cache = new HeatmapCache(file, 1000);
    assert.equal(cache.get('legacy', chunkStart - 10800, now), undefined);
    assert.deepEqual(cache.get('pi', chunkStart - 7200, now)?.bins, summary.bins);
    for (let i = 0; i < 100; i++) cache.put('pi', chunkStart - i * 1800, summary, now + i);
    assert.equal(cache.get('pi', chunkStart, now + 100), undefined);
    assert.ok(cache.get('pi', chunkStart - 3 * 1800, now + 100));
    assert.equal(cache.get('pi', chunkStart - 99 * 1800, now + 100), undefined);
  } finally { cache.close(); await rm(dir, { recursive: true, force: true }); }
});

test('period jobs share sequential chunk reads and cache results, keeping exact minute boundaries and partial gaps', async () => {
  const cache = new HeatmapCache(':memory:'); const reads: string[] = []; let active = 0, maximum = 0;
  const service = createHeatmapService({ source: 'pi', cache, now: () => now, load: async (path) => {
    reads.push(path); active++; maximum = Math.max(maximum, active);
    await setTimeout(1); active--;
    const [year, month, day, , chunk] = path.split('/');
    const start = Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000 + Number(chunk.slice(0, 2)) * 1800;
    if (start === chunkStart - 1800) throw new ResourceError('Missing', 404);
    return recording(start + 600);
  } });
  try {
    service.request('4h'); service.request('1h');
    const short = await complete(service, '1h'), long = await complete(service, '4h');
    assert.equal(maximum, 1); assert.equal(new Set(reads).size, reads.length);
    assert.equal(short.status, 'ready'); assert.equal(long.status, 'ready');
    if (short.status !== 'ready' || long.status !== 'ready') return;
    assert.equal(short.data.from, now - 3600); assert.equal(short.data.to, now);
    assert.equal(short.data.partial, true);
    const total = (value: typeof short) => value.data.points.reduce((sum, point) => sum + point[2], 0);
    assert.ok(total(long) > total(short));
    assert.ok(short.data.first! >= short.data.from && short.data.last! < short.data.to);
    const before = reads.length; assert.deepEqual(service.request('1h'), short); assert.equal(reads.length, before);
    parseHeatmapResponse(short);
  } finally { service.dispose(); cache.close(); }
});

test('missing recordings are empty, unreadable recordings are errors, and a stalled NFS read never multiplies I/O', async () => {
  for (const status of [404, 403]) {
    const cache = new HeatmapCache(':memory:');
    const service = createHeatmapService({ source: 'pi', cache, now: () => now, load: async () => { throw new ResourceError('Private path', status); } });
    const result = await complete(service, '1h');
    assert.equal(result.status, status === 404 ? 'ready' : 'error');
    if (result.status === 'ready') assert.deepEqual(result.data.points, []);
    assert.equal(JSON.stringify(result).includes('Private path'), false);
    service.dispose(); cache.close();
  }
  const cache = new HeatmapCache(':memory:'); let reads = 0, time = now;
  const service = createHeatmapService({ source: 'nfs', cache, now: () => time, readTimeoutMs: 10,
    load: async () => { reads++; return new Promise<Uint8Array>(() => {}); } });
  try {
    assert.equal((await complete(service, '1h')).status, 'error');
    time += 60;
    assert.equal((await complete(service, '1h')).status, 'error');
    assert.equal(reads, 1);
  } finally { service.dispose(); cache.close(); }
});

test('heatmap visibility and period synchronize independently and invalid periods cannot erase a setting', () => {
  assert.deepEqual(normalizeSyncPreferences({ heatmap: false, heatmapPeriod: '7d' }), { heatmap: false, heatmapPeriod: '7d' });
  const patch = createSyncPreferencePatch({ heatmap: true, heatmapPeriod: '24h' }, { heatmap: true, heatmapPeriod: '4h' });
  assert.deepEqual(applySyncPreferencePatch({ heatmap: false, heatmapPeriod: '24h' }, patch), { heatmap: false, heatmapPeriod: '4h' });
  assert.equal(applySyncPreferencePatch({ heatmapPeriod: '1h' }, { settings: { heatmapPeriod: '999h' } }).heatmapPeriod, '1h');
});

test('the GPU density source updates only when data changes, with bounded relative weights and no DOM markers', () => {
  const calls: unknown[] = [], layers = new Set<string>(), sources = new Set<string>();
  const map = { getStyle: () => ({}), addSource: (id: string) => sources.add(id), addLayer: (value: { id: string; type: string }) => { layers.add(value.id); calls.push(value.type); },
    setLayoutProperty: (...args: unknown[]) => calls.push(args), setPaintProperty: (...args: unknown[]) => calls.push(args),
    getSource: () => ({ setData: (data: unknown) => calls.push(data) }), getLayer: (id: string) => layers.has(id),
    removeLayer: (id: string) => layers.delete(id), removeSource: (id: string) => sources.delete(id), once: (_: string, callback: () => void) => callback(), triggerRepaint: () => {} };
  const renderer = createTrafficHeatmap(map as never);
  renderer.update(undefined, false, 'dark'); assert.equal(sources.size, 0);
  const data = { from: now - 3600, to: now, first: now - 60, last: now - 60, gridZoom: 16, partial: false, points: [[4.8, 52.3, 1], [6, 53, 100]] as [number, number, number][] };
  renderer.update(data, true, 'dark'); assert.ok(calls.includes('heatmap'));
  const updates = () => calls.filter((value) => !!value && typeof value === 'object' && 'type' in value && value.type === 'FeatureCollection');
  assert.equal(updates().length, 1);
  renderer.update(data, true, 'light'); renderer.update(data, false, 'light'); assert.equal(updates().length, 1);
  renderer.dispose(); assert.equal(sources.size, 0); assert.equal(layers.size, 0);
});

test('the GPU kernel blends coarse recording cells and normalizes density without zoom-time source updates', () => {
  for (const gridZoom of [12, 14, 16]) {
    const coarse = heatmapKernelScale(gridZoom, gridZoom - 2);
    assert.equal(coarse.radius, 192);
    assert.ok(Math.abs(coarse.intensity - 4 / 3) < .00001);
    const overview = heatmapKernelScale(gridZoom, 6);
    assert.ok(overview.intensity < coarse.intensity);
    for (let zoom = 0; zoom <= 22; zoom++) {
      const kernel = heatmapKernelScale(gridZoom, zoom);
      assert.ok(kernel.radius > 0 && kernel.radius <= 768);
      assert.ok(kernel.intensity > 0 && kernel.intensity <= 4);
    }
  }
});

test('heatmap routes stay compact at overview zoom without exposing a dot grid in coarser periods', () => {
  for (let zoom = 6; zoom <= 10; zoom++) {
    const narrow = heatmapKernelScale(16, zoom);
    const previousRadius = Math.max(12 + zoom * 1.5, 512 * 2 ** (zoom - 16) * 2);
    assert.ok(narrow.radius <= previousRadius * .65);
    assert.ok(narrow.radius * 2 <= 33); // Comparable to the 32–46 px aircraft silhouettes.
  }
  for (const gridZoom of [12, 14, 16]) {
    const zoom = gridZoom - 2, spacing = 512 * 2 ** (zoom - gridZoom);
    assert.equal(heatmapKernelScale(gridZoom, zoom).radius / spacing, 1.5);
  }
});
