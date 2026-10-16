import { test, expect, openFilterGroup } from './radar-fixture';
import type { Page } from '@playwright/test';

async function openAreas(page: Page, mobile: boolean) {
  if (mobile) await page.locator('.mobile-list-button').click();
  await page.locator('.filter-menu > summary').click();
  await openFilterGroup(page, 'area');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vector.aircraftWakes', 'false');
    localStorage.setItem('vector.aircraftMotion', 'false');
  });
});

test('draws a circle, saves an alert filter, reloads and toggles the area layer', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await openAreas(page, isMobile);
  await page.getByRole('button', { name: 'Draw circle', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Draw area', exact: true });
  await expect(editor).toBeVisible();
  await expect(page.locator('.filter-popover')).not.toBeVisible();
  await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  const radius = editor.getByRole('spinbutton', { name: 'Radius (km)', exact: true });
  await radius.fill('');
  await radius.pressSequentially('5.25');
  await expect(radius).toHaveValue('5.25');
  await radius.fill('501');
  await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await radius.fill('5');
  await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('circle-editor.png') });
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  const filter = page.locator('.filter-popover');
  await expect(filter).toBeVisible();
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
  await expect(filter.locator('[data-filter-group="area"]')).toContainText('Circle · 5 km');
  await filter.getByRole('button', { name: 'Save filter', exact: true }).click();
  await filter.getByRole('textbox', { name: 'Saved view name', exact: true }).fill('Local area');
  await filter.getByRole('button', { name: 'Save', exact: true }).click();
  await openFilterGroup(page, 'presets');
  await filter.getByRole('button', { name: 'Notifications for filter: Local area', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!));
  expect(saved[0]).toMatchObject({ name: 'Local area', notifyOnMatch: true, filters: { area: { kind: 'circle', radiusKm: 5 } } });
  await page.keyboard.press('Escape');
  if (isMobile) await page.locator('.mobile-sheet-close').click();
  await expect(page.locator('.map-area-label')).toHaveText('Local area');
  await page.screenshot({ path: testInfo.outputPath('saved-circle.png') });
  await page.reload();
  await expect(page.locator('.map-area-shape')).toHaveCount(1);
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Hide areas', exact: true }).click();
  await expect(page.locator('.map-area-shape')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('vector.mapAreas'))).toBe('false');
  await page.getByRole('button', { name: 'Show areas', exact: true }).click();
  await expect(page.locator('.map-area-shape')).toHaveCount(1);
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await openAreas(page, isMobile);
  await filter.getByRole('button', { name: 'Clear area', exact: true }).click();
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await openFilterGroup(page, 'presets');
  await filter.getByRole('button', { name: 'Manage filter: Local area', exact: true }).click();
  await filter.getByRole('button', { name: 'Delete', exact: true }).click();
  await filter.locator('.filter-preset-delete-confirm').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.map-area-shape')).toHaveCount(0);
});

test('polygon drawing supports undo, rejects crossing edges and cancel preserves the current filter', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await openAreas(page, isMobile);
  await page.getByRole('button', { name: 'Draw area', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Draw area', exact: true });
  const canvas = page.locator('.maplibregl-canvas');
  const box = (await canvas.boundingBox())!;
  const point = async (x: number, y: number) => canvas.click({ position: { x: box.width * x, y: box.height * y } });
  await point(.25, .5); await point(.75, .7); await point(.25, .7); await point(.75, .5);
  await expect(editor.getByRole('alert')).toHaveText('Draw an area without crossing lines.');
  await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Remove last point', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('polygon-editor-light.png') });
  expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.filter-popover')).toBeVisible();
  const original = await page.evaluate(() => localStorage.getItem('vector.aircraftFilters'));
  expect(JSON.parse(original!).area).toMatchObject({ kind: 'polygon', points: expect.any(Array) });
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('button', { name: 'Draw circle', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Point at map centre', exact: true })).toHaveCount(0);
  await expect(canvas).toHaveAttribute('aria-keyshortcuts', 'Enter');
  await canvas.press('Enter');
  await editor.getByRole('spinbutton', { name: 'Radius (km)', exact: true }).fill('10');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.filter-popover')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftFilters'))).toBe(original);
});

test('stored areas are reused without replacing other filter criteria and stay projected during zoom', async ({ page, isMobile }) => {
  await page.addInitScript(() => localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify([{ id: 'area-1', name: 'Receiver neighbourhood', sort: 'altitude-desc',
    filters: { area: { kind: 'circle', center: [4.8, 52.3], radiusKm: 30 } } }])));
  await page.goto('/');
  await expect(page.locator('.map-area-shape')).toHaveCount(1);
  await openAreas(page, isMobile);
  await openFilterGroup(page, 'categories');
  await page.getByLabel('Balloon / airship', { exact: true }).check();
  await openFilterGroup(page, 'area');
  await page.getByRole('combobox', { name: 'Saved areas', exact: true }).selectOption('area-1');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
  const filters = await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilters')!));
  expect(filters.categories).toEqual(['balloon']);
  expect(filters.area.radiusKm).toBe(30);
  await page.keyboard.press('Escape');
  if (isMobile) await page.locator('.mobile-sheet-close').click();
  const before = await page.locator('.map-area-shape').getAttribute('points');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.map-area-shape')).not.toHaveAttribute('points', before!);
  await expect(page.locator('.map-area-label')).toHaveText('Receiver neighbourhood');
});

for (const language of ['nl', 'en'] as const) {
  test(`area controls stay compact and only offer real saved areas in ${language}`, async ({ page, isMobile }, testInfo) => {
    if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
    if (language === 'en') await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      localStorage.setItem('vector.aircraftFilters', JSON.stringify({ area: { kind: 'circle', center: [4.8, 52.3], radiusKm: .6 } }));
    }, language);
    const labels = language === 'nl'
      ? { change: 'Wijzigen', cancel: 'Annuleren', saved: 'Opgeslagen gebieden', clear: 'Gebied wissen', draw: 'Cirkel aanpassen', area: 'Cirkel · 0,6 km' }
      : { change: 'Change', cancel: 'Cancel', saved: 'Saved areas', clear: 'Clear area', draw: 'Edit circle', area: 'Circle · 0.6 km' };
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    await openAreas(page, isMobile);
    const group = page.locator('[data-filter-group="area"]');
    const value = group.locator('.filter-area-value > span');
    const change = group.getByRole('button', { name: labels.change, exact: true });
    await expect(value).toHaveText(labels.area);
    await expect(group.locator('summary small')).not.toBeVisible();
    await expect(group.getByRole('combobox', { name: labels.saved, exact: true })).toHaveCount(0);
    await expect(group.getByRole('button', { name: labels.draw, exact: true })).not.toBeVisible();
    expect(await value.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeLessThanOrEqual(14);
    const row = (await group.locator('.filter-area-value').boundingBox())!;
    expect(row.height).toBeLessThanOrEqual(42);
    expect(await group.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`compact-area-${language}.png`) });
    await change.click();
    await expect(group.getByRole('button', { name: labels.draw, exact: true })).toBeVisible();
    await expect(group.getByRole('combobox', { name: labels.saved, exact: true })).toHaveCount(0);
    await group.getByRole('button', { name: labels.cancel, exact: true }).click();
    await expect(group.getByRole('button', { name: labels.draw, exact: true })).not.toBeVisible();
    // A current, unsaved shape must never appear as a saved-area option.
    await page.evaluate(() => localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify([{ id: 'home', name: 'Home', sort: 'altitude-desc',
      filters: { area: { kind: 'circle', center: [4.8, 52.3], radiusKm: 30 } } }])));
    await page.reload();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    await openAreas(page, isMobile);
    const saved = group.getByRole('combobox', { name: labels.saved, exact: true });
    await expect(saved).not.toBeVisible();
    await change.click();
    await expect(saved).toBeVisible();
    await expect(saved.locator('option')).toHaveCount(2);
    await expect(saved.locator('option[value="current"]')).toHaveCount(0);
    await saved.selectOption('home');
    await expect(value).toHaveText('Home');
    await expect(saved).not.toBeVisible();
    await expect(change).toBeFocused();
    await change.click();
    await expect(saved).toHaveValue('home');
    await page.screenshot({ path: testInfo.outputPath(`edit-saved-area-${language}.png`) });
    await group.getByRole('button', { name: labels.clear, exact: true }).click();
    await expect(group.locator('.filter-area-value')).toHaveCount(0);
    await expect(saved).toBeVisible();
    await expect(saved).toHaveValue('');
    await expect(group.getByRole('button', { name: language === 'nl' ? 'Cirkel tekenen' : 'Draw circle', exact: true })).toBeVisible();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  });
}

test('a circle centre moves with mouse, touch and arrow keys without changing radius or panning the map', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const area = { kind: 'circle', center: [4.8, 52.3], radiusKm: 30 };
    localStorage.setItem('vector.aircraftFilters', JSON.stringify({ area }));
    localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify([{ id: 'home', name: 'Home', sort: 'altitude-desc', filters: { area } }]));
  });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await openAreas(page, isMobile);
  const original = await page.evaluate(() => localStorage.getItem('vector.aircraftFilters'));
  const beginEdit = async () => {
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('button', { name: 'Edit circle', exact: true }).click();
  };
  await beginEdit();
  const editor = page.getByRole('region', { name: 'Draw area', exact: true });
  const radius = editor.getByRole('spinbutton', { name: 'Radius (km)', exact: true });
  const handle = page.getByRole('button', { name: 'Move circle centre', exact: true });
  await expect(radius).toHaveValue('30');
  await expect(handle).toBeInViewport();
  await handle.scrollIntoViewIfNeeded();
  const receiverBefore = (await page.locator('.receiver-map-marker').boundingBox())!;
  const before = (await handle.boundingBox())!;
  const start = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let step = 1; step <= 8; step++) await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: start.x + step * 5, y: start.y + step * 4 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 32, { steps: 8 }); await page.mouse.up();
  }
  await expect.poll(async () => (await handle.boundingBox())!.x - before.x).toBeCloseTo(40, 0);
  await expect(radius).toHaveValue('30');
  const receiverAfter = (await page.locator('.receiver-map-marker').boundingBox())!;
  expect(receiverAfter.x).toBeCloseTo(receiverBefore.x, 0);
  expect(receiverAfter.y).toBeCloseTo(receiverBefore.y, 0);
  await handle.focus();
  await handle.press('Shift+ArrowRight');
  await expect.poll(async () => (await handle.boundingBox())!.x - before.x).toBeCloseTo(50, 0);
  await expect(radius).toHaveValue('30');
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftFilters'))).toBe(original);
  await page.screenshot({ path: testInfo.outputPath('dragged-circle-centre.png') });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(handle).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftFilters'))).toBe(original);
  await beginEdit();
  await handle.focus(); await handle.press('Shift+ArrowLeft');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  const area = await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilters')!).area);
  expect(area.radiusKm).toBe(30);
  expect(area.center[0]).toBeLessThan(4.8);
  expect(area.center[1]).toBeCloseTo(52.3, 5);
  await page.locator('.filter-popover').getByRole('button', { name: 'Update', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!)[0].filters.area)).toEqual(area);
  await expect(page.locator('.maplibregl-canvas')).not.toHaveAttribute('aria-keyshortcuts', 'Enter');
});
