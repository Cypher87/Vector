import { test, expect } from './radar-fixture';

test('aircraft preview links list and map without selection or camera movement', async ({ page, radar, isMobile }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('vector.aircraftMotion', 'false');
    localStorage.setItem('vector.mapLabels', 'false');
  });
  await page.goto('/');
  const marker = page.locator('.aircraft-map-marker').filter({ hasText: 'VECTOR01' });
  const balloon = page.locator('.aircraft-map-marker').filter({ hasText: 'BALLOON' });
  await expect(marker).toBeVisible();
  const row = page.locator('.aircraft-row').filter({ hasText: 'VECTOR01' });
  if (isMobile) {
    await page.locator('.mobile-list-button').tap();
    await row.dispatchEvent('pointerenter', { pointerType: 'touch' });
    await expect(page.locator('.previewed')).toHaveCount(0);
    await row.tap();
    await expect(marker).toHaveClass(/selected/);
    await expect(page.locator('.previewed')).toHaveCount(0);
    return;
  }
  const position = await balloon.boundingBox();
  await row.hover();
  await expect(row).toHaveClass(/previewed/);
  await expect(marker).toHaveClass(/previewed/);
  await expect(page.locator('.aircraft-map-marker.selected')).toHaveCount(0);
  await expect(page.locator('.detail-panel')).not.toBeVisible();
  expect(await balloon.boundingBox()).toEqual(position);
  await expect(marker.locator('.map-plane-label')).toHaveClass(/label-hidden/);
  await page.screenshot({ path: testInfo.outputPath('list-preview-dark.png') });
  // A new feed preserves the preview and reuses the marker node.
  const markerHandle = await marker.elementHandle();
  const requests = radar.aircraftRequests;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThan(requests + 1);
  expect(await marker.evaluate((element, original) => element === original, markerHandle)).toBe(true);
  await expect(marker).toHaveClass(/previewed/);
  await page.mouse.move(500, 100);
  await expect(page.locator('.previewed')).toHaveCount(0);
  await marker.hover();
  await expect(row).toHaveClass(/previewed/);
  await expect(marker).toHaveClass(/previewed/);
  await page.mouse.move(500, 100);
  await page.keyboard.press('Tab');
  await row.focus();
  await expect(marker).toHaveClass(/previewed/);
  await row.press('Tab');
  await expect(balloon).toHaveClass(/previewed/);
  await expect(marker).not.toHaveClass(/previewed/);
  await page.locator('.search-box input').fill('BALLOON');
  await expect(marker).toHaveCount(0);
  await expect(page.locator('.previewed')).toHaveCount(0);
  await page.locator('.search-box input').fill('');
  await expect(marker).toBeVisible();
  await page.locator('.settings-menu summary').click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.keyboard.press('Escape');
  await row.hover();
  await expect(marker).toHaveClass(/previewed/);
  await page.screenshot({ path: testInfo.outputPath('list-preview-light.png') });
  radar.omittedAircraftIds = ['abc123'];
  await expect(marker).toHaveCount(0);
  await expect(page.locator('.previewed')).toHaveCount(0);
});

test('preview highlights only the aircraft silhouette, without a ring or resizing', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Touch selection does not have a hover state');
  await page.addInitScript(() => {
    localStorage.setItem('vector.aircraftMotion', 'false');
    localStorage.setItem('vector.mapLabels', 'false');
  });
  await page.goto('/');
  const marker = page.locator('.aircraft-map-marker').filter({ hasText: 'VECTOR01' });
  const body = marker.locator('.map-aircraft-icon > .aircraft-icon-body');
  const symbol = marker.locator('.aircraft-map-symbol');
  const silhouette = body.locator('.aircraft-icon-main').first();
  const label = marker.locator('.map-plane-label');
  for (const theme of ['dark', 'light']) {
    await page.locator('.settings-menu summary').click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.keyboard.press('Escape');
    await page.mouse.move(500, 100);
    await expect(marker).not.toHaveClass(/previewed/);
    const idleFilter = await body.evaluate((element) => getComputedStyle(element).filter);
    const color = await silhouette.evaluate((element) => getComputedStyle(element).fill);
    const scale = await symbol.evaluate((element) => getComputedStyle(element).transform);
    const labelFilter = await label.evaluate((element) => getComputedStyle(element).filter);
    // Interpolating the SVG filter briefly rendered a black silhouette on hover.
    await expect(body).toHaveCSS('transition-duration', '0s');
    await marker.hover();
    await expect(marker).toHaveClass(/previewed/);
    await expect(body).toHaveCSS('filter', /brightness\(1\.18\)/);
    await expect(body).toHaveCSS('transition-duration', '0s');
    await expect(silhouette).toHaveCSS('fill', color);
    await expect(symbol).toHaveCSS('transform', scale);
    await expect(label).toHaveCSS('filter', labelFilter);
    await expect(marker.locator('.aircraft-wake-svg')).toHaveCSS('filter', 'none');
    expect(await marker.evaluate((element) => getComputedStyle(element, '::after').content)).toBe('none');
    await page.screenshot({ path: testInfo.outputPath(`silhouette-preview-${theme}.png`) });
    await page.mouse.move(500, 100);
    await expect(body).toHaveCSS('filter', idleFilter);
  }
  // Keyboard users get the same preview, without introducing animation when reduced.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await marker.focus();
  await expect(marker).toHaveClass(/previewed/);
  await expect(body).toHaveCSS('filter', /brightness\(1\.18\)/);
  await expect(body).toHaveCSS('transition-duration', '0s');
  await marker.press('Enter');
  await expect(marker).toHaveClass(/selected/);
  await expect(body).not.toHaveCSS('filter', /brightness/);
});

for (const language of ['en', 'nl']) {
  test(`list states distinguish loading, offline, empty and filters in ${language}`, async ({ page, radar, isMobile }, testInfo) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      localStorage.setItem('vector.theme', language === 'nl' ? 'light' : 'dark');
      localStorage.setItem('vector.aircraftFilters', JSON.stringify({ categories: ['helicopter'] }));
      localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify([{ id: 'test', name: 'Helicopters', filters: { categories: ['helicopter'] } }]));
    }, language);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/config', async (route) => { await ready; await route.fallback(); });
    radar.aircraftUnavailable = true;
    await page.goto('/');
    if (isMobile) await page.locator('.mobile-list-button').click();
    const state = page.locator('.aircraft-list-state');
    await expect(state).toContainText(language === 'nl' ? 'Verbinding maken…' : 'Connecting…');
    await expect(state.getByRole('button')).toHaveCount(0);
    release();
    await expect(state).toContainText('Receiver offline');
    await expect(state.getByRole('button')).toHaveCount(0);
    radar.aircraftUnavailable = false;
    await expect(state).toContainText(language === 'nl' ? 'Geen resultaten' : 'No results');
    await page.locator('.search-box input').fill('NO MATCH');
    await expect(state.getByRole('button')).toHaveText(language === 'nl' ? 'Filters wissen' : 'Clear filters');
    await page.screenshot({ path: testInfo.outputPath('empty-filter-results.png') });
    await state.getByRole('button').click();
    await expect(page.locator('.aircraft-row')).toHaveCount(2);
    await expect(page.locator('.search-box input')).toHaveValue('');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!).length)).toBe(1);
    await page.locator('.search-box input').fill('NO MATCH');
    await expect(state.getByRole('button')).toHaveText(language === 'nl' ? 'Zoekopdracht wissen' : 'Clear search');
    await state.getByRole('button').click();
    await expect(page.locator('.aircraft-row')).toHaveCount(2);
    radar.omittedAircraftIds = ['abc123', 'def456'];
    await expect(state).toContainText(language === 'nl' ? 'Momenteel geen vliegtuigen' : 'No aircraft right now');
    await expect(state.getByRole('button')).toHaveCount(0);
    radar.timestamp = Date.now() / 1000 - 90;
    await expect(state).toContainText(language === 'nl' ? 'Wachten op actuele gegevens…' : 'Waiting for current data…');
    await expect(state.getByRole('button')).toHaveCount(0);
    radar.timestamp = undefined;
    radar.omittedAircraftIds = [];
    await expect(state).toHaveCount(0);
    await expect(page.locator('.aircraft-row')).toHaveCount(2);
  });
}
