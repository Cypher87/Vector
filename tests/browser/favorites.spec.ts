import { test, expect } from './radar-fixture';

for (const language of ['en', 'nl']) {
  test(`favorite overview includes offline aircraft, searches, pages and selects outside filters in ${language}`, async ({ page, isMobile }, testInfo) => {
    const nl = language === 'nl';
    if (isMobile) await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ colorScheme: nl ? 'light' : 'dark' });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      if (localStorage.getItem('favorites-test-ready')) return;
      localStorage.setItem('favorites-test-ready', '1');
      localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['abc123', 'def456', '~123456', 'ffffff',
        ...Array.from({ length: 10 }, (_, i) => `a000${i.toString().padStart(2, '0')}`)]));
      localStorage.setItem('vector.aircraftFilters', JSON.stringify({ categories: ['helicopter'] }));
    }, language);
    await page.route('**/api/aircraft-metadata?*', (route) => route.fulfill({ json: { aircraft: {
      abc123: { registration: 'TEST-1', aircraftType: 'A320' },
      def456: { registration: 'TEST-2', aircraftType: 'BALL' },
      ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a000${i.toString().padStart(2, '0')}`, { registration: `PH-OFF${i}`, aircraftType: 'C172' }])),
    } } }));
    await page.goto('/');
    if (isMobile) await page.locator('.mobile-list-button').click();
    await page.locator('.search-box input').fill('not-visible-on-map');
    await expect(page.locator('.aircraft-row')).toHaveCount(0);
    const trigger = page.getByRole('button', { name: nl ? 'Open favorieten' : 'Open favorites', exact: true });
    await expect(trigger).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: nl ? 'Favorieten' : 'Favorites', exact: true });
    const search = dialog.getByRole('searchbox');
    await expect(search).toBeFocused();
    await expect(dialog.locator('h2 span')).toHaveText('14');
    await expect(dialog.locator('.favorites-list li')).toHaveCount(10);
    await expect(dialog.locator('.favorites-list')).toContainText('PH-OFF0');
    const surfaceStyle = (element: Element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderTopColor, radius: style.borderRadius, shadow: style.boxShadow };
    };
    expect(await dialog.evaluate(surfaceStyle)).toEqual(await page.locator('.settings-popover').evaluate(surfaceStyle));
    await page.screenshot({ path: testInfo.outputPath(`favorites-${language}.png`) });
    await dialog.getByRole('button', { name: nl ? 'Volgende pagina' : 'Next page' }).click();
    await expect(dialog.locator('.favorites-list li')).toHaveCount(4);
    await expect(dialog.locator('nav > span')).toHaveText('2 / 2');
    await search.fill('PH-OFF3');
    await expect(dialog.locator('.favorites-list li')).toHaveCount(1);
    await expect(dialog.locator('.favorites-identity')).toContainText(nl ? 'Niet live' : 'Not live');
    await expect(dialog.locator('.favorites-view')).toHaveCount(0);
    await dialog.getByRole('button', { name: `${nl ? 'Verwijder uit favorieten' : 'Remove from favorites'}: PH-OFF3` }).click();
    await expect(dialog.locator('.favorites-list li')).toHaveCount(0);
    await expect(search).toBeFocused();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.favoriteAircraft')!))).not.toContain('a00003');
    await search.fill('ffffff');
    await expect(dialog.locator('.favorites-list li')).toHaveCount(1);
    await expect(dialog.locator('.favorites-identity strong')).toHaveText('FFFFFF');
    await search.fill('~123456');
    await expect(dialog.locator('.favorites-list li')).toHaveCount(1);
    await search.fill('TEST-1');
    await expect(dialog.locator('.favorites-view')).toBeVisible();
    await expect(dialog.locator('.favorites-identity small')).toHaveText('Live');
    await dialog.locator('.favorites-view').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.search-box input')).toHaveValue('');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await expect(page.locator('.mobile-aircraft-summary strong, .detail-panel h2').first()).toContainText(/VECTOR\s*01/);
    if (isMobile) await page.locator('.mobile-list-button').click();
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.reload();
    if (isMobile) await page.locator('.mobile-list-button').click();
    await trigger.click();
    await expect(dialog.locator('h2 span')).toHaveText('13');
    await search.fill('PH-OFF3');
    await expect(dialog.locator('.favorites-list li')).toHaveCount(0);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (isMobile) {
      await search.fill('');
      await page.setViewportSize({ width: 740, height: 360 });
      await dialog.locator('.favorites-list li').last().scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('button', { name: nl ? 'Sluit favorieten' : 'Close favorites' })).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole('button', { name: nl ? 'Volgende pagina' : 'Next page' })).toBeInViewport({ ratio: 1 });
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`favorites-landscape-${language}.png`) });
    }
    await page.mouse.click(1, 1);
    await expect(dialog).toHaveCount(0);
  });
}

test('favorites remain manageable without metadata or receiver data, and empty state is concise', async ({ page, isMobile, radar }) => {
  radar.aircraftUnavailable = true;
  await page.addInitScript(() => localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['ffffff'])));
  let failed = true;
  await page.route('**/api/aircraft-metadata?*', (route) => failed ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: { aircraft: { ffffff: { registration: 'PH-RECOVERED', aircraftType: 'C172' } } } }));
  await page.goto('/');
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.getByRole('button', { name: 'Open favorites', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Favorites', exact: true });
  await expect(dialog.locator('.favorites-identity strong')).toHaveText('FFFFFF');
  await expect(dialog.locator('.favorites-identity small')).toHaveText('Not live');
  await expect(dialog.locator('.favorites-view')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText('Aircraft information unavailable.');
  failed = false;
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.locator('.favorites-identity strong')).toHaveText('PH-RECOVERED');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Remove from favorites: PH-RECOVERED' }).click();
  await expect(dialog).toContainText('No favorites yet');
  await expect(dialog.locator('h2 span')).toHaveText('0');
  await expect(dialog.locator('footer')).toHaveCount(0);
});
