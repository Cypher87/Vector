import { test, expect, openFilterGroup } from './radar-fixture';
import { applySyncPreferencePatch, type SyncPreferences } from '../../src/sync/preferences';

test.beforeEach(async ({ radar }) => {
  radar.traceUnavailable = true;
  radar.extraAircraft = [
    { hex: 'a00010', flight: 'SORT10', alt_baro: 1000, gs: 100, lat: 52.3, lon: 4.8, seen: 10 },
    { hex: 'a00002', flight: 'SORT2', alt_baro: 9000, gs: 300, lat: 52.5, lon: 4.8, seen: 0 },
    { hex: 'a00003', flight: 'SORT3', lat: 52.6, lon: 4.8, seen: 20 },
    { hex: 'a00004', flight: 'SORT4', alt_baro: 'ground', gs: 0, lat: 52.7, lon: 4.8, seen: 30 },
  ];
});

test('criteria, direction and favorite priority sort reliably and survive reload', async ({ page, radar, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
  await page.addInitScript(() => localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['a00010', 'a00003'])));
  await page.goto('/');
  await expect(page.locator('.aircraft-row')).toHaveCount(6);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.search-box input').fill('SORT');
  const names = page.locator('.aircraft-identity strong');
  const order = (ids: number[]) => expect(names).toHaveText(ids.map((id) => `SORT${id}`));
  const select = page.locator('.sort-select');
  const direction = page.locator('.sort-direction');
  const favorite = page.getByRole('button', { name: 'Favorites first', exact: true });
  await order([2, 10, 4, 3]);
  await select.selectOption('speed');
  await expect(direction).toHaveAccessibleName('Sort direction: Fastest first');
  await order([2, 10, 4, 3]);
  await expect(page.locator('.aircraft-reading strong').first()).toContainText('556 km/h');
  await direction.click();
  await order([4, 10, 2, 3]);
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await order([10, 4, 2, 3]);
  // The unknown favorite remains below measured speeds; no aircraft are filtered out.
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(4);
  await expect(page.locator('.aircraft-row.favorite')).toHaveCount(2);
  await favorite.click();
  await select.selectOption('callsign');
  await order([2, 3, 4, 10]);
  await direction.click();
  await order([10, 4, 3, 2]);
  await select.selectOption('seen');
  await order([2, 10, 3, 4]);
  await direction.click();
  await order([4, 3, 10, 2]);
  await select.selectOption('distance');
  await order([10, 2, 3, 4]);
  await direction.click();
  await order([4, 3, 2, 10]);
  await expect(page.locator('.aircraft-reading strong').first()).toContainText('km');
  // A reordered feed must not undo the selected ordering.
  radar.extraAircraft.reverse();
  const nextFeed = radar.aircraftRequests + 2;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  await order([4, 3, 2, 10]);
  await favorite.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vector.aircraftSort'))).toBe('distance-desc');
  await page.reload();
  await expect(page.locator('.aircraft-row')).toHaveCount(6);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.search-box input').fill('SORT');
  await expect(select).toHaveValue('distance');
  await expect(direction).toHaveAccessibleName('Sort direction: Farthest first');
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await order([3, 10, 4, 2]);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath('sorting.png') });
});

test('saved views include direction and favorites while legacy views stay compatible', async ({ page, isMobile }) => {
  await page.addInitScript(() => localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify([
    { id: 'legacy', name: 'Legacy', filters: {}, sort: 'callsign-asc' },
  ])));
  await page.goto('/');
  await expect(page.locator('.aircraft-row')).toHaveCount(6);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.sort-select').selectOption('speed');
  await page.locator('.sort-direction').click();
  await page.locator('.sort-favorites').click();
  await page.locator('.filter-menu > summary').click();
  await openFilterGroup(page, 'presets');
  const filter = page.locator('.filter-popover');
  await filter.getByRole('button', { name: 'Save current', exact: true }).click();
  await filter.getByRole('textbox', { name: 'Saved view name', exact: true }).fill('Slow favorites');
  await filter.getByRole('button', { name: 'Save', exact: true }).click();
  await filter.locator('.filter-preset-apply').filter({ hasText: 'Legacy' }).click();
  await expect(page.locator('.sort-select')).toHaveValue('callsign');
  await expect(page.locator('.sort-direction')).toHaveAttribute('data-direction', 'asc');
  await expect(page.locator('.sort-favorites')).toHaveAttribute('aria-pressed', 'false');
  await filter.locator('.filter-preset-apply').filter({ hasText: 'Slow favorites' }).click();
  await expect(page.locator('.sort-select')).toHaveValue('speed');
  await expect(page.locator('.sort-direction')).toHaveAttribute('data-direction', 'asc');
  await expect(page.locator('.sort-favorites')).toHaveAttribute('aria-pressed', 'true');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!));
  expect(stored.find((preset: { name: string }) => preset.name === 'Slow favorites')).toMatchObject({ sort: 'speed-asc', favoritesFirst: true });
});

test('paired sort preferences synchronize and Dutch controls fit dark and daylight layouts', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  let preferences: SyncPreferences = { aircraftSort: 'seen-desc', aircraftFavoritesFirst: true, language: 'nl' };
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
  await expect(page.locator('.sort-direction')).toHaveAccessibleName('Sorteerrichting: Oudste eerst');
  const select = page.locator('.sort-select');
  await expect(select).toHaveValue('seen');
  await expect(page.locator('.sort-favorites')).toHaveAttribute('aria-pressed', 'true');
  const controls = page.locator('.aircraft-sort-controls');
  expect(await controls.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(select).toHaveCSS('appearance', 'none');
  // Longest label has actual room inside the select, excluding padding and the chevron.
  expect(await select.evaluate((element: HTMLSelectElement) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      >= context.measureText(element.selectedOptions[0].text).width;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sorting-nl-dark.png') });
  await select.selectOption('speed');
  await page.locator('.sort-direction').click();
  await page.locator('.sort-favorites').click();
  await expect.poll(() => preferences.aircraftSort).toBe('speed-asc');
  await expect.poll(() => preferences.aircraftFavoritesFirst).toBe(false);
  preferences = { ...preferences, theme: 'light' };
  await page.reload();
  if (isMobile) await page.locator('.mobile-list-button').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(select).toHaveValue('speed');
  await expect(page.locator('.sort-direction')).toHaveAccessibleName('Sorteerrichting: Langzaamste eerst');
  await expect(page.locator('.sort-favorites')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('sorting-nl-daylight.png') });
});
