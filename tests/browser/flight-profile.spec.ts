import { test, expect } from './radar-fixture';

// Isolate selected full/recent trace loading from decorative viewport prefetch.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vector.aircraftWakes', 'false'));
});

test('profile shares trace loading, supports touch/keyboard and maps measured positions', async ({ page, radar, isMobile }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.aircraft-row').filter({ hasText: 'VECTOR' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Show full details' }).click();
  const profile = page.getByRole('region', { name: 'Flight profile' });
  const toggle = profile.getByRole('button', { name: /Flight profile/ });
  const chart = profile.locator('.profile-chart');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(chart).toHaveCount(0);
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(chart).toBeVisible();
  await expect(profile.locator('.profile-reading')).toHaveCount(0);
  expect(radar.traceRequests.length).toBe(2); // full + recent, not two independent consumers
  await chart.scrollIntoViewIfNeeded();
  if (isMobile) await chart.tap({ position: { x: 60, y: 40 } });
  else await chart.click({ position: { x: 60, y: 40 } });
  await expect(page.locator('.trace-profile-marker')).toHaveCount(1);
  const slider = profile.getByRole('slider', { name: 'Position along route' });
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', /5,791 m, 370 km\/h/);
  await expect(profile.locator('.profile-altitude .profile-reading')).toHaveText('5,791 m');
  await expect(profile.locator('.profile-speed .profile-reading')).toHaveText('370 km/h');
  await expect.poll(async () => page.locator('.maplibre-surface').evaluate((map) => {
    const highlight = map.querySelector('.trace-profile-marker')?.getBoundingClientRect();
    const line = map.querySelector('.map-leg-trace-overlay line');
    const bounds = map.getBoundingClientRect();
    if (!highlight || !line) return Infinity;
    return Math.hypot(highlight.x + highlight.width / 2 - bounds.x - Number(line.getAttribute('x1')),
      highlight.y + highlight.height / 2 - bounds.y - Number(line.getAttribute('y1')));
  })).toBeLessThan(2);
  const firstTime = await page.locator('.trace-profile-marker').getAttribute('data-timestamp');
  await slider.press('ArrowRight');
  await expect(page.locator('.trace-profile-marker')).not.toHaveAttribute('data-timestamp', firstTime!);
  await expect(slider).toHaveAttribute('aria-valuetext', /6,096 m/);
  await page.screenshot({ path: testInfo.outputPath('flight-profile.png') });

  await profile.getByRole('combobox').selectOption('full');
  await slider.focus();
  await slider.press('Home');
  const fullTime = Number(await page.locator('.trace-profile-marker').getAttribute('data-timestamp'));
  expect(Number(firstTime) - fullTime).toBe(3600);
  expect(radar.traceRequests.length).toBe(2);
  await page.locator('.settings-menu summary').click();
  await page.getByRole('combobox', { name: 'Unit system', exact: true }).selectOption('aeronautical');
  await page.keyboard.press('Escape');
  await expect(profile.locator('.profile-altitude .profile-reading')).toHaveText('20,000 ft');
  await expect(profile.locator('.profile-speed .profile-reading')).toHaveText('200 kt');
  expect(await profile.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(chart).toHaveCount(0);
  await expect(page.locator('.trace-profile-marker')).toHaveCount(0);
  await expect(page.locator('.map-leg-trace-overlay line').first()).toBeAttached();
  await toggle.press('Enter');
  await expect(profile.getByRole('combobox')).toHaveValue('full');
  await expect(profile.locator('.profile-reading')).toHaveCount(0);
  expect(radar.traceRequests.length).toBe(2);
});

test('unavailable trace and missing speed do not invent a profile', async ({ page, radar, isMobile }) => {
  radar.traceUnavailable = true;
  await page.clock.setFixedTime(new Date('2026-01-15T12:32:00Z'));
  radar.timestamp = new Date('2026-01-15T12:32:00Z').getTime() / 1000;
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.aircraft-row').filter({ hasText: 'VECTOR' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Show full details' }).click();
  await page.getByRole('button', { name: /Flight profile/ }).click();
  await expect(page.locator('.profile-empty')).toHaveText('Not enough trace data yet');
  await expect(page.locator('.profile-chart')).toHaveCount(0);
  radar.traceUnavailable = false;
  radar.traceSpeed = null;
  // Select a different aircraft: no prior plane's trace should remain on screen.
  if (isMobile) {
    await page.locator('.mobile-details-collapse').click();
    await page.locator('.mobile-list-button').click();
  }
  await page.locator('.aircraft-row').filter({ hasText: 'BALLOON' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Show full details' }).click();
  await expect(page.getByRole('button', { name: /Flight profile/ })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: /Flight profile/ }).click();
  const slider = page.getByRole('slider', { name: 'Position along route' });
  await expect(slider).toBeVisible();
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', /305 m, — km\/h/);
  await expect(page.locator('.profile-speed')).toContainText('No measurements');
});

test('history profile uses only the loaded replay window', async ({ page, radar, isMobile }) => {
  const now = new Date('2026-01-15T12:32:00Z');
  await page.clock.setFixedTime(now);
  radar.timestamp = now.getTime() / 1000;
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'History timeline' })).toBeEnabled();
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.aircraft-row').filter({ hasText: 'VECTOR' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Show full details' }).click();
  await page.getByRole('button', { name: /Flight profile/ }).click();
  await expect(page.locator('.profile-chart')).toBeVisible();
  await expect(page.locator('.flight-profile')).toContainText('Loaded time window');
  expect(radar.traceRequests.length).toBe(0);
  const slider = page.getByRole('slider', { name: 'Position along route' });
  await slider.focus();
  await slider.press('Home');
  const timestamp = Number(await page.locator('.trace-profile-marker').getAttribute('data-timestamp'));
  expect(timestamp).toBeLessThan(now.getTime() / 1000 - 120);
});

test('dense map labels stay inside the map and do not overlap, also at lower zoom', async ({ page, radar, isMobile }, testInfo) => {
  radar.extraAircraft = Array.from({ length: 30 }, (_, i) => ({
    hex: (0x100000 + i).toString(16), flight: `TEST${i}`, lat: 52.18 + Math.floor(i / 6) * .05,
    lon: 4.6 + (i % 6) * .09, alt_baro: 10000, seen: 0, gs: 0, type: 'adsb_icao',
  }));
  await page.addInitScript(() => {
    localStorage.setItem('vector.mapLabels', 'true');
    localStorage.setItem('vector.aircraftMotion', 'false');
    localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['abc123']));
  });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(32);
  const check = async () => page.locator('.maplibre-surface').evaluate((map) => {
    const canvas = map.getBoundingClientRect();
    const labels = [...map.querySelectorAll('.map-plane-label')].filter((label) => getComputedStyle(label).visibility !== 'hidden').map((label) => label.getBoundingClientRect());
    return { count: labels.length, valid: labels.every((label, i) => label.left >= canvas.left && label.right <= canvas.right && label.top >= canvas.top && label.bottom <= canvas.bottom
      && labels.slice(i + 1).every((other) => label.right <= other.left || label.left >= other.right || label.bottom <= other.top || label.top >= other.bottom)) };
  });
  await expect.poll(async () => (await check()).valid).toBe(true);
  expect((await check()).count).toBeGreaterThan(0);
  expect((await check()).count).toBeLessThan(32);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(async () => (await check()).valid).toBe(true);
  await expect(page.locator('.map-plane-label.label-compact').first()).toBeAttached();
  await expect(page.locator('.aircraft-map-marker.favorite .map-plane-label')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`labels-${isMobile ? 'mobile' : 'desktop'}.png`) });
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Hide aircraft labels', exact: true }).click();
  await expect(page.locator('.map-plane-label:not(.label-hidden)')).toHaveCount(0);
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(32);
});
