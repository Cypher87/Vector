import { test, expect } from './radar-fixture';
import type { AircraftDatabaseStatus } from '../../src/domain/aircraft-database-status';

for (const language of ['en', 'nl']) {
  test(`receiver dashboard shows readable database update details in ${language}`, async ({ page, isMobile }, testInfo) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      localStorage.setItem('vector.theme', language === 'en' ? 'daylight' : 'vector');
    }, language);
    const updatedAt = Date.now() - 3 * 3600_000;
    await page.route('**/api/aircraft-database-status', (route) => route.fulfill({ json: {
      state: 'ready', location: 'receiver', updatedAt, records: 623176,
    } }));
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await page.locator('.receiver-dashboard-button').click();
    const panel = page.locator('.receiver-database');
    await expect(panel.getByRole('status')).toHaveText('Recent');
    await expect(panel).toContainText(language === 'nl' ? 'Op de receiver' : 'On the receiver');
    await expect(panel.locator('time')).toHaveAttribute('datetime', new Date(updatedAt).toISOString());
    await expect(panel.locator('time')).not.toContainText(/AM|PM/i);
    await expect(panel).toContainText(language === 'nl' ? '623.176' : '623,176');
    await panel.scrollIntoViewIfNeeded();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await panel.locator('time').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(15);
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: testInfo.outputPath('database-status.png') });
  });
}

test('database status polls while open, warns about old data and never invents missing or unavailable updates', async ({ page }) => {
  // Install before the application creates its interval so fastForward controls it.
  await page.clock.install();
  let requests = 0;
  let failed = false;
  let status: AircraftDatabaseStatus = { state: 'ready', location: 'local', records: 123, updatedAt: Date.now() - 72 * 3600_000 };
  await page.route('**/api/aircraft-database-status', (route) => {
    requests++;
    return route.fulfill({ status: failed ? 503 : 200, json: failed ? {} : status });
  });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  expect(requests).toBe(0);
  await page.locator('.receiver-dashboard-button').click();
  const panel = page.locator('.receiver-database');
  await expect(panel.getByRole('status')).toHaveText('Older than 48 hours');
  await expect(panel).toContainText('Check the database update timer');
  status = { ...status, updatedAt: Date.now() };
  await page.clock.fastForward(60_001);
  await expect(panel.getByRole('status')).toHaveText('Recent');
  failed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.getByRole('status')).toHaveText('Unable to verify');
  await expect(panel.locator('time')).toHaveAttribute('datetime', new Date(status.updatedAt!).toISOString());
  failed = false;
  for (const state of ['missing', 'external'] as const) {
    status = { state, location: 'local', records: null, updatedAt: null };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel.getByRole('status')).toHaveText(state === 'missing' ? 'Not downloaded' : 'Update unknown');
    await expect(panel.locator('time')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Close receiver dashboard', exact: true }).click();
  await expect(panel).toHaveCount(0);
  const before = requests;
  await page.clock.fastForward(120_000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(requests).toBe(before);
});
