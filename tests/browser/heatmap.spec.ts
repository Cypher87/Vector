import { test, expect } from './radar-fixture';
import { maximumHeatmapPoints } from '../../src/domain/heatmap';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vector.aircraftMotion', 'false'); localStorage.setItem('vector.aircraftWakes', 'false');
    localStorage.setItem('vector.mapLabels', 'false');
  });
});

test('maximum-size heatmaps retain route detail and zoom without new history requests or DOM markers', async ({ page, radar }) => {
  test.setTimeout(90_000);
  radar.heatmapPointCount = maximumHeatmapPoints;
  await page.goto('/');
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Show heatmap', exact: true }).click();
  const surface = page.locator('.maplibre-surface');
  await expect(surface).toHaveAttribute('data-heatmap-points', String(maximumHeatmapPoints));
  await expect(surface).toHaveAttribute('data-heatmap-rendered', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  const requests = radar.heatmapRequests.length;
  for (const name of ['Zoom in', 'Zoom in', 'Zoom out', 'Zoom out']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(surface).toHaveAttribute('data-camera-zooming', 'false');
  }
  expect(radar.heatmapRequests.length).toBe(requests);
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await expect(surface).toHaveAttribute('data-heatmap-points', String(maximumHeatmapPoints));
});

test('heatmap is an optional GPU layer with persisted periods, separate legend and foreground aircraft', async ({ page, radar, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error' && /heatmap|expression|style/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  expect(radar.heatmapRequests.length).toBe(0);
  await expect(page.locator('.heatmap-legend')).toHaveCount(0);
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Show heatmap', exact: true }).click();
  const period = page.getByRole('combobox', { name: 'Heatmap period', exact: true });
  await expect(period).toHaveValue('24h');
  const legend = page.getByRole('complementary', { name: 'Heatmap', exact: true });
  await expect(legend).toContainText('24 hours');
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-points', '2000');
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-rendered', 'ready');
  await expect(legend.getByText('Low', { exact: true })).toBeVisible();
  await period.selectOption('1h');
  await expect(legend).toContainText('1 hour');
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-points', '500');
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-rendered', 'ready');
  await page.screenshot({ path: testInfo.outputPath('traffic-heatmap-one-hour.png') });
  expect(await page.evaluate(() => localStorage.getItem('vector.heatmapPeriod'))).toBe('1h');
  await period.selectOption('7d');
  await expect(legend).toContainText('7 days');
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-rendered', 'ready');
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('traffic-heatmap-dark.png') });
  await page.locator('.settings-menu summary').click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('nl');
  await page.locator('.settings-menu summary').click();
  await expect(legend).toContainText('7 dagen');
  const heatBounds = (await legend.boundingBox())!, altitudeBounds = (await page.locator('.altitude-legend').boundingBox())!;
  expect(heatBounds.x).toBeGreaterThanOrEqual(altitudeBounds.x + altitudeBounds.width);
  expect(heatBounds.x + heatBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath('traffic-heatmap-light.png') });
  await page.reload();
  await expect(legend).toContainText('7 days'); // Fixture starts each document in English.
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-visible', 'true');
  const requestCount = radar.heatmapRequests.length;
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Heatmap period', exact: true })).toHaveValue('7d');
  await page.getByRole('button', { name: 'Hide heatmap', exact: true }).click();
  await expect(legend).toHaveCount(0);
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-visible', 'false');
  expect(radar.heatmapRequests.length).toBe(requestCount);
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.locator('.aircraft-map-marker').first().click();
  if (isMobile) await expect(page.locator('.mobile-aircraft-summary')).toBeVisible();
  else await expect(page.locator('.detail-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('heatmap quietly shows available recordings with a period tooltip and distinguishes empty or failed history', async ({ page, radar, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  radar.heatmapLoading = 1; radar.heatmapPartial = true;
  await page.goto('/');
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Show heatmap', exact: true }).click();
  const legend = page.locator('.heatmap-legend');
  await expect(legend).toContainText('Loading… 1/49');
  await expect(legend.getByText('Low', { exact: true })).toBeVisible();
  await expect(legend.getByRole('img')).toHaveCount(0);
  await expect(legend).not.toContainText('Incomplete recordings');
  await expect(legend).toHaveAttribute('title', /\d.+ — .+\d/);
  const period = page.getByRole('combobox', { name: 'Heatmap period', exact: true });
  radar.heatmapEmpty = true;
  await period.selectOption('4h');
  await expect(legend).toContainText('No data');
  await expect(legend).not.toHaveAttribute('title');
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-points', '0');
  radar.heatmapError = true;
  await period.selectOption('8h');
  await expect(legend).toContainText('Heatmap unavailable');
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(legend).toHaveCount(0);
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-heatmap-visible', 'false');
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide heatmap', exact: true })).toBeDisabled();
});
