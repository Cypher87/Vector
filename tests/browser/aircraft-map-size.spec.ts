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
  const body = marker.locator('.aircraft-map-symbol');
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
      const scale = new DOMMatrix(getComputedStyle(element.querySelector('.aircraft-map-symbol')!).transform).a;
      const wake = element.querySelector('.aircraft-speed-wake-base')!;
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
  const newBody = page.getByRole('button', { name: /^NEW,/ }).locator('.aircraft-map-symbol');
  await expect(newBody).toHaveCSS('transform', await body.evaluate((element) => getComputedStyle(element).transform));
  await expect(page.locator('.aircraft-altitude-shadow-marker .aircraft-map-symbol').filter({ has: page.locator('[data-shape="light"]') }))
    .toHaveCSS('transform', await body.evaluate((element) => getComputedStyle(element).transform));
  await page.screenshot({ path: testInfo.outputPath('zoomed-aircraft-icons.png') });
  for (let step = 4; step >= 0; step--) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect.poll(size).toBeCloseTo(32.4 * aircraftMapIconScale(7.2 + step), 2);
    const nextFeed = radar.aircraftRequests + 1;
    await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  }
});

test('icons freeze during zoom, resize smoothly afterwards, and keep engine offsets aligned', async ({ page }) => {
  const body = page.getByRole('button', { name: /^GROW,/ }).locator('.aircraft-map-symbol');
  for (const [control, from, to] of [
    ['Zoom in', 1, aircraftMapIconScale(8.2)], ['Zoom out', aircraftMapIconScale(8.2), 1],
  ] as const) {
    const sample = page.evaluate((control) => new Promise<{ scale: number; zooming: boolean; gap: number }[]>((resolve) => {
      document.querySelector(`button[aria-label="${control}"]`)!.addEventListener('click', () => {
        const frames: { scale: number; zooming: boolean; gap: number }[] = [], start = performance.now();
        const collect = () => {
          const marker = document.querySelector('.aircraft-map-marker.favorite')!;
          const symbol = marker.querySelector('.aircraft-map-symbol')!;
          const body = marker.querySelector<SVGGraphicsElement>('.aircraft-icon-body')!;
          const lane = marker.querySelector('.aircraft-speed-wake-base')!.parentElement as unknown as SVGGraphicsElement;
          const engine = new DOMPoint(20, 34).matrixTransform(body.getScreenCTM()!);
          const tail = new DOMPoint(0, 0).matrixTransform(lane.getScreenCTM()!);
          frames.push({ scale: new DOMMatrix(getComputedStyle(symbol).transform).a,
            zooming: (document.querySelector('.maplibre-surface') as HTMLElement).dataset.cameraZooming === 'true',
            gap: Math.hypot(engine.x - tail.x, engine.y - tail.y) });
          if (performance.now() - start < 950) requestAnimationFrame(collect);
          else resolve(frames);
        };
        requestAnimationFrame(collect);
      }, { once: true, capture: true });
    }), control);
    await page.getByRole('button', { name: control, exact: true }).click();
    const frames = await sample;
    const zoomFrames = frames.filter((frame) => frame.zooming);
    expect(zoomFrames.length).toBeGreaterThan(0);
    expect(zoomFrames.every(({ scale }) => Math.abs(scale - from) < .00001)).toBe(true);
    expect(frames.some(({ scale, zooming }) => !zooming && scale > Math.min(from, to) + .005 && scale < Math.max(from, to) - .005)).toBe(true);
    expect(frames.every(({ scale }, i) => i === 0 || (to > from
      ? scale >= frames[i - 1].scale - .00001 : scale <= frames[i - 1].scale + .00001))).toBe(true);
    expect(Math.max(...frames.map((frame) => frame.gap))).toBeLessThan(.02);
    await expect.poll(() => body.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)).toBeCloseTo(to, 4);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => body.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a))
    .toBeCloseTo(aircraftMapIconScale(8.2), 4);
  await expect(body.locator('.aircraft-icon-propeller')).toHaveCSS('animation-name', 'none');
});
