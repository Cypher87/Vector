import { test, expect } from './radar-fixture';

for (const language of ['en', 'nl']) {
  test(`notifications consolidate the saved backlog and keep read/clear state in ${language}`, async ({ page, isMobile }, testInfo) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript((language) => {
      localStorage.setItem('vector.language', language);
      if (localStorage.getItem('notification-test-seeded')) return;
      localStorage.setItem('notification-test-seeded', 'yes');
      localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['abc123']));
      const now = Date.now();
      localStorage.setItem('vector.radarEvents', JSON.stringify([
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `duplicate-${i}`, kind: 'favorite-entered', timestamp: now - i * 1_000,
          aircraftId: 'abc123', flight: 'VECTOR01', read: false,
        })),
        { id: 'offline', kind: 'receiver-offline', timestamp: now - 3_000, read: false },
        { id: 'online', kind: 'receiver-online', timestamp: now - 1_000, read: false },
        { id: 'emergency', kind: 'squawk-7700', timestamp: now - 2_000, aircraftId: 'ffeeaa', flight: 'LONGCALLSIGN1234', read: false },
        { id: 'expired', kind: 'squawk-7500', timestamp: now - 25 * 60 * 60_000, aircraftId: 'dead00', read: false },
      ]));
    }, language);
    await page.goto('/');
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    const trigger = page.locator('.event-center-button');
    await expect(trigger.locator('.event-unread-count')).toHaveText('3');
    await trigger.click();
    const popover = page.locator('.event-popover');
    await expect(popover.locator('.event-row')).toHaveCount(3);
    await expect(popover.locator('button.event-row')).toHaveCount(1);
    await expect(popover).toContainText(language === 'nl' ? 'Afgelopen 24 uur' : 'Past 24 hours');
    await expect(popover).toContainText(language === 'nl' ? 'Niet in livebeeld' : 'Not in live view');
    await expect(popover).toContainText(language === 'nl' ? 'Verbinding hersteld' : 'Connection restored');
    await expect(trigger.locator('.event-unread-count')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vector.radarEvents')!).every((event: { read: boolean }) => event.read))).toBe(true);
    expect(await popover.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await popover.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: testInfo.outputPath('notifications.png') });
    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.reload();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await expect(trigger.locator('.event-unread-count')).toHaveCount(0);
    await trigger.click();
    await expect(popover.locator('.event-row')).toHaveCount(3);
    await popover.locator('button.event-row').click();
    await expect(popover).not.toBeVisible();
    await expect(page.locator(isMobile ? '.mobile-aircraft-summary' : '.flight-title')).toContainText('VECTOR');
    await trigger.click();
    await popover.getByRole('button', { name: language === 'nl' ? 'Logboek wissen' : 'Clear log', exact: true }).click();
    await expect(popover.locator('.event-row')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    await trigger.click();
    await expect(popover.locator('.event-row')).toHaveCount(0);
  });
}

test('live favorite reception gaps do not repeat notifications, new emergency codes still alert', async ({ page, radar }) => {
  await page.addInitScript(() => localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['aabbcc'])));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await expect(page.locator('.event-unread-count')).toHaveCount(0);
  radar.extraAircraft = [{ hex: 'aabbcc', flight: 'FAVORITE', lat: 52.35, lon: 4.85, alt_baro: 10_000, seen: 0, type: 'adsb_icao' }];
  await expect(page.locator('.event-unread-count')).toHaveText('1');
  await page.locator('.event-center-button').click();
  await expect(page.locator('.event-row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  for (let i = 0; i < 2; i++) {
    const contact = radar.extraAircraft;
    radar.extraAircraft = [];
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
    radar.extraAircraft = contact;
    await expect(page.locator('.aircraft-map-marker')).toHaveCount(3);
    await expect(page.locator('.event-unread-count')).toHaveCount(0);
  }
  radar.extraAircraft[0].squawk = '7700';
  await expect(page.locator('.event-unread-count')).toHaveText('1');
  await page.locator('.event-center-button').click();
  await expect(page.locator('.event-row')).toHaveCount(2);
  await expect(page.locator('.event-row').first()).toContainText('Squawk 7700');
  await page.keyboard.press('Escape');
  radar.extraAircraft[0].squawk = '7600';
  await expect(page.locator('.event-unread-count')).toHaveText('1');
  await page.locator('.event-center-button').click();
  await expect(page.locator('.event-row').first()).toContainText('Squawk 7600');
  await expect(page.locator('.event-unread-count')).toHaveCount(0);
  // Simulate a background tab with the popover left open. New alerts aren't read yet.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  radar.extraAircraft[0].squawk = '7500';
  await expect(page.locator('.event-row').first()).toContainText('Squawk 7500');
  await expect(page.locator('.event-unread-count')).toHaveText('1');
  await page.evaluate(() => {
    delete (document as { visibilityState?: string }).visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.event-unread-count')).toHaveCount(0);
});
