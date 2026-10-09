import { test, expect } from './radar-fixture';
import { applySyncPreferencePatch, type SyncPreferences } from '../../src/sync/preferences';

for (const language of ['en', 'nl']) {
  test(`offline callsigns can be added, matched, persisted and removed with confirmation in ${language}`, async ({ page, isMobile, radar }, testInfo) => {
    const nl = language === 'nl';
    if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ colorScheme: nl ? 'light' : 'dark' });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      if (localStorage.getItem('callsign-test-ready')) return;
      localStorage.setItem('callsign-test-ready', '1');
      localStorage.setItem('vector.favoriteAircraft', '["abc123"]');
      localStorage.setItem('vector.aircraftFilters', '{"favoritesOnly":true}');
    }, language);
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    if (isMobile) await page.locator('.mobile-list-button').click();
    const trigger = page.getByRole('button', { name: nl ? 'Open favorieten' : 'Open favorites', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: nl ? 'Favorieten' : 'Favorites', exact: true });
    const input = dialog.getByRole('textbox', { name: nl ? 'Callsign toevoegen' : 'Add callsign', exact: true });
    const add = dialog.getByRole('button', { name: nl ? 'Toevoegen' : 'Add', exact: true });
    await expect(add).toBeDisabled();
    await input.fill(' klm 123 ');
    await input.press('Enter');
    await expect(dialog.locator('h2 span')).toHaveText('2');
    await expect(dialog.locator('.favorites-identity strong')).toHaveText('KLM123');
    await expect(dialog.locator('.favorites-identity small')).toHaveText(nl ? 'Niet live' : 'Not live');
    await expect(dialog.locator('.favorites-view')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteCallsigns')!))).toEqual(['KLM123']);
    await input.fill('KLM123');
    await add.click();
    await expect(dialog.getByRole('alert')).toContainText(nl ? 'al favoriet' : 'already a favorite');
    await expect(dialog.locator('h2 span')).toHaveText('2');
    await input.fill('KLM*');
    await add.click();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(add).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`callsign-offline-${language}.png`) });
    await page.reload();
    if (isMobile) await page.locator('.mobile-list-button').click();
    await trigger.click();
    await dialog.getByRole('searchbox').fill('KLM123');
    await expect(dialog.locator('.favorites-identity strong')).toHaveText('KLM123');
    const contact = { hex: 'fed123', flight: 'klm123', r: 'PH-NEW', t: 'A320', lat: 52.35, lon: 4.85, alt_baro: 10000, seen: 0, type: 'adsb_icao' };
    radar.extraAircraft = [contact];
    await expect(dialog.locator('.favorites-identity small')).toHaveText('Live');
    await expect(dialog.locator('.favorites-identity')).toContainText('PH-NEW');
    await expect(dialog.locator('.favorites-view')).toBeVisible();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.radarEvents') || '[]').filter((event: { kind: string }) => event.kind === 'favorite-entered').length)).toBe(1);
    radar.extraAircraft = [{ ...contact, flight: 'KLM1234' }];
    await expect(dialog.locator('.favorites-identity small')).toHaveText(nl ? 'Niet live' : 'Not live');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    radar.extraAircraft = [{ ...contact, hex: 'fed456', r: 'PH-NEXT' }];
    await expect(dialog.locator('.favorites-identity')).toContainText('PH-NEXT');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await dialog.locator('.favorites-view').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.mobile-aircraft-summary strong, .detail-panel h2').first()).toContainText(/KLM\s*123/i);
    await expect(page.locator('.favorite-action')).toHaveAttribute('aria-pressed', 'true');
    if (isMobile) await page.locator('.mobile-list-button').click();
    await trigger.click();
    const remove = dialog.getByRole('button', { name: `${nl ? 'Verwijder uit favorieten' : 'Remove from favorites'}: KLM123`, exact: true });
    await remove.click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByRole('button', { name: nl ? 'Annuleren' : 'Cancel', exact: true }).click();
    await expect(remove).toBeVisible();
    await remove.click();
    await confirmation.getByRole('button', { name: nl ? 'Verwijderen' : 'Remove', exact: true }).click();
    await expect(dialog.locator('h2 span')).toHaveText('1');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteCallsigns')!))).toEqual([]);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft')!))).toEqual(['abc123']);
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
  });
}

test('callsign favorites synchronize independently from fixed aircraft favorites', async ({ page, isMobile }) => {
  let preferences: SyncPreferences = { language: 'en', favoriteAircraft: ['abc123'], favoriteCallsigns: ['BAW456'] };
  let revision = 1;
  await page.route('**/api/sync/session', (route) => route.fulfill({ json: {
    connected: true, deviceId: 'test-device', profileId: 'test-profile', preferences, revision,
  } }));
  await page.route('**/api/sync/events', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/sync/preferences', (route) => {
    preferences = applySyncPreferencePatch(preferences, route.request().postDataJSON().patch);
    return route.fulfill({ json: { preferences, revision: ++revision } });
  });
  await page.goto('/');
  if (isMobile) await page.locator('.mobile-list-button').click();
  const open = page.getByRole('button', { name: 'Open favorites', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Favorites', exact: true });
  await expect(dialog.locator('.favorites-list')).toContainText('BAW456');
  await dialog.getByRole('textbox', { name: 'Add callsign', exact: true }).fill('KLM123');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => preferences.favoriteCallsigns).toEqual(['BAW456', 'KLM123']);
  expect(preferences.favoriteAircraft).toEqual(['abc123']);
  preferences = { ...preferences, favoriteCallsigns: [] };
  revision++;
  await page.reload();
  if (isMobile) await page.locator('.mobile-list-button').click();
  await open.click();
  await expect(dialog.locator('h2 span')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteCallsigns')!))).toEqual([]);
});

test('logbook favorite filters include callsigns and removing the rule does not add a fixed favorite', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vector.favoriteCallsigns', '["KLM123"]'));
  let filter: { favorites: string[]; favoriteCallsigns?: string[] } | undefined;
  await page.route('**/api/logbook?*', (route) => {
    filter = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    const entries = !filter || filter.favoriteCallsigns?.includes('KLM123') ? [{ hex: 'fed123', callsign: 'KLM123', registration: 'PH-OFF',
      aircraftType: 'A320', description: 'Airbus A320', firstSeen: Date.now() - 100000, lastSeen: Date.now() - 10000, visits: 1 }] : [];
    return route.fulfill({ json: { entries, total: entries.length, page: 1, pageSize: 30, days: 90,
      retentionDays: 90, startedAt: Date.now() - 100000, updatedAt: Date.now() } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open logbook', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Logbook', exact: true });
  await dialog.getByRole('button', { name: 'Favorites only', exact: true }).click();
  await expect.poll(() => filter).toEqual({ favorites: [], favoriteCallsigns: ['KLM123'] });
  await expect(dialog.locator('.logbook-favorite')).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('.logbook-favorite').click();
  await expect.poll(() => filter).toEqual({ favorites: [] });
  await expect(dialog.locator('.logbook-entry')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteCallsigns')!))).toEqual([]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft') || '[]'))).toEqual([]);
});
