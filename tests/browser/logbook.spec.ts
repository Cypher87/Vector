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
      description: 'Airbus A320', firstSeen: now - 86400_000, lastSeen: now - i * 1000, visits: i === 1 ? 1 : 3,
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
        ...(hex ? { visits: [
          { firstSeen: now - 3600_000, lastSeen: now - 1000, callsigns: 'VECTOR0' },
          { firstSeen: now - 86400_000, lastSeen: now - 86400_000 + 72 * 60_000, callsigns: 'VECTOR2' },
          { firstSeen: now - 2 * 86400_000, lastSeen: now - 2 * 86400_000, callsigns: '' },
        ] } : {}) } });
    });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: nl ? 'Open logboek' : 'Open logbook', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: nl ? 'Logboek' : 'Logbook', exact: true });
    await expect(dialog.getByRole('searchbox')).toBeFocused();
    const surfaceStyle = (element: Element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderTopColor, radius: style.borderRadius, shadow: style.boxShadow };
    };
    expect(await dialog.evaluate(surfaceStyle)).toEqual(await page.locator('.settings-popover').evaluate(surfaceStyle));
    await expect(dialog.getByRole('searchbox')).toHaveCSS('outline-width', '2px');
    await expect(dialog.locator('.logbook-entry')).toHaveCount(10);
    await expect(dialog.locator('footer nav > span')).toHaveText('1 / 4');
    const firstEntry = dialog.locator('.logbook-entry').first();
    expect((await firstEntry.boundingBox())!.height).toBeLessThanOrEqual(isMobile ? 115 : 80);
    if (!isMobile) {
      const heading = (await firstEntry.locator('.logbook-entry-heading').boundingBox())!;
      const times = (await firstEntry.locator('.logbook-times').boundingBox())!;
      expect(Math.abs(heading.y + heading.height / 2 - times.y - times.height / 2)).toBeLessThan(1);
    }
    await expect(dialog.locator('.logbook-times').first().locator('dt')).toHaveText(nl ? ['Eerst waargenomen', 'Laatst waargenomen'] : ['First seen', 'Last seen']);
    await expect(dialog.getByRole('combobox', { name: nl ? 'Sorteren' : 'Sort', exact: true }).locator('option:checked')).toHaveText(nl ? 'Laatst waargenomen' : 'Last seen');
    await expect(dialog.locator('.logbook-visit-count').nth(0)).toHaveText(nl ? '3waarnemingen' : '3sightings');
    await expect(dialog.locator('.logbook-visit-count').nth(1)).toHaveText(nl ? '1waarneming' : '1sighting');
    await expect(dialog.locator('header p')).toHaveCount(0);
    await expect(dialog.locator('.logbook-summary')).toHaveText(nl ? '36 toestellen' : '36 aircraft');
    await expect(dialog.locator('footer')).not.toContainText(nl ? 'Bijgehouden sinds' : 'Recording since');
    await page.screenshot({ path: testInfo.outputPath(`logbook-list-${language}.png`) });
    const initialHeader = await dialog.locator('header').boundingBox();
    await dialog.locator('.logbook-entry').last().scrollIntoViewIfNeeded();
    const listScroll = await dialog.locator('.logbook-content').evaluate((element) => element.scrollTop);
    if (isMobile) expect(listScroll).toBeGreaterThan(0);
    else expect(listScroll).toBe(0);
    expect(await dialog.locator('header').boundingBox()).toEqual(initialHeader);
    await expect(dialog.getByRole('button', { name: nl ? 'Sluit logboek' : 'Close logbook' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: nl ? 'Volgende pagina' : 'Next page' })).toBeInViewport({ ratio: 1 });
    const favorite = dialog.getByRole('button', { name: nl ? 'Favoriet: TEST-1' : 'Favorite: TEST-1', exact: true });
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft') || '[]'))).toContain('abc123');
    const nextPage = dialog.getByRole('button', { name: nl ? 'Volgende pagina' : 'Next page' });
    const previousPage = dialog.getByRole('button', { name: nl ? 'Vorige pagina' : 'Previous page' });
    for (const pageIndex of [2, 3, 4]) {
      await nextPage.click();
      await expect(dialog.locator('footer nav > span')).toHaveText(`${pageIndex} / 4`);
      await expect(dialog.locator('.logbook-entry')).toHaveCount(pageIndex === 4 ? 6 : 10);
      await expect(dialog.locator('.logbook-identity').first()).toContainText(`PH-TEST${(pageIndex - 1) * 10}`);
      expect(await dialog.locator('.logbook-content').evaluate((element) => element.scrollTop)).toBe(0);
    }
    await expect(nextPage).toBeDisabled();
    await previousPage.click();
    await expect(dialog.locator('footer nav > span')).toHaveText('3 / 4');
    await expect(dialog.locator('.logbook-identity').first()).toContainText('PH-TEST20');
    await nextPage.click();
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
    await expect(dialog.locator('.logbook-entry')).toHaveCount(10);
    await expect(dialog.locator('footer nav > span')).toHaveText('1 / 4');
    await favorite.click();
    await dialog.getByRole('searchbox').fill('test-1');
    await expect(dialog.locator('.logbook-entry')).toHaveCount(1);
    await dialog.getByRole('combobox', { name: nl ? 'Periode' : 'Period', exact: true }).selectOption('7');
    await expect.poll(() => requests.at(-1)).toContain('days=7');
    await dialog.getByRole('combobox', { name: nl ? 'Sorteren' : 'Sort', exact: true }).selectOption({ label: nl ? 'Meeste waarnemingen' : 'Most sightings' });
    await expect.poll(() => requests.at(-1)).toContain('sort=visits');
    for (const field of await dialog.locator('.logbook-select').all()) {
      const selectBox = (await field.locator('select').boundingBox())!;
      const chevronBox = (await field.locator('.vector-icon').boundingBox())!;
      expect(selectBox.x + selectBox.width - chevronBox.x - chevronBox.width).toBeGreaterThanOrEqual(11);
      expect(await field.locator('select').evaluate((select) => getComputedStyle(select).appearance)).toBe('none');
      expect(await field.locator('select').evaluate((select: HTMLSelectElement) => {
        const style = getComputedStyle(select);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        context.font = style.font;
        const available = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return Array.from(select.options).every((option) => context.measureText(option.text).width <= available);
      }), 'All dropdown labels fit beside the chevron').toBe(true);
    }
    await dialog.locator('.logbook-identity').click();
    await expect(dialog.locator('.logbook-visits ol')).toContainText('VECTOR0');
    await expect(dialog.locator('.logbook-visits h3')).toHaveText(nl ? 'Recente waarnemingen' : 'Recent sightings');
    await expect(dialog.locator('.logbook-visit-duration dt')).toHaveText(Array(3).fill(nl ? 'Duur' : 'Duration'));
    await expect(dialog.locator('.logbook-visit-duration dd')).toHaveText(['59 min', nl ? '1 u 12 min' : '1 h 12 min', '< 1 min']);
    await expect(dialog.locator('.logbook-visits p')).toHaveCount(0);
    await expect(dialog.locator('footer')).toHaveCount(0);
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
      await dialog.locator('.logbook-identity').click();
      await expect(dialog.locator('.logbook-visit-duration dd')).toHaveCount(3);
      const narrowHeader = await dialog.locator('header').boundingBox();
      await dialog.locator('.logbook-visit-duration dd').last().scrollIntoViewIfNeeded();
      await expect(dialog.locator('.logbook-visit-duration dd').last()).toBeInViewport({ ratio: 1 });
      expect(await dialog.locator('header').boundingBox()).toEqual(narrowHeader);
      expect(await dialog.locator('.logbook-content').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`logbook-narrow-${language}.png`) });
      await page.setViewportSize({ width: 740, height: 360 });
      await dialog.locator('.logbook-visit-duration dd').last().scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('button', { name: nl ? 'Sluit logboek' : 'Close logbook' })).toBeInViewport({ ratio: 1 });
      await expect(dialog.locator('.logbook-visit-duration dd').last()).toBeInViewport({ ratio: 1 });
      expect(await dialog.locator('.logbook-content').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`logbook-landscape-${language}.png`) });
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
  await expect(dialog).toContainText('No sightings yet');
  await expect(dialog.locator('.logbook-summary')).toContainText('No recent reception');
  await expect(dialog).not.toContainText('The logbook builds up from first use.');
  await dialog.getByRole('searchbox').fill('unknown');
  await expect(dialog).toContainText('No aircraft found');
  await expect(dialog.locator('.logbook-empty p')).toHaveCount(0);
  offline = true;
  await dialog.getByRole('searchbox').fill('new search');
  await expect(dialog.getByRole('alert')).toHaveText('Logbook unavailable.');
  await expect(dialog.locator('footer')).toHaveCount(0);
  await expect(dialog).not.toContainText('No aircraft found');
  await page.mouse.click(1, 1);
  await expect(dialog).toHaveCount(0);
});
