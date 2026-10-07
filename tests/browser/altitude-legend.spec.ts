import { test, expect } from './radar-fixture';
import { altitudeColorForValue, altitudeLegendGradient } from '../../src/map/altitude-color';
import { feetPerKilometre } from '../../src/domain/altitude-scale';
import { themes } from '../../src/theme';

test('legend and aircraft share the altitude palette across themes', async ({ page, radar, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
  const altitudes = [0, 1, 3, 5, 7, 8, 9, 10, 11, 12];
  radar.extraAircraft = altitudes.map((km, index) => ({
    hex: `ee000${index}`, flight: `ALT${km}`, t: 'A320', category: 'A3', type: 'adsb_icao',
    lat: 52 + Math.floor(index / 4) * .45, lon: 4.2 + index % 4 * .4, alt_baro: km * feetPerKilometre,
    gs: 420, track: 30, seen: 0, seen_pos: 0,
  }));
  await page.addInitScript(() => localStorage.setItem('vector.aircraftMotion', 'false'));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(altitudes.length + 2);
  const legend = page.locator('.altitude-legend');
  await expect(legend.locator('small span').last()).toHaveText('12+');
  await expect(legend).toBeInViewport({ ratio: 1 });
  expect((await legend.locator(':scope > div').boundingBox())!.height).toBe(9);
  for (const theme of themes) {
    await page.locator('.settings-menu summary').click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Inspect the style attribute: browser serialization rounds gradient stops.
    const gradient = await legend.locator(':scope > div').getAttribute('style');
    for (const color of altitudeLegendGradient(theme).match(/rgb\([^)]+\)/g)!) expect(gradient).toContain(color);
    for (const km of altitudes) {
      const marker = page.getByRole('button', { name: new RegExp(`^ALT${km},`) });
      await expect(marker).toHaveCSS('--aircraft-color', altitudeColorForValue(km * feetPerKilometre, false, theme));
    }
    if (theme === 'dark' || theme === 'light') await page.screenshot({ path: testInfo.outputPath(`altitude-${theme}.png`) });
  }
  await page.locator('.settings-menu summary').click();
  await page.getByRole('combobox', { name: 'Unit system', exact: true }).selectOption('aeronautical');
  await page.keyboard.press('Escape');
  await expect(legend.locator('small span').last()).toHaveText('39.4+');
  const labels = await legend.locator('small span').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }));
  for (let index = 1; index < labels.length; index++) expect(labels[index].left).toBeGreaterThan(labels[index - 1].right);
});
