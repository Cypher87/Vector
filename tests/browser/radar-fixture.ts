import { test as base, expect, type Page } from '@playwright/test';

export async function openFilterGroup(page: Page, group: 'categories' | 'flight' | 'distance' | 'advanced' | 'presets') {
  const details = page.locator(`.filter-group[data-filter-group="${group}"]`);
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
}

/** Synthetic readsb replay, using the same 16-byte record format as the receiver. */
function replayFile(path: string) {
  const match = path.match(/^(\d{4})\/(\d{2})\/(\d{2})\/heatmap\/(\d{2})\.bin\.ttf$/);
  if (!match) throw new Error(`Unexpected replay path: ${path}`);
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + Number(match[4]) * 1_800_000;
  const buffer = Buffer.alloc(60 * 64);
  for (let slice = 0; slice < 60; slice++) {
    const offset = slice * 64;
    const timestamp = start + slice * 30_000;
    buffer.writeUInt32LE(0x0e7f7c9d, offset);
    buffer.writeUInt32LE(Math.floor(timestamp / 2 ** 32), offset + 4);
    buffer.writeUInt32LE(timestamp % 2 ** 32, offset + 8);
    buffer.writeUInt32LE(0xabc123, offset + 16);
    buffer.writeUInt32LE(0x40000000, offset + 20);
    buffer.write('VECTOR01', offset + 24, 'ascii');
    for (const [record, hex, latitude, longitude, altitude] of [
      [32, 0xabc123, 52.30, 4.80 + slice * 0.005, 20_000],
      [48, 0xdef456, 52.45, 4.65 + slice * 0.001, 2_000],
    ]) {
      buffer.writeUInt32LE(hex, offset + record);
      buffer.writeInt32LE(Math.round(latitude * 1e6), offset + record + 4);
      buffer.writeInt32LE(Math.round(longitude * 1e6), offset + record + 8);
      buffer.writeInt32LE((2_000 << 16) | (altitude / 25), offset + record + 12);
    }
  }
  return buffer;
}

export class RadarFixture {
  configFailures = 0;
  receiverFailures = 0;
  receiverPositionKnown = true;
  aircraftUnavailable = false;
  timestamp: number | undefined;
  longitudeOffset = 0;
  aircraftRequests = 0;
  replayRequests: string[] = [];
  traceRequests: string[] = [];
  traceUnavailable = false;
  traceSpeed: number | null = 200;
  extraAircraft: Record<string, unknown>[] = [];
  private started = Date.now();

  async install(page: Page) {
    await page.addInitScript(() => {
      localStorage.setItem('vector.language', 'en');
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
      // Browser tests never depend on, or send requests to, a real Pi or external provider.
      if (url.origin !== 'http://127.0.0.1:3100') return route.fulfill({ json: {} });
      if (url.pathname === '/api/config') {
        if (this.configFailures-- > 0) return json({}, 503);
        return json({
          dataBaseUrl: '/api/readsb?source=live', historyBaseUrl: '/api/readsb?source=history',
          mapStyleUrl: '/map-style.json', siteName: 'Vector test', receiverName: 'Test receiver',
          unitSystem: 'metric', ...(this.receiverPositionKnown ? { receiverLatitude: 52.3, receiverLongitude: 4.8 } : {}),
        });
      }
      if (url.pathname === '/api/sync/session') return json({ connected: false, preferences: {} });
      if (url.pathname === '/api/aircraft-database-status') return json({ state: 'ready', location: 'local', updatedAt: Date.now() - 3600_000, records: 623176 });
      if (url.pathname === '/api/aircraft-metadata') return json({ aircraft: {
        abc123: { aircraftType: 'A320', registration: 'TEST-1', category: 'A3' },
        def456: { aircraftType: 'BALL', registration: 'TEST-2', category: 'B2' },
      } });
      if (url.pathname === '/api/readsb') {
        const path = url.searchParams.get('path') ?? '';
        if (path === 'receiver.json') {
          if (this.receiverFailures-- > 0) return json({}, 503);
          return json({ refresh: 1_000, haveReplay: true, ...(this.receiverPositionKnown ? { lat: 52.3, lon: 4.8 } : {}) });
        }
        if (path === 'aircraft.json') {
          this.aircraftRequests++;
          if (this.aircraftUnavailable) return json({}, 503);
          const seconds = (Date.now() - this.started) / 1_000;
          return json({ now: this.timestamp ?? Date.now() / 1_000, messages: this.aircraftRequests * 100, aircraft: [
            { hex: 'abc123', flight: 'VECTOR01', r: 'TEST-1', t: 'A320', category: 'A3', type: 'adsb_icao', lat: 52.30, lon: 4.80 + seconds * 0.0015 + this.longitudeOffset, alt_baro: 20_000, gs: 200, track: 90, seen: 0, seen_pos: 0, messages: this.aircraftRequests * 50 },
            { hex: 'def456', flight: 'BALLOON', r: 'TEST-2', t: 'BALL', category: 'B2', type: 'adsb_icao', lat: 52.45, lon: 4.65, alt_baro: 2_000, gs: 10, track: 45, seen: 0, messages: this.aircraftRequests * 30 },
            ...this.extraAircraft,
          ] });
        }
        if (path.startsWith('traces/')) {
          this.traceRequests.push(path);
          if (this.traceUnavailable) return json({}, 404);
          const balloon = path.includes('def456');
          const altitude = balloon ? 2000 : 20000;
          return json({ icao: balloon ? 'def456' : 'abc123', timestamp: Date.now() / 1_000 - 120,
            trace: [[-3600, 52.2, 4.6, altitude, this.traceSpeed, 90, 0], [0, 52.27, 4.70, altitude - 1000, this.traceSpeed, 90, 0], [60, 52.28, 4.75, altitude, this.traceSpeed, 90, 0], [120, 52.3, 4.80, altitude, this.traceSpeed, 90, 0]],
          });
        }
        if (path.endsWith('.bin.ttf')) {
          this.replayRequests.push(path);
          return route.fulfill({ contentType: 'application/octet-stream', body: replayFile(path) });
        }
        throw new Error(`Unmocked readsb resource: ${path}`);
      }
      if (url.pathname === '/map-style.json') return json({ version: 8, sources: {
        tiles: { type: 'raster', tiles: ['http://127.0.0.1:3100/test-tile.png'], tileSize: 256 },
      }, layers: [{ id: 'openstreetmap', type: 'raster', source: 'tiles' }] });
      if (url.pathname === '/test-tile.png') return route.fulfill({ contentType: 'image/png', body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64',
      ) });
      if (url.pathname.startsWith('/api/')) throw new Error(`Unmocked API: ${url.pathname}`);
      return route.continue();
    });
  }
}

export const test = base.extend<{ radar: RadarFixture }>({
  radar: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat|Minified React error/i.test(message.text())) errors.push(message.text());
    });
    const radar = new RadarFixture();
    await radar.install(page);
    await use(radar);
    expect(errors, 'No unhandled browser errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
