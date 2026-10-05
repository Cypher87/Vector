import { test, expect } from './radar-fixture';

test.beforeEach(async ({ page, radar }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Decorative parts are independent of position smoothing.
  await page.addInitScript(() => localStorage.setItem('vector.aircraftMotion', 'false'));
  radar.extraAircraft = [
    { hex: 'fed001', flight: 'ROTOR', t: 'H145', category: 'A7' },
    { hex: 'fed002', flight: 'PROP', t: 'AT76', category: 'A3' },
    { hex: 'fed003', flight: 'LIGHT', t: 'C172', category: 'A1' },
    { hex: 'fed004', flight: 'GYRO', desc: 'G1P', category: 'A7' },
  ].map((item, index) => ({
    ...item, type: 'adsb_icao', lat: 52 + index * 0.45, lon: 4.35 + (index % 2) * 0.8,
    alt_baro: 2000, gs: 90, track: 135, seen: 0, seen_pos: 0, messages: 50,
  }));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(6);
});

test('only rotor/propeller parts animate; body, GPS and animations survive feed updates', async ({ page, radar }, testInfo) => {
  const marker = page.getByRole('button', { name: /^ROTOR,/ });
  const icon = marker.locator('.map-aircraft-icon');
  const rotor = icon.locator('.aircraft-icon-rotor');
  await expect(rotor).toHaveCSS('animation-play-state', 'running');
  await expect(rotor).toHaveCSS('animation-duration', '2.4s');
  const propellers = page.getByRole('button', { name: /^PROP,/ }).locator('.aircraft-icon-propeller');
  await expect(propellers).toHaveCount(2);
  await expect(propellers.first()).toHaveCSS('animation-play-state', 'running');
  await expect(propellers.first()).toHaveCSS('animation-duration', '1.2s');
  await expect(propellers.first()).toHaveCSS('animation-timing-function', 'linear');
  await expect(page.getByRole('button', { name: /^LIGHT,/ }).locator('.aircraft-icon-propeller')).toHaveCSS('animation-play-state', 'running');
  await expect(page.getByRole('button', { name: /^GYRO,/ }).locator('.aircraft-icon-rotor')).toHaveCSS('animation-play-state', 'running');

  const bodyTransform = await icon.evaluate((element) => getComputedStyle(element).transform);
  const position = await marker.boundingBox();
  const startTransform = await rotor.evaluate((part) => getComputedStyle(part).transform);
  const animation = await rotor.evaluateHandle((part) => part.getAnimations()[0]);
  const propellerAnimation = await propellers.first().evaluateHandle((part) => part.getAnimations()[0]);
  const propellerStartTime = await propellerAnimation.evaluate((value) => Number(value.currentTime));
  const propellerTransform = await propellers.first().evaluate((part) => getComputedStyle(part).transform);
  const startTime = await animation.evaluate((value) => Number(value.currentTime));
  await expect.poll(() => rotor.evaluate((part) => getComputedStyle(part).transform)).not.toBe(startTransform);
  await expect.poll(() => propellers.first().evaluate((part) => getComputedStyle(part).transform)).not.toBe(propellerTransform);
  const requests = radar.aircraftRequests;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThan(requests);
  // Recreating the SVG or restarting CSS animation would cancel this original instance.
  expect(await animation.evaluate((value) => value.playState)).toBe('running');
  expect(await animation.evaluate((value) => Number(value.currentTime))).toBeGreaterThan(startTime);
  expect(await propellerAnimation.evaluate((value) => value.playState)).toBe('running');
  expect(await propellerAnimation.evaluate((value) => Number(value.currentTime))).toBeGreaterThan(propellerStartTime);
  await expect(icon).toHaveCSS('transform', bodyTransform);
  const after = (await marker.boundingBox())!;
  expect(Math.abs(after.x - position!.x)).toBeLessThan(1);
  expect(Math.abs(after.y - position!.y)).toBeLessThan(1);
  expect(await marker.evaluate((element) => getComputedStyle(element, '::before').content)).toBe('none');
  await expect(page.locator('.aircraft-altitude-shadow-icon[data-shape="helicopter"] .aircraft-icon-rotor')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.list-aircraft-icon[data-shape="helicopter"] .aircraft-icon-rotor')).toHaveCSS('animation-name', 'none');
  await page.screenshot({ path: testInfo.outputPath('subtle-icon-motion.png') });
});

test('propeller rotation stays in a narrow plane with a fixed engine hub', async ({ page }, testInfo) => {
  for (const flight of ['LIGHT', 'PROP']) {
    const icon = page.getByRole('button', { name: new RegExp(`^${flight},`) }).locator('.map-aircraft-icon');
    const body = await icon.evaluate((element) => getComputedStyle(element).transform);
    const samples = await icon.locator('.aircraft-icon-propeller').evaluateAll(async (parts) => {
      const results = [];
      for (const part of parts) {
        const animation = part.getAnimations()[0];
        animation.pause();
        const [x, y] = getComputedStyle(part).transformOrigin.split(' ').map(Number.parseFloat);
        const plane = part.parentElement as unknown as SVGGraphicsElement;
        const projection = plane.transform.baseVal.consolidate()!.matrix;
        const frames = [];
        for (const time of [0, 100, 200]) {
          animation.currentTime = time;
          await new Promise(requestAnimationFrame);
          const matrix = (part as SVGGraphicsElement).getCTM()!;
          const hub = new DOMPoint(x, y).matrixTransform(matrix);
          const expected = new DOMPoint(x, y).matrixTransform(plane.getCTM()!);
          frames.push({ hub: [hub.x, hub.y], expected: [expected.x, expected.y], transform: getComputedStyle(part).transform });
        }
        results.push({ ratio: projection.d / projection.a, frames });
        animation.play();
      }
      return results;
    });
    for (const { ratio, frames } of samples) {
      expect(ratio).toBeCloseTo(.32);
      expect(new Set(frames.map((frame) => frame.transform)).size).toBe(3);
      for (const frame of frames) {
        expect(frame.hub[0]).toBeCloseTo(frame.expected[0], 3);
        expect(frame.hub[1]).toBeCloseTo(frame.expected[1], 3);
      }
    }
    await expect(icon).toHaveCSS('transform', body);
  }
  const nose = page.locator('.list-aircraft-icon[data-shape="light"] .aircraft-icon-propeller');
  await expect(nose).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.list-aircraft-icon[data-shape="light"] .aircraft-icon-propeller-plane'))
    .toHaveAttribute('transform', 'translate(20 4) scale(1 .32) translate(-20 -4)');
  await page.screenshot({ path: testInfo.outputPath('projected-propeller-motion.png') });
});

test('icon motion stops for ground/stationary contacts, old positions, hidden tabs and reduced motion', async ({ page, radar }) => {
  const rotor = page.getByRole('button', { name: /^ROTOR,/ }).locator('.aircraft-icon-rotor');
  const propeller = page.getByRole('button', { name: /^LIGHT,/ }).locator('.aircraft-icon-propeller');
  await expect(rotor).toHaveCSS('animation-play-state', 'running');
  for (const patch of [{ alt_baro: 'ground' }, { gs: 0 }, { seen_pos: 9 }]) {
    for (const item of radar.extraAircraft.slice(0, 3)) Object.assign(item, patch);
    await expect(rotor).toHaveCSS('animation-play-state', 'paused');
    await expect(propeller).toHaveCSS('animation-play-state', 'paused');
    for (const item of radar.extraAircraft.slice(0, 3)) Object.assign(item, { alt_baro: 2000, gs: 90, seen_pos: 0 });
    await expect(rotor).toHaveCSS('animation-play-state', 'running');
    await expect(propeller).toHaveCSS('animation-play-state', 'running');
  }
  // Chromium's headless background tabs do not reliably change document.hidden.
  // Exercise the actual visibilitychange listener with a controlled visibility state.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(rotor).toHaveCSS('animation-play-state', 'paused');
  await expect(propeller).toHaveCSS('animation-play-state', 'paused');
  const frozen = await rotor.evaluate((part) => getComputedStyle(part).transform);
  const requests = radar.aircraftRequests;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThan(requests);
  await expect(rotor).toHaveCSS('transform', frozen);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(rotor).toHaveCSS('animation-play-state', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(rotor).toHaveCSS('animation-name', 'none');
  await expect(rotor).toHaveCSS('transform', 'none');
  await expect(page.locator('.aircraft-map-marker .aircraft-icon-propeller').first()).toHaveCSS('animation-name', 'none');
});

test('icon decoration pauses with stale data and in history mode', async ({ page, radar }) => {
  const rotor = page.getByRole('button', { name: /^ROTOR,/ }).locator('.aircraft-icon-rotor');
  const propeller = page.getByRole('button', { name: /^LIGHT,/ }).locator('.aircraft-icon-propeller');
  await expect(rotor).toHaveCSS('animation-play-state', 'running');
  radar.timestamp = Date.now() / 1000 - 90;
  await expect(page.locator('.live-pill')).toHaveClass(/stale/);
  await expect(rotor).toHaveCSS('animation-play-state', 'paused');
  await expect(propeller).toHaveCSS('animation-play-state', 'paused');
  radar.timestamp = undefined;
  await expect(rotor).toHaveCSS('animation-play-state', 'running');
  await expect(propeller).toHaveCSS('animation-play-state', 'running');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-icon-animation', 'paused');
  await expect(page.getByRole('slider', { name: 'History timeline' })).toBeEnabled();
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-icon-animation', 'paused');
});
