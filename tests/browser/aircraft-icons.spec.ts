import { test, expect } from './radar-fixture';
import { vectorAircraftShapes } from '../../src/map/vector-aircraft-shapes';

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

for (const theme of ['vector', 'daylight']) {
  test(`original silhouettes remain visible and consistent in ${theme}`, async ({ page, radar, isMobile }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem('vector.theme', theme);
      localStorage.setItem('vector.aircraftMotion', 'false');
    }, theme);
    const contacts = [
      ['A320', 'A3', 'airliner'], ['B789', 'A5', 'heavy'], ['B744', 'A5', 'heavy-four'],
      ['C25A', 'A2', 'small'], ['C172', 'A1', 'light'], ['AT76', 'A3', 'turboprop'],
      ['GLID', 'B1', 'glider'], ['H145', 'A7', 'helicopter'], ['BALL', 'B2', 'balloon'],
      ['SHIP', 'B2', 'airship'], ['F16', 'A6', 'high-performance'], ['ZZZZ', 'B4', 'ultralight'],
      ['ZZZZ', 'B6', 'uav'], ['ZZZZ', 'B3', 'skydiver'], ['SERV', 'C2', 'ground'],
      ['ZZZZ', 'A7', 'gyrocopter'], ['ZZZZ', 'A0', 'unknown-contact-dot'],
    ];
    radar.extraAircraft = contacts.map(([t, category, name], index) => ({
      hex: (0xaa0000 + index).toString(16), flight: `ICON${index}`, t, category,
      ...(name === 'gyrocopter' ? { desc: 'G1P' } : {}),
      type: 'adsb_icao', lat: 51.6 + Math.floor(index / 5) * 0.45,
      lon: 3.4 + (index % 5) * 0.7, alt_baro: 10_000, track: 45, seen: 0, messages: 20,
    }));
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(19);
    for (const [index, [, , name]] of contacts.entries()) {
      const mapIcon = page.getByRole('button', { name: new RegExp(`^ICON${index},`) }).locator('.map-aircraft-icon');
      await expect(mapIcon).toHaveAttribute('data-shape', name);
      const paths = await mapIcon.locator('.aircraft-icon-main').evaluateAll((elements) => elements.map((element) => {
        const box = (element as SVGGraphicsElement).getBBox();
        return { width: box.width, height: box.height };
      }));
      expect(paths.some((box) => box.width > 5 && box.height > 5)).toBe(true);
      if (name === 'balloon' || name === 'airship' || name === 'unknown-contact-dot') await expect(mapIcon).toHaveAttribute('style', /rotate\(0deg\)/);
    }
    await page.screenshot({ path: testInfo.outputPath(`original-icons-map-${theme}.png`) });

    // A contact sheet uses the same DOM renderer's SVG and app CSS, at real icon size.
    await page.evaluate(({ shapes, mobile }) => {
      const sheet = document.createElement('section');
      sheet.id = 'icon-review-sheet';
      Object.assign(sheet.style, { position: 'fixed', inset: '0', zIndex: '999999', overflow: 'auto', background: 'var(--panel-deep)', color: 'var(--ink)', padding: '24px', display: 'grid', gridTemplateColumns: `repeat(${mobile ? 2 : 5}, 1fr)`, gap: '12px' });
      for (const name of shapes) {
        const source = document.querySelector<SVGSVGElement>(`.aircraft-map-marker .map-aircraft-icon[data-shape="${name}"]`)!;
        const card = document.createElement('div');
        Object.assign(card.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', minHeight: '96px', border: '1px solid var(--line)', borderRadius: '8px' });
        const icon = source.cloneNode(true) as SVGSVGElement;
        Object.assign(icon.style, { transform: 'none', width: '40px', height: '40px', color: '#6bbfc9', '--aircraft-color': '#6bbfc9' });
        const label = document.createElement('span');
        label.textContent = name;
        label.style.fontSize = '12px';
        card.append(icon, label);
        sheet.append(card);
      }
      document.body.append(sheet);
    }, { shapes: Object.keys(vectorAircraftShapes), mobile: isMobile });
    await page.screenshot({ path: testInfo.outputPath(`original-icons-gallery-${theme}.png`) });
  });
}
