import { test, expect } from './radar-fixture';

for (const language of ['en', 'nl']) {
  test(`logbook searches, pages, manages favorites and opens live aircraft in ${language}`, async ({ page, isMobile }, testInfo) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((language) => localStorage.setItem('vector.language', language), language);
    await page.emulateMedia({ colorScheme: language === 'nl' ? 'light' : 'dark' });
    const nl = language === 'nl';
    const now = Date.now();
    const requests: string[] = [];
    const entries = Array.from({ length: 36 }, (_, i) => ({
      hex: i === 0 ? 'abc123' : i.toString(16).padStart(6, '0'),
      registration: i === 0 ? 'TEST-1' : `PH-TEST${i}`, aircraftType: 'A320', callsign: `VECTOR${i}`,
      description: 'Airbus A320', firstSeen: now - 86400_000, lastSeen: now - i * 1000, visits: 3,
    }));
    await page.route('**/api/logbook?*', async (route) => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(params.toString());
      const search = (params.get('q') || '').toLowerCase();
      const hex = params.get('hex');
      const favoriteIds: string[] | undefined = route.request().method() === 'POST' ? route.request().postDataJSON().favorites : undefined;
      const matches = entries.filter((entry) => (!hex || hex === entry.hex)
        && (favoriteIds === undefined || favoriteIds.includes(entry.hex))
        && `${entry.registration} ${entry.callsign} ${entry.aircraftType} ${entry.hex}`.toLowerCase().includes(search));
      const pageIndex = Math.min(Number(params.get('page') || 1), Math.max(1, Math.ceil(matches.length / 30)));
      await route.fulfill({ json: { entries: matches.slice((pageIndex - 1) * 30, pageIndex * 30), total: matches.length,
        days: Number(params.get('days') || 90), page: pageIndex, pageSize: 30, retentionDays: 90, startedAt: now - 2 * 86400_000, updatedAt: now,
        ...(hex ? { visits: [{ firstSeen: now - 3600_000, lastSeen: now - 1000, callsigns: 'VECTOR0' }] } : {}) } });
    });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: nl ? 'Open logboek' : 'Open logbook', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: nl ? 'Logboek' : 'Logbook', exact: true });
    await expect(dialog.getByRole('searchbox')).toBeFocused();
    await expect(dialog.locator('.logbook-entry')).toHaveCount(30);
    const favorite = dialog.getByRole('button', { name: nl ? 'Favoriet: TEST-1' : 'Favorite: TEST-1', exact: true });
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft') || '[]'))).toContain('abc123');
    await dialog.getByRole('button', { name: nl ? 'Volgende pagina' : 'Next page' }).click();
    await expect(dialog.locator('.logbook-entry')).toHaveCount(6);
    const favoritesFilter = dialog.getByRole('button', { name: nl ? 'Alleen favorieten' : 'Favorites only', exact: true });
    await favoritesFilter.click();
    await expect(favoritesFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('.logbook-entry')).toHaveCount(1);
    await expect(dialog.locator('.logbook-identity')).toContainText('TEST-1');
    await expect(dialog.getByRole('button', { name: nl ? 'Volgende pagina' : 'Next page' })).toHaveCount(0);
    await favorite.click();
    await expect(dialog.locator('.logbook-entry')).toHaveCount(0);
    await expect(dialog).toContainText(nl ? 'Geen favoriete toestellen gevonden' : 'No favorite aircraft found');
    await favoritesFilter.click();
    await expect(dialog.locator('.logbook-entry')).toHaveCount(30);
    await favorite.click();
    await dialog.getByRole('searchbox').fill('test-1');
    await expect(dialog.locator('.logbook-entry')).toHaveCount(1);
    await dialog.getByRole('combobox', { name: nl ? 'Periode' : 'Period', exact: true }).selectOption('7');
    await expect.poll(() => requests.at(-1)).toContain('days=7');
    await dialog.getByRole('combobox', { name: nl ? 'Sorteren' : 'Sort', exact: true }).selectOption('visits');
    await expect.poll(() => requests.at(-1)).toContain('sort=visits');
    for (const field of await dialog.locator('.logbook-select').all()) {
      const selectBox = (await field.locator('select').boundingBox())!;
      const chevronBox = (await field.locator('.vector-icon').boundingBox())!;
      expect(selectBox.x + selectBox.width - chevronBox.x - chevronBox.width).toBeGreaterThanOrEqual(11);
      expect(await field.locator('select').evaluate((select) => getComputedStyle(select).appearance)).toBe('none');
    }
    await dialog.locator('.logbook-identity').click();
    await expect(dialog.locator('.logbook-visits ol')).toContainText('VECTOR0');
    await page.screenshot({ path: testInfo.outputPath(`logbook-${language}.png`) });
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: nl ? 'Bekijk live' : 'View live', exact: false }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.detail-panel')).toContainText('VECTOR01');
    await trigger.click();
    await expect(dialog.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    if (isMobile) {
      await page.setViewportSize({ width: 320, height: 640 });
      await expect(trigger).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await trigger.click();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`logbook-narrow-${language}.png`) });
    }
  });
}

test('logbook distinguishes empty results and offline service without showing stale searches', async ({ page }) => {
  let offline = false;
  await page.route('**/api/logbook?*', (route) => offline
    ? route.fulfill({ status: 503, json: { error: 'logbook_unavailable' } })
    : route.fulfill({ json: { entries: [], total: 0, page: 1, pageSize: 30, days: 90, retentionDays: 90, startedAt: Date.now(), updatedAt: null } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open logbook' }).click();
  const dialog = page.getByRole('dialog', { name: 'Logbook' });
  await expect(dialog).toContainText('No observations yet');
  await expect(dialog).not.toContainText('The logbook builds up from first use.');
  await dialog.getByRole('searchbox').fill('unknown');
  await expect(dialog).toContainText('No aircraft found');
  offline = true;
  await dialog.getByRole('searchbox').fill('new search');
  await expect(dialog.getByRole('alert')).toContainText('logbook is unavailable');
  await expect(dialog.locator('footer')).toHaveCount(0);
  await expect(dialog).not.toContainText('No aircraft found');
  await page.mouse.click(1, 1);
  await expect(dialog).toHaveCount(0);
});
