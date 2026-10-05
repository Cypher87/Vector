import { test, expect } from './radar-fixture';
import { aircraftMapIconScale } from '../../src/map/aircraft-map-size';

test.beforeEach(async ({ page, radar }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('vector.aircraftMotion', 'false');
    localStorage.setItem('vector.mapLabels', 'true');
    localStorage.setItem('vector.favoriteAircraft', JSON.stringify(['fed001']));
  });
  radar.extraAircraft = [{ hex: 'fed001', flight: 'GROW', t: 'C172', desc: 'L1P', category: 'A1',
    type: 'adsb_icao', lat: 52.3, lon: 4.8, alt_baro: 2000, gs: 90, track: 0, seen: 0, seen_pos: 0, messages: 50 }];
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(3);
});

test('map icon size eases with zoom, keeps the GPS anchor and leaves list icons and trail widths unchanged', async ({ page, radar }, testInfo) => {
  const marker = page.getByRole('button', { name: /^GROW,/ });
  const body = marker.locator('.map-aircraft-icon > .aircraft-icon-body');
  const size = () => body.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a * 32.4);
  await expect.poll(size).toBeCloseTo(32.4, 2);
  const labelFont = await marker.locator('.map-plane-label strong').evaluate((element) => getComputedStyle(element).fontSize);
  const listIcon = page.locator('.aircraft-row').filter({ hasText: 'GROW' }).locator('.list-aircraft-icon');
  const listSize = await listIcon.evaluate((element) => getComputedStyle(element).width);
  const propellerAnimation = await marker.locator('.aircraft-icon-propeller').evaluateHandle((part) => part.getAnimations()[0]);

  for (let step = 1; step <= 5; step++) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(size).toBeCloseTo(32.4 * aircraftMapIconScale(7.2 + step), 2);
    // Ensure the map easing is finished before another relative zoom command.
    const nextFeed = radar.aircraftRequests + 1;
    await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
    const geometry = await marker.evaluate((element) => {
      const icon = element.querySelector<SVGSVGElement>('.map-aircraft-icon')!;
      const body = icon.querySelector<SVGGraphicsElement>('.aircraft-icon-body')!;
      const center = new DOMPoint(20, 20).matrixTransform(body.getScreenCTM()!);
      const anchor = element.getBoundingClientRect();
      const receiver = document.querySelector('.receiver-map-marker')!.getBoundingClientRect();
      const favorite = element.querySelector('.favorite-map-target')!.getBoundingClientRect();
      const scale = new DOMMatrix(getComputedStyle(body).transform).a;
      const wake = icon.querySelector('.aircraft-speed-wake-base')!;
      const lane = wake.parentElement as unknown as SVGGraphicsElement;
      const engine = new DOMPoint(20, 34).matrixTransform(body.getScreenCTM()!);
      const trailStart = new DOMPoint(0, 0).matrixTransform(lane.getScreenCTM()!);
      return { center: [center.x, center.y], anchor: [anchor.x + anchor.width / 2, anchor.y + anchor.height / 2],
        receiver: [receiver.x + receiver.width / 2, receiver.y + receiver.height / 2],
        favoriteWidth: favorite.width, hitWidth: anchor.width, scale,
        engineGap: Math.hypot(engine.x - trailStart.x, engine.y - trailStart.y),
        stroke: getComputedStyle(wake).strokeWidth, wakeTransform: getComputedStyle(wake.closest('.aircraft-speed-wake')!).transform };
    });
    for (const axis of [0, 1]) {
      expect(geometry.center[axis]).toBeCloseTo(geometry.anchor[axis], 1);
      // Receiver markers round to whole CSS pixels; aircraft use subpixel positioning.
      expect(Math.abs(geometry.center[axis] - geometry.receiver[axis])).toBeLessThan(.55);
    }
    expect(geometry.hitWidth).toBeCloseTo(32 * geometry.scale, 1);
    expect(geometry.favoriteWidth).toBeCloseTo(38 * geometry.scale, 1);
    expect(geometry.engineGap).toBeLessThan(.02);
    expect(geometry.stroke).toBe('2.9px');
    expect(geometry.wakeTransform).toBe('none');
    await expect(marker.locator('.map-plane-label strong')).toHaveCSS('font-size', labelFont);
    await expect(listIcon).toHaveCSS('width', listSize);
    await expect(listIcon.locator('.aircraft-icon-body')).toHaveCSS('transform', 'none');
  }
  await expect.poll(size).toBeCloseTo(46, 2);
  expect(await propellerAnimation.evaluate((animation) => animation.playState)).toBe('running');
  // New feed contacts inherit the current zoom size, not the initial size.
  radar.extraAircraft.push({ ...radar.extraAircraft[0], hex: 'fed002', flight: 'NEW', lon: 4.82, lat: 52.31, t: 'AT76', desc: 'L2T' });
  const newBody = page.getByRole('button', { name: /^NEW,/ }).locator('.map-aircraft-icon > .aircraft-icon-body');
  await expect(newBody).toHaveCSS('transform', await body.evaluate((element) => getComputedStyle(element).transform));
  await expect(page.locator('.aircraft-altitude-shadow-icon[data-shape="light"] > .aircraft-icon-body'))
    .toHaveCSS('transform', await body.evaluate((element) => getComputedStyle(element).transform));
  await page.screenshot({ path: testInfo.outputPath('zoomed-aircraft-icons.png') });
  for (let step = 4; step >= 0; step--) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect.poll(size).toBeCloseTo(32.4 * aircraftMapIconScale(7.2 + step), 2);
    const nextFeed = radar.aircraftRequests + 1;
    await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  }
});

test('zoom sizing produces intermediate frames and respects reduced motion without disabling sizing', async ({ page }) => {
  const body = page.getByRole('button', { name: /^GROW,/ }).locator('.map-aircraft-icon > .aircraft-icon-body');
  const sample = page.evaluate(() => new Promise<number[]>((resolve) => {
    document.querySelector('button[aria-label="Zoom in"]')!.addEventListener('click', () => {
      const frames: number[] = [], start = performance.now();
      const collect = () => {
        const body = document.querySelector('.aircraft-map-marker.favorite .aircraft-icon-body')!;
        frames.push(new DOMMatrix(getComputedStyle(body).transform).a);
        if (performance.now() - start < 700) requestAnimationFrame(collect);
        else resolve(frames);
      };
      collect();
    }, { once: true, capture: true });
  }));
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const frames = await sample;
  const min = Math.min(...frames), max = Math.max(...frames);
  expect(max - min).toBeGreaterThan(.04);
  expect(frames.some((value) => value > min + .005 && value < max - .005)).toBe(true);
  expect(frames.every((value, index) => index === 0 || value >= frames[index - 1] - .00001)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => body.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a))
    .toBeCloseTo(aircraftMapIconScale(9.2), 4);
  await expect(body.locator('.aircraft-icon-propeller')).toHaveCSS('animation-name', 'none');
});
