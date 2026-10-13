import type { Page } from '@playwright/test';
import { test, expect, replayFile } from './radar-fixture';

const now = new Date('2026-01-16T12:32:00Z');
const firstSeen = Date.parse('2026-01-15T22:00:00Z');
const lastSeen = Date.parse('2026-01-16T00:10:00Z');

async function installLogbook(page: Page, overrides: { hex?: string; firstSeen?: number; lastSeen?: number } = {}) {
  const entry = { hex: 'def456', registration: 'TEST-2', aircraftType: 'BALL', description: 'Hot air balloon',
    callsign: 'CURRENT', firstSeen, lastSeen, visits: 1, ...overrides };
  await page.route('**/api/logbook?*', (route) => route.fulfill({ json: { entries: [entry], total: 1, page: 1,
    pageSize: 30, days: 90, retentionDays: 90, startedAt: firstSeen, updatedAt: now.getTime(),
    visits: [{ firstSeen: entry.firstSeen, lastSeen: entry.lastSeen, callsigns: 'EARLIER' }],
  } }));
}

async function openSighting(page: Page, language = 'en') {
  await page.getByRole('button', { name: language === 'nl' ? 'Open logboek' : 'Open logbook', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: language === 'nl' ? 'Logboek' : 'Logbook', exact: true });
  await dialog.locator('.logbook-identity').click();
  await expect(dialog.locator('.logbook-replay')).toBeEnabled();
  return dialog;
}

test.beforeEach(async ({ page, radar }) => {
  await page.clock.setFixedTime(now);
  radar.timestamp = now.getTime() / 1000;
  await page.addInitScript(() => {
    localStorage.setItem('vector.aircraftWakes', 'false');
    localStorage.setItem('vector.legTrace', 'false');
  });
});

test('replays an offline sighting across midnight with the correct type, route and profile', async ({ page, radar, isMobile }, testInfo) => {
  radar.omittedAircraftIds = ['def456'];
  await installLogbook(page);
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
  const dialog = await openSighting(page);
  expect(radar.replayRequests).toHaveLength(0); // Expanding a row does not prefetch every visit.
  await page.screenshot({ path: testInfo.outputPath('logbook-replay-action.png') });
  await dialog.locator('.logbook-replay').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.history-panel')).toBeVisible();
  await expect(page.locator('.history-play')).toHaveAttribute('aria-label', 'Play');
  expect(radar.replayRequests.sort()).toEqual(['2026/01/15/heatmap/47.bin.ttf', '2026/01/16/heatmap/00.bin.ttf']);
  const timeline = page.getByRole('slider', { name: 'History timeline' });
  await expect(timeline).toHaveValue('60');
  await expect(timeline).toHaveAttribute('max', '60');
  await expect(page.locator('.aircraft-map-marker.selected')).toContainText('DEF456');
  await expect(page.locator('.map-leg-trace-overlay line').first()).toBeAttached();
  if (isMobile) {
    await expect(page.locator('.mobile-aircraft-summary')).toBeVisible();
    await expect(page.locator('.mobile-aircraft-summary')).toContainText('TEST-2');
    await page.getByRole('button', { name: 'Show full details' }).click();
  }
  await expect(page.locator('.detail-panel')).toContainText('TEST-2');
  await expect(page.locator('.detail-panel')).toContainText('BALL');
  await expect(page.locator('.detail-panel')).not.toContainText('CURRENT');
  const profile = page.getByRole('region', { name: 'Flight profile' });
  await expect(profile.locator('.profile-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(profile.locator('.profile-chart')).toBeVisible();
  const position = profile.getByRole('slider', { name: 'Position along route' });
  await position.focus();
  await position.press('Home');
  await expect(page.locator('.trace-profile-marker')).toHaveAttribute('data-timestamp', String(lastSeen / 1000 - 1800));
  await position.press('End');
  await expect(page.locator('.trace-profile-marker')).toHaveAttribute('data-timestamp', String(lastSeen / 1000));
  expect(radar.traceRequests).toHaveLength(0); // Never fetch today's trace for an old sighting.
  await page.screenshot({ path: testInfo.outputPath('logbook-replay-profile.png') });
  if (isMobile) await page.locator('.mobile-details-collapse').click();
  // Playback restarts within this sighting, then stops instead of fetching unrelated history.
  await page.locator('.history-play').click();
  await expect(timeline).not.toHaveValue('60');
  await page.locator('.history-play').click();
  await timeline.fill('59');
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('60');
  await page.locator('.history-play').click();
  await expect(page.locator('.history-play')).toHaveAttribute('aria-label', 'Play');
  await expect(timeline).toHaveValue('60');
  expect(radar.replayRequests).toHaveLength(2);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.history-panel')).toHaveCount(0);
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('vector.legTrace'))).toBe('false');
  await expect(page.locator('.map-leg-trace-overlay line')).toHaveCount(0);
});

test('expired history stays in the logbook, retries, and clears only filters that hide the selected aircraft', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('vector.language', 'nl');
    localStorage.setItem('vector.aircraftFilters', JSON.stringify({ altitude: { min: 10000, max: null } }));
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await installLogbook(page);
  let unavailable = true;
  await page.route('**/api/readsb?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? '';
    return !path.endsWith('.bin.ttf') ? route.fallback() : unavailable
      ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ body: replayFile(path) });
  });
  await page.goto('/');
  const dialog = await openSighting(page, 'nl');
  await dialog.locator('.logbook-replay').click();
  await expect(dialog.locator('.logbook-replay-status')).toHaveText('Geen historie beschikbaar.');
  await expect(page.locator('.history-panel')).toHaveCount(0);
  await expect(dialog.locator('.logbook-replay')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('logbook-no-replay.png') });
  unavailable = false;
  await dialog.locator('.logbook-replay').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.aircraft-map-marker.selected')).toContainText('DEF456');
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftFilters'))).toBeNull();
});

test('a recording without the requested aircraft never falls back to its live position', async ({ page, radar }) => {
  radar.extraAircraft = [{ hex: 'aabbcc', flight: 'LIVEONLY', lat: 52.3, lon: 4.8, alt_baro: 1000, seen: 0 }];
  await installLogbook(page, { hex: 'aabbcc' });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(3);
  const dialog = await openSighting(page);
  await dialog.locator('.logbook-replay').click();
  await expect(dialog.locator('.logbook-replay-status')).toHaveText('No history available.');
  await expect(page.locator('.history-panel')).toHaveCount(0);
  await expect(page.locator('.live-pill')).toHaveClass(/live/);
});

test('loading errors are distinct from absent recordings and requests can be cancelled', async ({ page }) => {
  await installLogbook(page);
  let failing = true;
  let release: (() => void) | undefined;
  await page.route('**/api/readsb?*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? '';
    if (!path.endsWith('.bin.ttf')) return route.fallback();
    if (failing) return route.fulfill({ status: 503, json: {} });
    // One shared gate releases both chunks after the user dismisses the logbook.
    await gate;
    return route.fulfill({ body: replayFile(path) });
  });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.goto('/');
  const dialog = await openSighting(page);
  await dialog.locator('.logbook-replay').click();
  await expect(dialog.locator('.logbook-replay-status')).toHaveText('Could not load history.');
  failing = false;
  await dialog.locator('.logbook-replay').click();
  await expect(dialog.locator('.logbook-replay')).toBeDisabled();
  await expect(dialog.locator('.logbook-replay')).toHaveText('Loading…');
  await dialog.getByRole('button', { name: 'Close logbook', exact: true }).click();
  release!();
  await openSighting(page);
  await expect(dialog.locator('.logbook-replay')).toBeEnabled();
  await expect(page.locator('.history-panel')).toHaveCount(0);
  // The cancelled requests must not poison the cache or interfere with a new attempt.
  await dialog.locator('.logbook-replay').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.history-panel')).toBeVisible();
});

test('session-only sightings remain frozen while the live receiver moves on', async ({ page, radar }) => {
  await installLogbook(page, { hex: 'abc123', firstSeen: now.getTime() - 60_000, lastSeen: now.getTime() });
  await page.route('**/api/readsb?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path');
    return path === 'receiver.json' ? route.fulfill({ json: { refresh: 1000, haveReplay: false, lat: 52.3, lon: 4.8 } }) : route.fallback();
  });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  const dialog = await openSighting(page);
  await dialog.locator('.logbook-replay').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.history-panel')).toBeVisible();
  const time = await page.locator('.history-playback time').textContent();
  const requests = radar.aircraftRequests;
  await page.clock.setFixedTime(new Date(now.getTime() + 20_000));
  radar.timestamp! += 20;
  radar.longitudeOffset = 1;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThan(requests + 1);
  await expect(page.locator('.history-playback time')).toHaveText(time!);
  await expect(page.locator('.history-play')).toBeDisabled();
  expect(radar.replayRequests).toHaveLength(0);
});

test('a recent sighting uses its in-progress receiver chunk, not the previous completed half-hour', async ({ page, radar }) => {
  await installLogbook(page, { firstSeen: now.getTime() - 120_000, lastSeen: now.getTime() - 30_000 });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  const dialog = await openSighting(page);
  await dialog.locator('.logbook-replay').click();
  await expect(dialog).toHaveCount(0);
  expect(radar.replayRequests).toEqual(['2026/01/16/heatmap/25.bin.ttf']);
  await expect(page.getByRole('slider', { name: 'History timeline' })).toHaveValue('3');
  await expect(page.locator('.history-playback time')).toHaveText('16 Jan 2026, 13:31:30');
});

test('a stalled replay request times out without opening history and leaves a retryable button', async ({ page }) => {
  await installLogbook(page);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/readsb?*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? '';
    if (!path.endsWith('.bin.ttf')) return route.fallback();
    await gate;
    return route.fulfill({ body: replayFile(path) });
  });
  try {
    await page.goto('/');
    const dialog = await openSighting(page);
    await dialog.locator('.logbook-replay').click();
    await expect(dialog.locator('.logbook-replay-status')).toHaveText('Could not load history.', { timeout: 20_000 });
    await expect(dialog.locator('.logbook-replay')).toBeEnabled();
    await expect(page.locator('.history-panel')).toHaveCount(0);
  } finally { release!(); }
});
