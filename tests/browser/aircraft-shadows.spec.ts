import { test, expect } from './radar-fixture';

test('night shadows remain visible by altitude and respect the map layer toggle', async ({ page, radar }, testInfo) => {
  const night = new Date('2026-10-05T23:00:00Z');
  await page.clock.setFixedTime(night);
  radar.timestamp = night.getTime() / 1_000;
  await page.addInitScript(() => {
    localStorage.setItem('vector.aircraftShadows', 'true');
    localStorage.setItem('vector.aircraftMotion', 'false');
  });
  await page.goto('/');
  const shadows = page.locator('.aircraft-altitude-shadow-marker');
  await expect(shadows).toHaveCount(2);
  const high = shadows.filter({ has: page.locator('[data-shape="airliner"]') });
  const low = shadows.filter({ has: page.locator('[data-shape="balloon"]') });
  for (const shadow of [high, low]) {
    await expect(shadow.locator('.aircraft-altitude-shadow-projection')).toBeVisible();
    expect(await shadow.evaluate((element) => Number((element as HTMLElement).style.getPropertyValue('--aircraft-shadow-opacity')))).toBeGreaterThan(.24);
  }
  const distance = (element: Element) => {
    const style = (element as HTMLElement).style;
    return Math.hypot(parseFloat(style.getPropertyValue('--aircraft-shadow-offset-x')), parseFloat(style.getPropertyValue('--aircraft-shadow-offset-y')));
  };
  expect(await high.evaluate(distance)).toBeGreaterThan(await low.evaluate(distance));
  const offsets = await high.evaluate((element) => {
    const style = (element as HTMLElement).style;
    return ['--aircraft-shadow-offset-x', '--aircraft-shadow-offset-y'].map((name) => parseFloat(style.getPropertyValue(name)));
  });
  expect(offsets.every((value) => value > 0)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('night-shadows.png') });
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Hide aircraft shadows', exact: true }).click();
  for (const shadow of [high, low]) await expect(shadow).toBeHidden();
  await page.getByRole('button', { name: 'Show aircraft shadows', exact: true }).click();
  for (const shadow of [high, low]) await expect(shadow).toBeVisible();
});
