import { test, expect } from './radar-fixture';
import { aircraftMapIconScale } from '../../src/map/aircraft-map-size';

test('dense traffic keeps zoom responsive with trails enabled', async ({ page, radar }, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('vector.mapLabels', 'false');
    localStorage.setItem('vector.aircraftMotion', 'true');
  });
  radar.extraAircraft = Array.from({ length: 180 }, (_, i) => ({
    hex: (0xee0000 + i).toString(16), flight: `PERF${i}`, t: 'A320', desc: 'L2J', category: 'A3',
    type: 'adsb_icao', lat: 52.1 + Math.floor(i / 15) * .035, lon: 4.5 + i % 15 * .04,
    alt_baro: 20000, gs: 400, track: 90, seen: 0, seen_pos: 0, messages: 50,
  }));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(182);
  // Build real traveled routes via feed updates, never a straight invented tail.
  for (let step = 0; step < 8; step++) {
    const nextFeed = radar.aircraftRequests + 1;
    radar.extraAircraft.forEach((item) => { item.lon = Number(item.lon) + .008; });
    await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  }
  await expect(page.getByRole('button', { name: /^PERF90,/ }).locator('.aircraft-speed-wake')).toHaveAttribute('data-route', 'measured');
  const surface = page.locator('.maplibre-surface');
  const canvas = page.locator('.map-wake-canvas');
  await expect(surface).toHaveAttribute('data-wake-renderer', 'canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.aircraft-wake-svg').first()).toBeHidden();
  // The replacement really paints the trails; hiding SVGs alone is not a fix.
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
  const writes = await surface.evaluateHandle((element) => {
    const root = element as HTMLElement;
    let previousScale = root.style.getPropertyValue('--aircraft-icon-scale');
    const result = { count: 0, resizesDuringZoom: 0 };
    const observer = new MutationObserver((changes) => {
      result.count += changes.filter((change) => change.target !== root).length;
      const scale = root.style.getPropertyValue('--aircraft-icon-scale');
      if (scale !== previousScale && root.dataset.cameraZooming === 'true') result.resizesDuringZoom++;
      previousScale = scale;
    });
    observer.observe(root, { attributes: true, attributeFilter: ['style'] });
    element.querySelectorAll('.aircraft-wake-svg').forEach((icon) => observer.observe(icon,
      { attributes: true, subtree: true, attributeFilter: ['d', 'x2', 'y2'] }));
    return { result, stop() { observer.disconnect(); } };
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const before = await session.send('Performance.getMetrics');
  for (const control of ['Zoom in', 'Zoom in', 'Zoom out', 'Zoom out']) {
    await page.getByRole('button', { name: control, exact: true }).click();
    // Fixed sample windows make local before/after CPU measurements comparable.
    await page.waitForTimeout(600);
  }
  const after = await session.send('Performance.getMetrics');
  const names = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
  const metrics = Object.fromEntries(names.map((name) => [name,
    after.metrics.find((metric) => metric.name === name)!.value - before.metrics.find((metric) => metric.name === name)!.value]));
  await testInfo.attach('zoom-cpu-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  console.info('Zoom CPU metrics:', JSON.stringify(metrics));
  // CPU timings are diagnostic, not hard thresholds on shared software-rendered CI.
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(182);
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-wake-enabled', 'true');
  expect(await writes.evaluate((probe) => { probe.stop(); return probe.result; })).toEqual({ count: 0, resizesDuringZoom: 0 });
  await session.detach();
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Hide aircraft trails', exact: true }).click();
  await expect(canvas).toBeHidden();
  await page.getByRole('button', { name: 'Show aircraft trails', exact: true }).click();
  await expect(canvas).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(canvas).toBeVisible();
  // Sparse maps can return to the ordinary renderer without losing the route.
  radar.extraAircraft = radar.extraAircraft.filter((item) => item.flight === 'PERF90');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(3);
  await expect(surface).toHaveAttribute('data-wake-renderer', 'svg');
  await expect(canvas).toBeHidden();
  await expect(page.getByRole('button', { name: /^PERF90,/ }).locator('.aircraft-speed-wake-base').first())
    .toHaveAttribute('d', /L/);
});

test('hidden labels are not measured and hidden distance rings are not redrawn during zoom', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vector.mapLabels', 'false'));
  await page.goto('/');
  await expect(page.locator('.aircraft-map-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Map layers', exact: true }).click();
  await page.getByRole('button', { name: 'Show distance rings', exact: true }).click();
  const rings = page.locator('.map-distance-rings-overlay');
  await expect(rings.locator('polyline').first()).toHaveAttribute('points', /\d/);
  await page.getByRole('button', { name: 'Hide distance rings', exact: true }).click();
  const before = await rings.locator('polyline').first().getAttribute('points');
  const probe = await page.evaluateHandle(() => {
    const result = { measurements: 0, writes: 0 };
    const originals = ['offsetWidth', 'offsetHeight'].map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)!;
      Object.defineProperty(HTMLElement.prototype, name, { ...descriptor, get() {
        if (this.classList?.contains('map-plane-label')) result.measurements++;
        return descriptor.get!.call(this);
      } });
      return { name, descriptor };
    });
    const observer = new MutationObserver((changes) => { result.writes += changes.length; });
    observer.observe(document.querySelector('.map-distance-rings-overlay')!, { attributes: true, subtree: true });
    return { result, stop() { observer.disconnect(); originals.forEach(({ name, descriptor }) => Object.defineProperty(HTMLElement.prototype, name, descriptor)); } };
  });
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => page.locator('.maplibre-surface').evaluate((element) => Number((element as HTMLElement).style.getPropertyValue('--aircraft-icon-scale'))))
    .toBeCloseTo(aircraftMapIconScale(8.2), 4);
  expect(await probe.evaluate((probe) => { probe.stop(); return probe.result; })).toEqual({ measurements: 0, writes: 0 });
  await expect(rings.locator('polyline').first()).toHaveAttribute('points', before!);
  await page.getByRole('button', { name: 'Show distance rings', exact: true }).click();
  await expect(rings.locator('polyline').first()).not.toHaveAttribute('points', before!);
  await page.getByRole('button', { name: 'Show aircraft labels', exact: true }).click();
  await expect(page.locator('.map-plane-label:not(.label-hidden)').first()).toBeVisible();
});
