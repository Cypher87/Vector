import { test, expect, openFilterGroup } from './radar-fixture';

for (const language of ['en', 'nl']) {
  test(`saved filters can be updated, copied, renamed and safely deleted in ${language}`, async ({ page, isMobile }, testInfo) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ colorScheme: language === 'nl' ? 'light' : 'dark' });
    await page.addInitScript((value) => localStorage.setItem('vector.language', value), language);
    const nl = language === 'nl';
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    if (isMobile) await page.locator('.mobile-list-button').click();
    await page.locator('.filter-menu > summary').click();
    const filter = page.locator('.filter-popover');
    const newButton = filter.getByRole('button', { name: nl ? 'Filter opslaan' : 'Save filter', exact: true });
    const save = filter.getByRole('button', { name: nl ? 'Opslaan' : 'Save', exact: true });
    const cancel = filter.getByRole('button', { name: nl ? 'Annuleren' : 'Cancel', exact: true });
    const name = filter.getByRole('textbox', { name: nl ? 'Naam van opgeslagen weergave' : 'Saved view name', exact: true });
    const filtersTab = filter.locator('[data-filter-tab="filters"]');
    await openFilterGroup(page, 'presets');
    await expect(filter.locator('.filter-presets-empty')).toContainText(nl ? 'Ga naar Filters en kies Filter opslaan.' : 'Go to Filters and choose Save filter.');
    await expect(newButton).toHaveCount(0);
    await openFilterGroup(page, 'categories');
    await filter.getByLabel(nl ? 'Ballon / luchtschip' : 'Balloon / airship', { exact: true }).check();
    await newButton.click();
    await expect(name).toBeFocused();
    await name.fill('   ');
    await expect(save).toBeDisabled();
    await name.fill('  Local   balloons ');
    await name.press('Enter');
    await expect(newButton).toBeFocused();
    await expect(filter.locator('.filter-current-view')).toContainText('Local balloons');
    await openFilterGroup(page, 'presets');
    await expect(newButton).toHaveCount(0);
    const card = filter.locator('.filter-preset-card').filter({ hasText: 'Local balloons' });
    await expect(card).toContainText(nl ? 'Ballon / luchtschip' : 'Balloon / airship');
    await expect(card).toContainText(nl ? 'Actieve weergave' : 'Active view');
    await card.getByRole('button', { name: /^(Meldingen voor filter|Notifications for filter):/ }).click();
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!)[0]);
    expect(original.notifyOnMatch).toBe(true);
    // Do not create indistinguishable saved views, including case/whitespace variants.
    await filtersTab.click();
    await newButton.click();
    await name.fill('LOCAL  balloons');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(save).toBeDisabled();
    await cancel.click();
    await openFilterGroup(page, 'presets');
    await card.getByRole('button', { name: /^(Beheer filter|Manage filter):/ }).click();
    // Saving lives on Filters; switching tabs closes the saved-view rename editor.
    await expect(newButton).toHaveCount(0);
    await filtersTab.click();
    await expect(filter.locator('.filter-preset-manager')).toHaveCount(0);
    await newButton.click();
    await expect(name).toHaveCount(1);
    await cancel.click();
    await openFilterGroup(page, 'presets');
    await card.getByRole('button', { name: /^(Beheer filter|Manage filter):/ }).click();
    await name.fill('Nearby balloons');
    await save.click();
    const renamed = filter.locator('.filter-preset-card').filter({ hasText: 'Nearby balloons' });
    await renamed.getByRole('button', { name: /^(Beheer filter|Manage filter):/ }).click();
    await filter.getByRole('button', { name: nl ? 'Filters aanpassen' : 'Edit filters', exact: true }).click();
    await expect(filter.locator('[data-filter-tab="filters"]')).toBeFocused();
    await openFilterGroup(page, 'distance');
    await filter.getByRole('combobox', { name: nl ? 'Afstand tot ontvanger' : 'Distance from receiver', exact: true }).selectOption('50');
    await expect(filter.locator('.filter-current-view')).toContainText(nl ? 'Niet opgeslagen wijzigingen' : 'Unsaved changes');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!)[0].filters.distance)).toBe(null);
    // Closing the menu retains the editing identity; only Update changes the saved rule.
    await page.keyboard.press('Escape');
    await page.locator('.filter-menu > summary').click();
    const update = filter.getByRole('button', { name: nl ? 'Bijwerken' : 'Update', exact: true });
    await expect(update).toBeVisible();
    await openFilterGroup(page, 'presets');
    await expect(update).toHaveCount(0);
    await expect(newButton).toHaveCount(0);
    await filtersTab.click();
    await expect(update).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('modified-filter.png') });
    await update.click();
    const updated = await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!));
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: original.id, name: 'Nearby balloons', notifyOnMatch: true, filters: { distance: 50 } });
    await expect(update).toHaveCount(0);
    await newButton.click();
    await name.fill('A second view');
    await save.click();
    await openFilterGroup(page, 'presets');
    await expect(filter.locator('.filter-preset-card')).toHaveCount(2);
    await expect(filter.locator('.filter-preset-apply[aria-pressed="true"]')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('saved-filters.png') });
    const copy = filter.locator('.filter-preset-card').filter({ hasText: 'A second view' });
    await copy.getByRole('button', { name: /^(Beheer filter|Manage filter):/ }).click();
    await name.fill('Nearby balloons');
    await expect(save).toBeDisabled();
    await name.fill('A second view');
    const remove = copy.getByRole('button', { name: nl ? 'Verwijderen' : 'Delete', exact: true });
    await remove.click();
    const confirmation = copy.locator('.filter-preset-delete-confirm');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: nl ? 'Annuleren' : 'Cancel' }).click();
    await expect(filter.locator('.filter-preset-card')).toHaveCount(2);
    // Text actions need actual padding, not icon-sized or edge-to-edge hit areas.
    // On narrow screens wrap whole buttons instead of clipping their labels.
    for (const width of isMobile ? [320, 360] : [1440]) {
      await page.setViewportSize({ width, height: isMobile ? 780 : 1000 });
      for (const button of await copy.locator('.filter-preset-management-actions button').all()) {
        await button.scrollIntoViewIfNeeded();
        const fits = await button.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const text = range.getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          const parent = element.parentElement!.getBoundingClientRect();
          return text.left >= bounds.left + 11 && text.right <= bounds.right - 11
            && bounds.left >= parent.left && bounds.right <= parent.right + 1
            && element.scrollWidth <= element.clientWidth;
        });
        expect(fits).toBe(true);
      }
    }
    await page.screenshot({ path: testInfo.outputPath('manage-filter.png') });
    await remove.click();
    await confirmation.getByRole('button', { name: nl ? 'Verwijderen' : 'Delete' }).click();
    await expect(filter.locator('.filter-preset-card')).toHaveCount(1);
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    expect(await filter.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await filter.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.reload();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(1);
    if (isMobile) await page.locator('.mobile-list-button').click();
    await page.locator('.filter-menu > summary').click();
    await expect(filter.locator('.filter-current-view')).toContainText('Nearby balloons');
    await openFilterGroup(page, 'presets');
    await expect(filter.locator('.filter-preset-card')).toHaveCount(1);
    await expect(filter.getByRole('button', { name: /^(Meldingen voor filter|Notifications for filter):/ })).toHaveAttribute('aria-pressed', 'true');
  });
}

test('saved filter tabs, capacity and invalid drafts remain usable in a small viewport', async ({ page, isMobile }, testInfo) => {
  await page.setViewportSize(isMobile ? { width: 320, height: 640 } : { width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('vector.aircraftFilterPresets', JSON.stringify(
    Array.from({ length: 20 }, (_, index) => ({ id: `preset_${index}`, name: `View ${index} with a long descriptive name`, filters: { distance: 25 + index }, sort: 'distance-asc' })),
  )));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  if (isMobile) await page.locator('.mobile-list-button').click();
  await page.locator('.filter-menu > summary').click();
  const filter = page.locator('.filter-popover');
  await expect(filter.getByRole('button', { name: 'Save filter', exact: true })).toBeDisabled();
  const tab = filter.locator('[data-filter-tab="filters"]');
  await tab.focus();
  await tab.press('ArrowRight');
  await expect(filter.locator('[data-filter-tab="saved"]')).toBeFocused();
  await expect(filter.getByRole('button', { name: 'Save filter', exact: true })).toHaveCount(0);
  await expect(filter.locator('.filter-preset-limit')).toHaveCount(0);
  const last = filter.locator('.filter-preset-card').last();
  await last.scrollIntoViewIfNeeded();
  await last.locator('.filter-preset-apply').click();
  const savedBeforeEdit = await page.evaluate(() => localStorage.getItem('vector.aircraftFilterPresets'));
  await expect(filter.locator('.filter-workspace-footer')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('full-saved-filters.png') });
  await openFilterGroup(page, 'flight');
  const altitude = filter.getByRole('spinbutton', { name: 'Altitude · To (m)', exact: true });
  await altitude.fill('1000');
  await altitude.press('Tab');
  const min = filter.getByRole('spinbutton', { name: 'Altitude · From (m)', exact: true });
  await min.fill('2000');
  await min.press('Tab');
  await openFilterGroup(page, 'presets');
  await expect(filter.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  await tab.click();
  await filter.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(min).toBeFocused();
  await expect(min).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftFilterPresets'))).toBe(savedBeforeEdit);
  await min.fill('');
  await min.press('Tab');
  await filter.getByRole('button', { name: 'Update', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vector.aircraftFilterPresets')!).length)).toBe(20);
  expect(await filter.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
