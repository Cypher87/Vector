import { test, expect } from './radar-fixture';

test('More groups receiver tools, remains usable by keyboard and fits both languages and themes', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  for (const language of ['en', 'nl']) {
    const nl = language === 'nl';
    if (nl) {
      await page.locator('.settings-menu summary').click();
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
      await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('nl');
      await page.locator('.settings-menu summary').click();
    }
    const more = page.getByRole('button', { name: nl ? 'Meer' : 'More', exact: true });
    await expect(page.getByRole('button', { name: nl ? 'Open logboek' : 'Open logbook', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: nl ? 'Open meldingen' : 'Open notifications', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: nl ? 'Open synchronisatie' : 'Open synchronization', exact: true })).toHaveCount(0);
    expect(await page.locator('.topbar').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await more.click();
    const sync = page.getByRole('button', { name: nl ? 'Open synchronisatie' : 'Open synchronization', exact: true });
    await expect(sync).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${language}.png`) });
    await sync.press('Enter');
    const panel = page.getByRole('dialog', { name: nl ? 'Synchronisatie' : 'Synchronization', exact: true });
    await expect(panel).toBeVisible();
    const input = panel.locator('input');
    await input.fill('ABC123');
    await expect(panel).toBeVisible();
    await input.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(more).toBeFocused();
    await more.press('Enter');
    await page.locator('.receiver-dashboard-button').click();
    const receiver = page.locator('.receiver-dashboard');
    await expect(receiver).toBeVisible();
    const bounds = (await receiver.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await receiver.locator('header button').press('Escape');
    await expect(receiver).toHaveCount(0);
    await expect(more).toBeFocused();
    await more.click();
    await page.locator('.brand').click();
    await expect(page.locator('.receiver-tools-popover')).toHaveCount(0);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  }
});
