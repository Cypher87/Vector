import { test, expect } from './radar-fixture';

for (const theme of ['vector', 'daylight']) {
  test(`unknown contact stays upright and consistent across map, list and details in ${theme}`, async ({ page, radar, isMobile }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem('vector.theme', theme);
      localStorage.setItem('vector.aircraftMotion', 'false');
    }, theme);
    radar.extraAircraft = [{
      hex: 'fed001', flight: 'UNKNOWN', category: 'A0', type: 'adsb_icao',
      lat: 52.32, lon: 4.74, alt_baro: 20_000, gs: 100, track: 135, seen: 0, messages: 50,
    }];
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(3);
    const marker = page.locator('.aircraft-map-marker').filter({ hasText: 'UNKNOWN' });
    const mapIcon = marker.locator('.map-aircraft-icon');
    await expect(mapIcon).toHaveAttribute('data-shape', 'unknown-contact-dot');
    await expect(mapIcon).toHaveAttribute('style', /rotate\(0deg\)/);
    await expect(mapIcon).toHaveAttribute('style', /scale\(1\)/);
    await expect(marker).toHaveAttribute('aria-label', /unknown aircraft/);
    const color = await mapIcon.evaluate((icon) => getComputedStyle(icon.querySelector('.aircraft-icon-main')!).fill);
    expect(color).not.toBe('none');
    await expect(mapIcon.locator('.aircraft-icon-accent')).toHaveCount(0);
    const circle = await mapIcon.locator('.aircraft-icon-main').evaluate((path) => {
      const bounds = (path as SVGGraphicsElement).getBBox();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
    expect(circle).toEqual({ x: 7, y: 7, width: 10, height: 10 });
    await expect(page.locator('.aircraft-altitude-shadow-icon[data-shape="unknown-contact-dot"]')).toHaveCSS('visibility', 'hidden');
    const known = page.locator('.aircraft-map-marker').filter({ hasText: 'VECTOR01' });
    expect(await known.locator('.aircraft-icon-main').first().evaluate((path) => getComputedStyle(path).fill)).toBe(color);
    const outline = await known.locator('.aircraft-icon-main').first().evaluate((path) => getComputedStyle(path).stroke);
    expect(outline).not.toBe(color);
    await expect(mapIcon.locator('.aircraft-icon-main')).toHaveCSS('stroke', outline);
    await expect(page.locator('.aircraft-map-marker [data-shape="balloon"]')).toHaveCount(1);
    await marker.screenshot({ path: testInfo.outputPath(`unknown-map-${theme}.png`) });

    if (isMobile) await page.locator('.mobile-list-button').click();
    const row = page.locator('.aircraft-row').filter({ hasText: 'UNKNOWN' });
    const listIcon = row.locator('.aircraft-icon-svg');
    await expect(listIcon).toHaveAttribute('data-shape', 'unknown-contact-dot');
    await expect(listIcon).toHaveAttribute('style', /rotate\(0deg\)/);
    await expect(listIcon.locator('.aircraft-icon-main')).toHaveCSS('fill', color);
    await expect(listIcon.locator('.aircraft-icon-accent')).toHaveCount(0);
    await row.screenshot({ path: testInfo.outputPath(`unknown-row-${theme}.png`) });
    await row.click();
    if (isMobile) {
      await expect(page.locator('.mobile-aircraft-summary [data-shape="unknown-contact-dot"]')).toBeVisible();
      await page.getByRole('button', { name: 'Show full details' }).click();
    }
    const detailIcon = page.locator('.detail-aircraft-icon');
    await expect(detailIcon).toHaveAttribute('data-shape', 'unknown-contact-dot');
    await expect(detailIcon).toHaveAttribute('style', /rotate\(0deg\)/);
    await expect(detailIcon.locator('.aircraft-icon-main')).toHaveCSS('fill', color);
    await expect(detailIcon.locator('.aircraft-icon-accent')).toHaveCount(0);
    await expect(page.locator('.flight-title p')).toHaveText('Unknown type');
    await page.screenshot({ path: testInfo.outputPath(`unknown-details-${theme}.png`) });

    radar.extraAircraft[0].track = 245;
    await expect(page.locator('.metric-grid')).toContainText('245°');
    await expect(mapIcon).toHaveAttribute('style', /rotate\(0deg\)/);
    await expect(detailIcon).toHaveAttribute('style', /rotate\(0deg\)/);
    Object.assign(radar.extraAircraft[0], { t: 'EC35', category: 'A7' });
    await expect(mapIcon).toHaveAttribute('data-shape', 'helicopter');
    await expect(detailIcon).toHaveAttribute('data-shape', 'helicopter');
    await expect(marker).toHaveClass(/helicopter/);
    await expect(mapIcon).not.toHaveAttribute('style', /rotate\(0deg\)/);
  });
}
