import { test, expect, openFilterGroup } from './radar-fixture';

test('dropdown fields and native options have opaque, contrasting colors in every theme', async ({ page, isMobile }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  if (isMobile) await page.locator('.mobile-list-button').click();
  for (const theme of ['dark', 'light']) {
    await page.locator('.settings-menu summary').click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.keyboard.press('Escape');
    await page.locator('.filter-menu > summary').click();
    await openFilterGroup(page, 'distance');
    const distance = page.getByRole('combobox', { name: 'Distance from receiver', exact: true });
    await expect(distance).toBeVisible();
    // Also cover settings, sorting and the advanced fields, not just this selector.
    const colors = await page.locator('.radar-app select, .radar-app select option').evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return { text: element.textContent, foreground: style.color, background: style.backgroundColor, scheme: style.colorScheme };
    }));
    for (const color of colors) {
      const foreground = color.foreground.match(/[\d.]+/g)!.map(Number);
      const background = color.background.match(/[\d.]+/g)!.map(Number);
      expect(background[3] ?? 1, `Opaque background for ${theme}: ${color.text}`).toBe(1);
      const luminance = (rgb: number[]) => rgb.slice(0, 3).map((component) => {
        const channel = component / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(foreground);
      const b = luminance(background);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), `Contrast for ${theme}: ${color.text}`).toBeGreaterThanOrEqual(4.5);
      expect(color.scheme).toBe(theme === 'light' ? 'light' : 'dark');
    }
    await distance.selectOption('25');
    await expect(distance).toHaveValue('25');
    await distance.selectOption('');
    if (theme === 'dark' || theme === 'light') {
      await page.screenshot({ path: testInfo.outputPath(`dropdowns-${theme}.png`) });
    }
    await page.locator('.filter-close').click();
  }
});
