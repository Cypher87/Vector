import { test, expect, openFilterGroup } from './radar-fixture';

for (const language of ['en', 'nl']) {
  test(`Daylight secondary text and panels remain readable in ${language}`, async ({ page, isMobile }, testInfo) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      localStorage.setItem('vector.theme', 'daylight');
      localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify([{
        id: 'test-favorites', name: 'Favorites / Favorieten', sort: 'altitude-desc',
        filters: { adsbOnly: false, airborneOnly: false, favoritesOnly: true, positionOnly: false },
      }]));
    }, language);
    await page.route('https://api.planespotters.net/**', (route) => route.fulfill({ json: { photos: [{
      thumbnail_large: { src: 'https://photos.example.test/aircraft.png', size: { width: 1, height: 1 } },
      link: 'https://photos.example.test/aircraft', photographer: 'A photographer with a deliberately long credit name',
    }] } }));
    await page.route('https://photos.example.test/aircraft.png', (route) => route.fulfill({
      contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64'),
    }));
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight');
    await page.locator('.settings-menu summary').click();
    const settings = page.locator('.settings-popover');
    await expect(settings).toBeVisible();
    expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    if (isMobile) await page.locator('.mobile-list-button').click();
    await page.locator('.filter-menu > summary').click();
    const filter = page.locator('.filter-popover');
    await expect(filter).toBeVisible();
    const box = (await filter.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(await filter.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.locator('.filter-group')).toHaveCount(5);
    await expect(page.locator('.filter-group[open]')).toHaveCount(0);
    await openFilterGroup(page, 'categories');
    expect(await page.locator('.filter-categories label').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(13);
    await openFilterGroup(page, 'presets');
    await expect(page.locator('.filter-preset-apply')).toBeEnabled();
    await page.locator('.filter-close').click();
    await page.locator('.aircraft-row').filter({ hasText: 'VECTOR' }).click();
    if (isMobile) await page.locator('.mobile-aircraft-summary > button').click();
    await expect(page.locator('.flight-title p')).toHaveText('A320');
    await expect(page.locator('.metric-grid')).toBeInViewport({ ratio: 1 });
    const metricsBox = (await page.locator('.metric-section').boundingBox())!;
    const photoBox = (await page.locator('.detail-panel .aircraft-photo').boundingBox())!;
    expect(metricsBox.y + metricsBox.height).toBeLessThanOrEqual(photoBox.y);
    const profileToggle = page.getByRole('button', { name: new RegExp(language === 'nl' ? 'Vluchtprofiel' : 'Flight profile') });
    await expect(profileToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.profile-chart')).toHaveCount(0);
    const profileBox = (await page.locator('.flight-profile').boundingBox())!;
    expect(photoBox.y + photoBox.height).toBeLessThanOrEqual(profileBox.y);
    expect(profileBox.height).toBeLessThanOrEqual(52);
    await expect(page.locator('.metric-grid')).not.toContainText(language === 'nl' ? 'Metrisch' : 'Metric');
    const unknownRoute = page.locator('.route-unavailable');
    await expect(unknownRoute).toHaveText(language === 'nl' ? 'Geen bekende route beschikbaar' : 'No known route available');
    await expect(page.locator('.flight-route-summary')).toHaveCount(0);
    expect((await unknownRoute.boundingBox())!.height).toBeLessThan(36);
    const caption = page.locator('.aircraft-photo figcaption');
    await expect(caption).toContainText('A photographer with a deliberately long credit name');
    expect(await caption.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await caption.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(11);
    await page.screenshot({ path: testInfo.outputPath('daylight-details.png') });
    const detail = page.locator('.detail-panel');
    await page.locator('.technical-toggle').scrollIntoViewIfNeeded();
    const detailWidths = await detail.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(detailWidths.scroll).toBeLessThanOrEqual(detailWidths.client);
    if (isMobile) await expect(page.locator('.detail-actions')).toBeInViewport();
  });

  test(`active filter chips remove individual filters and preserve preferences in ${language}`, async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      // Set up once, so reloading also verifies actual preference persistence.
      if (localStorage.getItem('filter-chip-test')) return;
      localStorage.setItem('filter-chip-test', 'ready');
      localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['abc123']));
      localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify([{
        id: 'test-view', name: 'My view', sort: 'distance-asc',
        filters: { adsbOnly: true, airborneOnly: true, favoritesOnly: true, positionOnly: true },
      }]));
    }, language);
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    if (isMobile) await page.locator('.mobile-list-button').click();
    const search = page.locator('.search-box input');
    await search.fill('VECTOR');
    await page.locator('.filter-menu > summary').click();
    await openFilterGroup(page, 'presets');
    await page.locator('.filter-preset-apply').click();
    await page.locator('.filter-close').click();
    const chips = page.locator('.active-filter-chip');
    await expect(chips).toHaveCount(4);
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    const chipGroup = page.locator('.active-filter-chips');
    expect(await chipGroup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const chip of await chips.all()) await expect(chip).toBeInViewport({ ratio: 1 });

    const remove = language === 'nl' ? 'Verwijder filter' : 'Remove filter';
    const position = language === 'nl' ? 'Met positie' : 'With position';
    const favorites = language === 'nl' ? 'Favorieten' : 'Favorites';
    await page.getByRole('button', { name: `${remove}: ${position}`, exact: true }).press('Enter');
    await expect(chips).toHaveCount(3);
    await expect(page.getByRole('button', { name: `${remove}: ADS-B`, exact: true })).toBeFocused();
    await page.getByRole('button', { name: `${remove}: ${favorites}`, exact: true }).click();
    await expect(chips).toHaveCount(2);
    await expect(search).toHaveValue('VECTOR');
    await expect(page.locator('.sort-select')).toHaveValue('distance');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    await expect(page.locator('.aircraft-row')).toHaveCount(1);
    await search.fill('');
    await expect(page.locator('.aircraft-row')).toHaveCount(2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilters')!))).toMatchObject({
      source: 'adsb', flightStatus: 'airborne', favoritesOnly: false, position: 'all',
    });

    await page.reload();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    if (isMobile) await page.locator('.mobile-list-button').click();
    await expect(chips).toHaveCount(2);
    await page.locator('.filter-menu > summary').click();
    const favorite = page.locator('.filter-favorite input');
    await expect(favorite).not.toBeChecked();
    await openFilterGroup(page, 'flight');
    await expect(page.getByRole('combobox', { name: language === 'nl' ? 'Vluchtstatus' : 'Flight status', exact: true })).toHaveValue('airborne');
    await openFilterGroup(page, 'advanced');
    await expect(page.getByRole('combobox', { name: language === 'nl' ? 'Bron' : 'Source', exact: true })).toHaveValue('adsb');
    await expect(page.getByRole('combobox', { name: language === 'nl' ? 'Positie' : 'Position', exact: true })).toHaveValue('all');
    await page.locator('.filter-reset').click();
    await expect(chips).toHaveCount(0);
    await favorite.check();
    await page.locator('.filter-close').click();
    await expect(chips).toHaveCount(1);
    await chips.press('Enter');
    await expect(chipGroup).toHaveCount(0);
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft')!))).toEqual(['abc123']);
  });
}

test('known routes summarize airports beside the aircraft identity and keep full details below', async ({ page, isMobile }, testInfo) => {
  let routeRequests = 0;
  await page.route('https://adsb.im/api/0/routeset', (route) => {
    routeRequests++;
    return route.fulfill({ json: [{
      callsign: 'VECTOR1', plausible: true, _airports: [
        { iata: 'AMS', icao: 'EHAM', name: 'Amsterdam Airport Schiphol', location: 'Amsterdam' },
        { iata: 'CPH', icao: 'EKCH', name: 'Copenhagen Kastrup Airport', location: 'Copenhagen' },
      ],
    }] });
  });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.aircraft-row').filter({ hasText: 'VECTOR' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Show full details' }).click();
  const summary = page.locator('.flight-route-summary');
  await expect(summary).toContainText('AMS');
  await expect(summary).toContainText('CPH');
  await expect(summary.getByLabel('AMS: Amsterdam Airport Schiphol', { exact: true })).toBeVisible();
  await expect(summary.getByLabel('CPH: Copenhagen Kastrup Airport', { exact: true })).toBeVisible();
  expect(await summary.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.locator('.metric-grid')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.route-airports')).toContainText('Amsterdam Airport Schiphol');
  await expect(page.locator('.route-airports')).toContainText('Copenhagen Kastrup Airport');
  await expect(page.locator('.route-unavailable')).toHaveCount(0);
  const metrics = (await page.locator('.metric-section').boundingBox())!;
  const identity = (await page.locator('.flight-title').boundingBox())!;
  const summaryBox = (await summary.boundingBox())!;
  const route = (await page.locator('.route-card').boundingBox())!;
  expect(summaryBox.y).toBeGreaterThan(identity.y);
  expect(summaryBox.y + summaryBox.height).toBeLessThanOrEqual(identity.y + identity.height);
  expect(summaryBox.y + summaryBox.height).toBeLessThan(metrics.y);
  expect(metrics.y + metrics.height).toBeLessThan(route.y);
  expect(routeRequests).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('vector-details.png') });
});

test('unconfirmed routes and intermediate stops are clear in the summary', async ({ page, isMobile }) => {
  await page.route('https://adsb.im/api/0/routeset', (route) => route.fulfill({ json: [{
    callsign: 'VECTOR1', plausible: false, _airports: [
      { iata: 'AMS', name: 'Amsterdam Airport Schiphol' },
      { iata: 'FRA', name: 'Frankfurt Airport' },
      { iata: 'CPH', name: 'Copenhagen Kastrup Airport' },
    ],
  }] }));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.aircraft-row').filter({ hasText: 'VECTOR' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Show full details' }).click();
  const summary = page.locator('.flight-route-summary');
  await expect(summary).toContainText('AMS');
  await expect(summary).toContainText('CPH');
  await expect(summary).toContainText('Unconfirmed');
  await expect(summary).toContainText('1 Stop');
  await expect(page.locator('.route-airports')).toContainText('Frankfurt Airport');
  await expect(page.locator('.route-warning')).toBeVisible();
  const routeBox = (await page.locator('.route-card').boundingBox())!;
  const profileBox = (await page.locator('.flight-profile').boundingBox())!;
  expect(routeBox.y + routeBox.height).toBeLessThanOrEqual(profileBox.y);
});

test('startup recovers automatically from unavailable configuration and receiver', async ({ page, radar }) => {
  radar.configFailures = 1;
  radar.receiverFailures = 1;
  await page.goto('/');
  await expect(page.locator('.statusbar')).toContainText('Reconnecting automatically');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await expect(page.locator('.live-pill')).toHaveClass(/live/);
});

test('outdated or unavailable data is indicated and recovers without losing aircraft', async ({ page, radar }) => {
  radar.timestamp = Date.now() / 1_000 - 90;
  await page.goto('/');
  await expect(page.locator('.live-pill')).toHaveClass(/stale/);
  await expect(page.locator('.feed-freshness')).toContainText('Last data:');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  const marker = page.locator('.aircraft-map-marker').filter({ hasText: 'VECTOR' });
  const lastKnownPosition = (await marker.boundingBox())!;
  const requests = radar.aircraftRequests;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThan(requests + 1);
  const stalePosition = (await marker.boundingBox())!;
  expect(Math.abs(stalePosition.x - lastKnownPosition.x)).toBeLessThan(1);
  expect(Math.abs(stalePosition.y - lastKnownPosition.y)).toBeLessThan(1);
  radar.timestamp = undefined;
  await expect(page.locator('.live-pill')).toHaveClass(/live/);
  radar.aircraftUnavailable = true;
  await expect(page.locator('.live-pill')).toHaveClass(/stale/);
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  radar.aircraftUnavailable = false;
  await expect(page.locator('.live-pill')).toHaveClass(/live/);
  await expect(page.locator('.feed-freshness')).toHaveCount(0);
});

test('selection, favorites, leg traces and smooth following work together', async ({ page, radar, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.aircraft-row').filter({ hasText: 'VECTOR' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Show full details' }).click();
  await expect(page.locator('.detail-panel .flight-title')).toContainText('VECTOR');
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Follow aircraft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop following' })).toHaveAttribute('aria-pressed', 'true');
  if (isMobile) await page.locator('.mobile-details-collapse').click();
  await expect.poll(() => radar.traceRequests.length).toBeGreaterThan(0);
  await expect(page.locator('.map-leg-trace-overlay line').first()).toBeVisible();

  const marker = page.locator('.aircraft-map-marker.selected');
  const map = page.locator('.maplibre-surface');
  // Following must actually keep the selected marker centered as new positions arrive.
  await expect.poll(async () => {
    const [plane, canvas] = await Promise.all([marker.boundingBox(), map.boundingBox()]);
    return plane && canvas ? Math.abs(plane.x + plane.width / 2 - canvas.x - canvas.width / 2) : Infinity;
  }).toBeLessThan(8);
  radar.longitudeOffset = 0.025;
  const requests = radar.aircraftRequests;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThan(requests + 2);
  await expect.poll(async () => {
    const [plane, canvas] = await Promise.all([marker.boundingBox(), map.boundingBox()]);
    return plane && canvas ? Math.abs(plane.x + plane.width / 2 - canvas.x - canvas.width / 2) : Infinity;
  }).toBeLessThan(8);
});

test('receiver replay scrubs, changes speed and period, then returns to live', async ({ page, radar }) => {
  // Always start two minutes into a half-hour block, so opening history loads a completed receiver block.
  const now = new Date('2026-01-15T12:32:00Z');
  await page.clock.setFixedTime(now);
  radar.timestamp = now.getTime() / 1_000;
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const timeline = page.getByRole('slider', { name: 'History timeline' });
  await expect(timeline).toBeEnabled();
  await timeline.fill('0');
  const initial = await page.locator('.history-playback time').textContent();
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('5');
  await page.locator('.history-play').click();
  await expect(page.locator('.history-play')).toHaveAttribute('aria-label', 'Pause');
  await expect(page.locator('.history-playback time')).not.toHaveText(initial!);
  await page.locator('.history-play').click();
  await page.getByRole('button', { name: 'Previous 30 minutes' }).click();
  await expect.poll(() => new Set(radar.replayRequests).size).toBe(2);
  await expect(timeline).toBeEnabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.history-panel')).not.toBeVisible();
  await expect(page.locator('.live-pill')).toHaveClass(/live/);
});

test('menus fit the viewport, dismiss outside, and themes keep the map working', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await page.locator('.settings-menu summary').click();
  const settings = page.locator('.settings-popover');
  await expect(settings).toBeVisible();
  for (const theme of ['daylight', 'midnight', 'radar', 'amber', 'vector']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  }
  for (const style of ['light', 'dark', 'contrast', 'standard', 'vector']) {
    await page.getByRole('combobox', { name: 'Map style', exact: true }).selectOption(style);
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  }
  await page.keyboard.press('Escape');
  await expect(settings).not.toBeVisible();
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.filter-menu > summary').click();
  const filter = page.locator('.filter-popover');
  await expect(filter).toBeVisible();
  const bounds = (await filter.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  await page.locator('.brand').click();
  await expect(filter).not.toBeVisible();
  await page.locator('.settings-menu summary').click();
  await expect(settings).toBeVisible();
  await page.locator('.brand').click();
  await expect(settings).not.toBeVisible();
});
