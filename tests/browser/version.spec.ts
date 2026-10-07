import { test, expect } from './radar-fixture';
import packageInfo from '../../package.json' with { type: 'json' };

const { version } = packageInfo;

test('Vector version is readable in settings on desktop and mobile in both appearances', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('.settings-menu summary').click();
  const info = page.getByLabel('Vector version', { exact: true });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(info).toBeVisible();
    await expect(info).toContainText(`Vector${version}`);
    const bounds = (await info.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    if (testInfo.project.name === 'desktop') await expect(page.locator('.statusbar')).toContainText(`Vector ${version}`);
    await page.screenshot({ path: testInfo.outputPath(`version-${theme}.png`) });
  }
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('nl');
  await expect(page.getByLabel('Vector-versie', { exact: true })).toContainText(version);
});
