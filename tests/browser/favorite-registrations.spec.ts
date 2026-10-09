import { test, expect } from './radar-fixture';
import { applySyncPreferencePatch, type SyncPreferences } from '../../src/sync/preferences';

for (const language of ['en', 'nl']) {
  test(`registration favorites persist offline and match independently of callsign in ${language}`, async ({ page, isMobile, radar }, testInfo) => {
    const nl = language === 'nl';
    if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ colorScheme: nl ? 'light' : 'dark' });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      localStorage.setItem('vector.aircraftFilters', '{"favoritesOnly":true}');
    }, language);
    await page.goto('/');
    if (isMobile) await page.locator('.mobile-list-button').click();
    const trigger = page.getByRole('button', { name: nl ? 'Open favorieten' : 'Open favorites', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: nl ? 'Favorieten' : 'Favorites', exact: true });
    const input = dialog.getByRole('textbox', { name: nl ? 'Callsign of registratie' : 'Callsign or registration', exact: true });
    const add = dialog.getByRole('button', { name: nl ? 'Toevoegen' : 'Add', exact: true });
    await input.fill(' ph-hlp ');
    await input.press('Enter');
    await expect(dialog.locator('.favorites-identity strong')).toHaveText('PH-HLP');
    await expect(dialog.locator('.favorites-identity small')).toHaveText(nl ? 'Niet live' : 'Not live');
    await expect(dialog.locator('.favorites-identity > span')).toHaveText(nl ? 'Registratie' : 'Registration');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteRegistrations')!))).toEqual(['PH-HLP']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteCallsigns') || '[]'))).toEqual([]);
    await input.fill('PH-HLP');
    await add.click();
    await expect(dialog.getByRole('alert')).toContainText(nl ? 'bestaat al' : 'already exists');
    await input.fill('PH--HLP');
    await add.click();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByRole('combobox').selectOption('registration');
    await expect(input).toHaveAttribute('placeholder', 'PH-HLP');
    await dialog.getByRole('searchbox').fill('PH-HLP');
    await input.fill('n123ab');
    await add.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteRegistrations')!))).toEqual(['N123AB', 'PH-HLP']);
    await expect(dialog.getByRole('searchbox')).toHaveValue('');
    await expect(dialog.locator('.favorites-identity strong')).toHaveText(['N123AB', 'PH-HLP']);
    await dialog.getByRole('searchbox').fill('PH-HLP');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(add).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('combobox')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`registration-offline-${language}.png`) });
    await page.reload();
    if (isMobile) await page.locator('.mobile-list-button').click();
    await trigger.click();
    await dialog.getByRole('searchbox').fill('PH-HLP');
    await expect(dialog.locator('.favorites-identity strong')).toHaveText('PH-HLP');
    const contact = { hex: 'fed123', flight: 'RESCUE1', r: 'PH-HLP', t: 'EC35', lat: 52.35, lon: 4.85, alt_baro: 1000, seen: 0, type: 'adsb_icao' };
    radar.extraAircraft = [contact];
    await expect(dialog.locator('.favorites-identity small')).toHaveText('Live');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.radarEvents') || '[]').filter((event: { kind: string }) => event.kind === 'favorite-entered').length)).toBe(1);
    radar.extraAircraft = [{ ...contact, flight: 'LIFELN1' }];
    await expect(dialog.locator('.favorites-identity')).toContainText('LIFELN1');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    radar.extraAircraft = [{ ...contact, flight: 'PHHLP', r: 'PH-OTHER' }];
    await expect(dialog.locator('.favorites-identity small')).toHaveText(nl ? 'Niet live' : 'Not live');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(0);
    radar.extraAircraft = [contact];
    await expect(dialog.locator('.favorites-view')).toBeVisible();
    await dialog.locator('.favorites-view').click();
    await expect(page.locator('.favorite-action')).toHaveAttribute('aria-pressed', 'true');
    if (isMobile) await page.locator('.mobile-list-button').click();
    await trigger.click();
    const remove = dialog.getByRole('button', { name: `${nl ? 'Verwijder uit favorieten' : 'Remove from favorites'}: PH-HLP`, exact: true });
    await remove.click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation.locator('p')).toHaveText('PH-HLP');
    await confirmation.getByRole('button', { name: nl ? 'Annuleren' : 'Cancel', exact: true }).click();
    await expect(remove).toBeVisible();
    await remove.click();
    await confirmation.getByRole('button', { name: nl ? 'Verwijderen' : 'Remove', exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteRegistrations')!))).toEqual(['N123AB']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft') || '[]'))).toEqual([]);
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(0);
  });
}

test('registration favorites synchronize without replacing callsigns or fixed favorites', async ({ page, isMobile }) => {
  let preferences: SyncPreferences = { language: 'en', favoriteAircraft: ['abc123'], favoriteCallsigns: ['KLM123'], favoriteRegistrations: ['N123AB'] };
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
  await expect(dialog.locator('.favorites-list')).toContainText('N123AB');
  await dialog.getByRole('textbox', { name: 'Callsign or registration', exact: true }).fill('PH-HLP');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => preferences.favoriteRegistrations).toEqual(['N123AB', 'PH-HLP']);
  expect(preferences.favoriteAircraft).toEqual(['abc123']);
  expect(preferences.favoriteCallsigns).toEqual(['KLM123']);
  preferences = { ...preferences, favoriteRegistrations: [] };
  revision++;
  await page.reload();
  if (isMobile) await page.locator('.mobile-list-button').click();
  await open.click();
  await expect(dialog.locator('h2 span')).toHaveText('2');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteRegistrations')!))).toEqual([]);
});

test('logbook registration favorites can be removed without adding a fixed aircraft favorite', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vector.favoriteRegistrations', '["PH-HLP"]'));
  let filter: { favorites: string[]; favoriteRegistrations?: string[] } | undefined;
  await page.route('**/api/logbook?*', (route) => {
    filter = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    const entries = !filter || filter.favoriteRegistrations?.includes('PH-HLP') ? [{ hex: 'fed123', callsign: 'LIFELN1', registration: 'PH-HLP',
      aircraftType: 'EC35', description: 'Helicopter', firstSeen: Date.now() - 100000, lastSeen: Date.now() - 10000, visits: 1 }] : [];
    return route.fulfill({ json: { entries, total: entries.length, page: 1, pageSize: 30, days: 90,
      retentionDays: 90, startedAt: Date.now() - 100000, updatedAt: Date.now() } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open logbook', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Logbook', exact: true });
  await dialog.getByRole('button', { name: 'Favorites only', exact: true }).click();
  await expect.poll(() => filter).toEqual({ favorites: [], favoriteRegistrations: ['PH-HLP'] });
  await expect(dialog.locator('.logbook-favorite')).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('.logbook-favorite').click();
  await expect.poll(() => filter).toEqual({ favorites: [] });
  await expect(dialog.locator('.logbook-entry')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft') || '[]'))).toEqual([]);
});
