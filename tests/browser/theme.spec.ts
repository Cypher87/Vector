import { test, expect } from './radar-fixture';
import { applySyncPreferencePatch, type SyncPreferences, type SyncPreferencePatch } from '../../src/sync/preferences';

test('light mode keeps the receiver marker and distance rings the same gold as the actual range outline', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('vector.actualRangeOutline', 'true');
    localStorage.setItem('vector.distanceRings', 'true');
  });
  await page.route('**/api/readsb?**', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path');
    if (path === 'receiver.json') return route.fulfill({ json: {
      refresh: 1000, lat: 52.3, lon: 4.8, outlineJson: true,
    } });
    if (path === 'outline.json') return route.fulfill({ json: {
      points: [[52.1, 4.5], [52.6, 4.5], [52.6, 5.1], [52.1, 5.1]],
    } });
    return route.fallback();
  });
  await page.goto('/');
  const marker = page.locator('.receiver-map-marker');
  const outline = page.locator('.map-actual-range-overlay polyline');
  await expect(marker).toBeVisible();
  await expect(outline).toBeVisible();
  await expect(page.locator('.distance-ring-line').first()).toBeVisible();
  for (const colorScheme of ['light', 'dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await expect(outline).toHaveCSS('stroke', 'rgb(227, 173, 91)');
    const accent = colorScheme === 'light' ? 'rgb(227, 173, 91)' : 'rgb(213, 170, 104)';
    await expect(marker).toHaveCSS('color', accent);
    await expect(page.locator('.distance-ring-line').first()).toHaveCSS('stroke', accent);
    await expect(page.locator('.distance-ring-line').first()).toHaveCSS('stroke-opacity', colorScheme === 'light' ? '0.95' : '0.78');
    await expect(page.locator('.distance-ring-line').first()).toHaveCSS('stroke-width', colorScheme === 'light' ? '1.8px' : '1.45px');
    await expect(page.locator('.distance-ring-casing').first()).toHaveCSS('display', colorScheme === 'light' ? 'none' : 'inline');
    await expect(page.locator('.distance-ring-label-backdrop').first()).toHaveCSS('stroke', accent);
    await expect(page.locator('.distance-ring-label-text').first()).toHaveCSS('fill', accent);
  }
  await page.screenshot({ path: testInfo.outputPath('light-receiver-outline.png') });
});

test('automatic appearance follows the device live without resetting the map or layers', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('vector.distanceRings', 'true');
    localStorage.setItem('vector.aircraftMotion', 'false');
  });
  let styleRequests = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/map-style.json') styleRequests++; });
  await page.goto('/');
  const html = page.locator('html');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('data-theme-mode', 'auto');
  const balloon = page.locator('.aircraft-map-marker').filter({ hasText: 'BALLOON' });
  await balloon.click();
  await expect(balloon).toHaveClass(/selected/);
  await expect(page.locator('.distance-ring-line').first()).toBeVisible();
  const position = (await balloon.boundingBox())!;
  const canvas = await page.locator('.maplibregl-canvas').elementHandle();
  const initialStyleRequests = styleRequests;
  await page.locator('.settings-menu summary').click();
  const select = page.getByRole('combobox', { name: 'Theme', exact: true });
  await expect(select).toHaveValue('auto');
  await expect(select.locator('option')).toHaveText(['Dark', 'Light', 'Automatic']);
  await expect(page.getByRole('combobox', { name: 'Map style', exact: true })).toHaveCount(0);
  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(html).toHaveAttribute('data-theme', colorScheme);
    await expect(select).toHaveValue('auto');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await expect(balloon).toHaveClass(/selected/);
    await expect(page.locator('.distance-ring-line').first()).toBeVisible();
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    const current = (await balloon.boundingBox())!;
    expect(Math.abs(current.x - position.x)).toBeLessThan(1);
    expect(Math.abs(current.y - position.y)).toBeLessThan(1);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('vector.theme'))).toBe('auto');
    expect(await page.evaluate(() => localStorage.getItem('vector.distanceRings'))).toBe('true');
    await page.screenshot({ path: testInfo.outputPath(`automatic-${colorScheme}.png`) });
  }
  expect(styleRequests).toBe(initialStyleRequests);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveAttribute('data-theme-mode', 'auto');
});

test('explicit light and dark choices override the device and survive reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  for (const mode of ['light', 'dark'] as const) {
    await page.locator('.settings-menu summary').click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(mode);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await expect(page.locator('html')).toHaveAttribute('data-theme-mode', mode);
    }
    await expect.poll(() => page.evaluate(() => localStorage.getItem('vector.theme'))).toBe(mode);
    await page.reload();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
  }
});

test('legacy local preferences migrate without retaining the separate map style', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('theme-migration-test')) return;
    localStorage.setItem('theme-migration-test', 'ready');
    localStorage.setItem('vector.theme', 'daylight');
    localStorage.setItem('vector.mapTheme', 'dark');
  });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vector.theme'))).toBe('light');
  expect(await page.evaluate(() => localStorage.getItem('vector.mapTheme'))).toBeNull();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'light');
});

test('paired devices synchronize the mode, not their resolved system colors', async ({ page, context, radar }) => {
  let preferences: SyncPreferences = { theme: 'auto', language: 'en' };
  let revision = 1;
  const themeWrites: string[] = [];
  const second = await context.newPage();
  await radar.install(second);
  for (const device of [page, second]) {
    await device.route('**/api/sync/session', (route) => route.fulfill({ json: {
      connected: true, deviceId: 'test-device', profileId: 'test-profile', preferences, revision,
    } }));
    await device.route('**/api/sync/events', (route) => route.fulfill({ status: 204 }));
    await device.route('**/api/sync/preferences', (route) => {
      const patch: SyncPreferencePatch = route.request().postDataJSON().patch;
      if (patch.settings?.theme) themeWrites.push(patch.settings.theme);
      preferences = applySyncPreferencePatch(preferences, patch);
      return route.fulfill({ json: { preferences, revision: ++revision } });
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await second.emulateMedia({ colorScheme: 'dark' });
  await Promise.all([page.goto('/'), second.goto('/')]);
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await expect(second.locator('.aircraft-map-marker')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(preferences.theme).toBe('auto');
  expect(themeWrites).toEqual([]);
  await page.locator('.settings-menu summary').click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await expect.poll(() => preferences.theme).toBe('light');
  await second.reload();
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(second.locator('html')).toHaveAttribute('data-theme-mode', 'light');
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('auto');
  await expect.poll(() => preferences.theme).toBe('auto');
  await second.reload();
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(second.locator('html')).toHaveAttribute('data-theme-mode', 'auto');
  expect(themeWrites).toEqual(['light', 'auto']);
  await second.close();
});
