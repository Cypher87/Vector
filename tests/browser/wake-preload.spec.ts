import { test, expect } from './radar-fixture';

const recentPath = 'traces/01/trace_recent_ff2001.json';

test.beforeEach(async ({ page, radar }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('vector.aircraftMotion', 'false'));
  const now = Date.now() / 1_000;
  await page.clock.setFixedTime(new Date(now * 1_000));
  radar.timestamp = now;
  radar.extraAircraft = [
    { hex: 'ff2001', flight: 'PRELOADED', lat: 52.3, lon: 4.8, t: 'A320', desc: 'L2J', category: 'A3' },
    { hex: 'ff2002', flight: 'OFFSCREEN', lat: 20, lon: 20, t: 'A320', desc: 'L2J', category: 'A3' },
    { hex: 'ff2003', flight: 'GLIDER', lat: 52.4, lon: 4.9, t: 'GLID', category: 'B1' },
  ].map((item) => ({ ...item, type: 'adsb_icao', alt_baro: 32000, gs: 420, track: 90, seen: 0, seen_pos: 0, messages: 100 }));
  radar.traceResponses.set(recentPath, { timestamp: now, trace: [
    [-140, 52.2, 4.4, 32000, 420, 90, 0], [-80, 52.2, 4.7, 32000, 420, 90, 0],
    [-30, 52.3, 4.7, 32000, 420, 90, 0], [-20, 52.3, 4.75, 32000, 420, 90, 0],
  ] });
});

test('visible aircraft have curved measured trails immediately, including after reload', async ({ page, radar }, testInfo) => {
  await page.goto('/');
  const wake = page.getByRole('button', { name: /^PRELOADED,/ }).locator('.aircraft-speed-wake');
  const path = wake.locator('.aircraft-speed-wake-base').first();
  // The live position and time are fixed: this route can only come from the receiver.
  await expect(wake).toHaveAttribute('data-route', 'measured');
  await expect(path).toHaveAttribute('d', /Q/);
  const geometry = await path.getAttribute('d');
  expect(radar.traceRequests.filter((path) => path === recentPath)).toHaveLength(1);
  expect(radar.traceRequests.every((path) => path.includes('trace_recent_'))).toBe(true);
  expect(radar.traceRequests.some((path) => /ff200[23]|def456/.test(path))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('preloaded-wake.png') });
  await page.reload();
  await expect(wake).toHaveAttribute('data-route', 'measured');
  await expect(path).toHaveAttribute('d', geometry!);
  expect(radar.traceRequests.filter((path) => path === recentPath)).toHaveLength(2);
  radar.timestamp! += 4;
  await page.clock.setFixedTime(new Date(radar.timestamp! * 1_000));
  radar.extraAircraft[0].lon = 4.81;
  await expect(path).not.toHaveAttribute('d', geometry!);
  await expect(path).toHaveAttribute('d', /Q/);
  await expect(wake).toHaveAttribute('data-route', 'measured');
  expect(radar.traceRequests.filter((path) => path === recentPath)).toHaveLength(2);
});

test('disabled trails do not preload; enabling loads and toggling reuses the cache', async ({ page, radar }) => {
  await page.addInitScript(() => localStorage.setItem('vector.aircraftWakes', 'false'));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(5);
  const nextFeed = radar.aircraftRequests + 2;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  expect(radar.traceRequests).toEqual([]);
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Show aircraft trails', exact: true }).click();
  const wake = page.getByRole('button', { name: /^PRELOADED,/ }).locator('.aircraft-speed-wake');
  await expect(wake).toHaveAttribute('data-route', 'measured');
  const requests = [...radar.traceRequests];
  await page.getByRole('button', { name: 'Hide aircraft trails', exact: true }).click();
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-wake-enabled', 'false');
  await page.getByRole('button', { name: 'Show aircraft trails', exact: true }).click();
  await expect(wake).toHaveCSS('opacity', '1');
  await expect(wake).toHaveAttribute('data-route', 'measured');
  expect(radar.traceRequests).toEqual(requests);
});

test('missing receiver traces leave a clean local fallback without polling every feed', async ({ page, radar }) => {
  radar.traceUnavailable = true;
  await page.goto('/');
  const wake = page.getByRole('button', { name: /^PRELOADED,/ }).locator('.aircraft-speed-wake');
  await expect(wake).toHaveAttribute('data-route', 'pending');
  await expect.poll(() => radar.traceRequests.includes(recentPath)).toBe(true);
  const nextFeed = radar.aircraftRequests + 3;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  expect(radar.traceRequests.filter((path) => path === recentPath)).toHaveLength(1);
  await expect(wake.locator('.aircraft-speed-wake-base').first()).toHaveAttribute('d', '');
});

test('reduced motion suppresses preloading until the layer can actually be shown', async ({ page, radar }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(5);
  const nextFeed = radar.aircraftRequests + 2;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  expect(radar.traceRequests).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: /^PRELOADED,/ }).locator('.aircraft-speed-wake'))
    .toHaveAttribute('data-route', 'measured');
  expect(radar.traceRequests.filter((path) => path === recentPath)).toHaveLength(1);
});
