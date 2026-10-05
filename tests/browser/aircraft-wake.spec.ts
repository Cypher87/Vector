import { test, expect } from './radar-fixture';
import { applySyncPreferencePatch, type SyncPreferences } from '../../src/sync/preferences';

type WakeZoomProbe = Element & {
  wakeZoomFrames?: { done: boolean; frames: { opacity: number; display: string }[] };
};
type WakeDetailProbe = Element & {
  wakeDetailFrames?: { done: boolean; frames: { length: number; opacity: number }[] };
};

test.beforeEach(async ({ page, radar }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('vector.aircraftMotion', 'false'));
  radar.extraAircraft = [
    { flight: 'JET', t: 'A320', desc: 'L2J', category: 'A3', gs: 400 },
    { flight: 'PROP', t: 'C172', desc: 'L1P', category: 'A1', gs: 90 },
    { flight: 'TURBO', t: 'AT76', desc: 'L2T', category: 'A3', gs: 200 },
    { flight: 'HEAVY', t: 'B744', desc: 'L4J', category: 'A5', gs: 450 },
    { flight: 'GLIDER', t: 'GLID', category: 'B1', gs: 90 },
    { flight: 'ROTOR', t: 'H145', category: 'A7', gs: 90 },
  ].map((item, index) => ({
    ...item, hex: (0xff1000 + index).toString(16), type: 'adsb_icao',
    lat: 51.65 + Math.floor(index / 2) * .6, lon: 4.2 + index % 2 * 1,
    alt_baro: 15000, track: 45, seen: 0, seen_pos: 0, messages: 50,
  }));
});

for (const theme of ['vector', 'daylight']) {
  test(`speed trails follow aircraft families and leave bodies and GPS stable in ${theme}`, async ({ page, radar }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem('vector.theme', theme), theme);
    await page.goto('/');
    const marker = page.getByRole('button', { name: /^JET,/ });
    const jet = marker.locator('.aircraft-speed-wake');
    await expect(jet).toHaveCSS('display', 'inline');
    for (const [flight, style, count] of [['JET', 'jet', '2'], ['PROP', 'propeller', '1'], ['TURBO', 'turboprop', '2'], ['HEAVY', 'jet', '4']]) {
      const wake = page.getByRole('button', { name: new RegExp(`^${flight},`) }).locator('.aircraft-speed-wake');
      await expect(wake).toHaveAttribute('data-wake', style);
      await expect(wake).toHaveAttribute('data-engines', count);
      await expect(wake.locator('.aircraft-speed-wake-base')).toHaveCount(Number(count));
    }
    for (const flight of ['GLIDER', 'ROTOR', 'BALLOON']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${flight},`) }).locator('.aircraft-speed-wake')).toHaveCount(0);
    }
    await expect(page.locator('.aircraft-altitude-shadow-icon .aircraft-speed-wake, .list-aircraft-icon .aircraft-speed-wake')).toHaveCount(0);
    await expect(jet.locator('stop').first()).toHaveCSS('stop-color', theme === 'daylight' ? 'rgb(50, 74, 80)' : 'rgb(220, 227, 223)');
    // Guard against almost invisible strokes on detailed map tiles.
    await expect(jet.locator('stop').first()).toHaveCSS('stop-opacity', '0.42');
    await expect(jet.locator('stop').nth(1)).toHaveAttribute('offset', '45%');
    await expect(jet.locator('.aircraft-speed-wake-base').first()).toHaveCSS('stroke-width', '2.5px');
    await expect(jet.locator('.aircraft-speed-wake-base').first()).toHaveCSS('opacity', '0.45');
    await expect(jet).toHaveAttribute('data-length', '405');
    await expect(jet).toHaveAttribute('data-render-length', '111.72');
    await expect(jet.locator('stop').nth(1)).toHaveCSS('stop-opacity', '0.12');
    await expect(jet.locator('stop').nth(2)).toHaveCSS('stop-opacity', '0.025');
    // Fixed fixture coordinates have no traveled route: do not invent a tail.
    await expect(jet).toHaveAttribute('data-route', 'pending');
    await expect(jet.locator('.aircraft-speed-wake-base').first()).toHaveAttribute('d', '');
    const icon = marker.locator('.map-aircraft-icon');
    const body = icon.locator('.aircraft-icon-body');
    const bodyFilter = await body.evaluate((element) => getComputedStyle(element).filter);
    expect(bodyFilter).toContain('drop-shadow(');
    await expect(marker).toHaveCSS('filter', 'none');
    await expect(icon).toHaveCSS('filter', 'none');
    await expect(jet).toHaveCSS('filter', 'none');
    await expect(body.locator('.aircraft-speed-wake')).toHaveCount(0);
    const bodyTransform = await icon.evaluate((element) => getComputedStyle(element).transform);
    const before = (await marker.boundingBox())!;
    const flow = jet.locator('.aircraft-speed-wake-flow').first();
    await expect(flow).toHaveCSS('opacity', '0.08');
    const animation = await flow.evaluateHandle((element) => element.getAnimations()[0]);
    const initialOffset = await flow.evaluate((element) => getComputedStyle(element).strokeDashoffset);
    await expect.poll(() => flow.evaluate((element) => getComputedStyle(element).strokeDashoffset)).not.toBe(initialOffset);
    const initialLength = Number(await jet.getAttribute('data-length'));
    radar.extraAircraft[0].gs = 80;
    await expect.poll(async () => Number(await jet.getAttribute('data-length'))).toBeLessThan(initialLength);
    expect(await animation.evaluate((value) => value.playState)).toBe('running');
    await expect(icon).toHaveCSS('transform', bodyTransform);
    const after = (await marker.boundingBox())!;
    expect(Math.abs(before.x - after.x)).toBeLessThan(1);
    expect(Math.abs(before.y - after.y)).toBeLessThan(1);
    radar.extraAircraft[0].gs = 400;
    await expect.poll(async () => Number(await jet.getAttribute('data-length'))).toBe(initialLength);
    await page.screenshot({ path: testInfo.outputPath(`speed-trails-${theme}.png`) });
    await marker.click();
    await expect(marker).toHaveClass(/selected/);
    await expect(body).not.toHaveCSS('filter', bodyFilter);
    expect(await body.evaluate((element) => getComputedStyle(element).filter)).toContain('drop-shadow(');
    // A child cannot cancel a filter on its parent: check the entire wake ancestry.
    expect(await flow.evaluate((element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).filter !== 'none') return false;
        if (node.classList.contains('maplibre-surface')) return true;
      }
      return false;
    })).toBe(true);
    await expect(flow).toHaveCSS('opacity', '0.08');
    await expect(jet).toHaveAttribute('data-length', '405');
    Object.assign(radar.extraAircraft[1], { t: 'GLID', category: 'B1' });
    await expect(page.getByRole('button', { name: /^PROP,/ }).locator('.aircraft-speed-wake')).toHaveCount(0);
  });
}

test('trails disappear when zoomed out, stationary, stale, hidden, in replay or with reduced motion', async ({ page, radar }) => {
  await page.goto('/');
  const jet = page.getByRole('button', { name: /^JET,/ }).locator('.aircraft-speed-wake');
  await expect(jet).toHaveCSS('display', 'inline');
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(jet).toHaveCSS('opacity', '0');
  await expect(jet).toHaveCSS('display', 'inline');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(jet).toHaveCSS('opacity', '1');
  radar.extraAircraft[0].gs = 0;
  await expect(jet).toHaveCount(0);
  radar.extraAircraft[0].gs = 400;
  await expect(jet).toHaveCSS('display', 'inline');
  radar.timestamp = Date.now() / 1000 - 90;
  await expect(jet).toHaveCSS('display', 'none');
  radar.timestamp = undefined;
  await expect(jet).toHaveCSS('display', 'inline');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(jet).toHaveCSS('display', 'none');
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(jet).toHaveCSS('display', 'inline');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(jet).toHaveCSS('display', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(jet).toHaveCSS('display', 'inline');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'History timeline' })).toBeEnabled();
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-icon-animation', 'paused');
  expect(await page.locator('.aircraft-speed-wake').evaluateAll((elements) =>
    elements.every((element) => getComputedStyle(element).display === 'none'))).toBe(true);
});

test('zoom controls fade trails in both directions without removing the strokes', async ({ page }) => {
  await page.goto('/');
  const jet = page.getByRole('button', { name: /^JET,/ }).locator('.aircraft-speed-wake');
  const flow = jet.locator('.aircraft-speed-wake-flow').first();
  await expect(jet).toHaveCSS('opacity', '1');
  await expect(jet).toHaveCSS('transition-property', 'opacity');
  await expect(jet).toHaveCSS('transition-duration', '0.18s');

  for (const [control, target] of [['Zoom out', '0'], ['Zoom in', '1']]) {
    // Arm the probe before clicking, but start sampling on the actual click.
    // Playwright's actionability waits must not consume the sampling window.
    await jet.evaluate((element: WakeZoomProbe, control) => {
      const state = { done: false, frames: [] as { opacity: number; display: string }[] };
      element.wakeZoomFrames = state;
      document.querySelector(`button[aria-label="${control}"]`)!.addEventListener('click', () => {
        const start = performance.now();
        const sample = () => {
          const style = getComputedStyle(element);
          state.frames.push({ opacity: Number(style.opacity), display: style.display });
          if (performance.now() - start < 900) requestAnimationFrame(sample);
          else state.done = true;
        };
        requestAnimationFrame(sample);
      }, { once: true, capture: true });
    }, control);
    await page.getByRole('button', { name: control, exact: true }).click();
    await expect.poll(() => jet.evaluate((element: WakeZoomProbe) => element.wakeZoomFrames?.done)).toBe(true);
    const frames = await jet.evaluate((element: WakeZoomProbe) => element.wakeZoomFrames!.frames);
    const partial = frames.filter(({ opacity }) => opacity > .02 && opacity < .98);
    // Even a slow software renderer must show an intermediate state. Do not
    // impose a frame-rate target; verify progress, direction and both endpoints.
    expect(partial.length).toBeGreaterThan(0);
    expect(frames.every(({ display }) => display === 'inline')).toBe(true);
    expect(target === '0' ? frames[0].opacity > frames.at(-1)!.opacity : frames[0].opacity < frames.at(-1)!.opacity).toBe(true);
    expect(frames.every(({ opacity }, index) => index === 0 || (target === '0'
      ? opacity <= frames[index - 1].opacity + .001
      : opacity >= frames[index - 1].opacity - .001))).toBe(true);
    await expect(jet).toHaveCSS('opacity', target);
    await expect(flow).toHaveCSS('animation-play-state', target === '0' ? 'paused' : 'running');
  }

  // Reversing direction while fading must settle at the new target.
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(jet).toHaveCSS('opacity', '1');
});

test('aircraft trail layer is independent, persisted, and disabled in replay', async ({ page }, testInfo) => {
  await page.goto('/');
  const jet = page.getByRole('button', { name: /^JET,/ }).locator('.aircraft-speed-wake');
  const flow = jet.locator('.aircraft-speed-wake-flow').first();
  const rotor = page.getByRole('button', { name: /^ROTOR,/ }).locator('.aircraft-icon-rotor');
  const layers = page.getByRole('button', { name: 'Map layers', exact: true });
  const hide = page.getByRole('button', { name: 'Hide aircraft trails', exact: true });
  const show = page.getByRole('button', { name: 'Show aircraft trails', exact: true });
  await expect(jet).toHaveCSS('opacity', '1');
  await layers.click();
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await expect(hide).toContainText('Aircraft trails');
  const menu = page.locator('.vector-map-layer-menu');
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: testInfo.outputPath('aircraft-trails-layer.png') });

  await hide.click();
  await expect(show).toHaveAttribute('aria-pressed', 'false');
  await expect(jet).toHaveCSS('opacity', '0');
  await expect(flow).toHaveCSS('animation-play-state', 'paused');
  await expect(rotor).toHaveCSS('animation-play-state', 'running');
  await expect(page.getByRole('button', { name: 'Hide aircraft shadows', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Hide leg trace', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftWakes'))).toBe('false');

  // Zooming must not turn an explicitly disabled layer back on.
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(jet).toHaveCSS('opacity', '0');
  await page.reload();
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-wake-enabled', 'false');
  await expect(jet).toHaveCSS('opacity', '0');
  await layers.click();
  await show.click();
  await expect(jet).toHaveCSS('opacity', '1');
  await expect(flow).toHaveCSS('animation-play-state', 'running');
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftWakes'))).toBe('true');

  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'History timeline' })).toBeEnabled();
  await expect(hide).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('vector.aircraftWakes'))).toBe('true');
});

test('zoom smoothly changes trail length and fade without feed updates resetting them', async ({ page, radar }) => {
  await page.goto('/');
  const wake = page.getByRole('button', { name: /^JET,/ }).locator('.aircraft-speed-wake');
  await expect(wake).toHaveAttribute('data-render-length', '111.72');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  // Let the 250ms map easing finish before issuing another relative zoom.
  // Also exercise feed updates during the length transition.
  const overviewFeed = radar.aircraftRequests + 2;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(overviewFeed);
  // At 8.2 the length already grows, while the fade is still at overview strength.
  await expect(wake).toHaveAttribute('data-render-length', '268.72');
  for (const control of ['Zoom in', 'Zoom out']) {
    await wake.evaluate((element: WakeDetailProbe, control) => {
      const state = { done: false, frames: [] as { length: number; opacity: number }[] };
      element.wakeDetailFrames = state;
      document.querySelector(`button[aria-label="${control}"]`)!.addEventListener('click', () => {
        const start = performance.now();
        const sample = () => {
          state.frames.push({ length: Number(element.getAttribute('data-render-length')),
            opacity: Number(getComputedStyle(element.querySelectorAll('stop')[1]).stopOpacity) });
          if (performance.now() - start < 900) requestAnimationFrame(sample);
          else state.done = true;
        };
        requestAnimationFrame(sample);
      }, { once: true, capture: true });
    }, control);
    await page.getByRole('button', { name: control, exact: true }).click();
    await expect.poll(() => wake.evaluate((element: WakeDetailProbe) => element.wakeDetailFrames?.done)).toBe(true);
    const frames = await wake.evaluate((element: WakeDetailProbe) => element.wakeDetailFrames!.frames);
    const lengths = frames.map((frame) => frame.length), minimum = Math.min(...lengths), maximum = Math.max(...lengths);
    expect(maximum - minimum).toBeGreaterThan(30);
    expect(frames.some(({ length }) => length > minimum + 1 && length < maximum - 1)).toBe(true);
    for (const key of ['length', 'opacity'] as const) {
      expect(frames.every((frame, i) => i === 0 || (control === 'Zoom in'
        ? frame[key] >= frames[i - 1][key] - .001 : frame[key] <= frames[i - 1][key] + .001))).toBe(true);
    }
  }
  await expect(wake).toHaveAttribute('data-render-length', '268.72');
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const nextFeed = radar.aircraftRequests + 2;
    await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  }
  await expect(wake).toHaveAttribute('data-render-length', '405.00');
  await expect(wake.locator('stop').nth(1)).toHaveCSS('stop-opacity', '0.28');
  await expect(wake.locator('stop').nth(2)).toHaveCSS('stop-opacity', '0.12');
  const nextFeed = radar.aircraftRequests + 2;
  await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextFeed);
  await expect(wake).toHaveAttribute('data-render-length', '405.00');
});

test('paired trail preferences override local state and layer changes synchronize', async ({ page }) => {
  let preferences: SyncPreferences = { aircraftWakes: false, language: 'nl' };
  let revision = 1;
  await page.addInitScript(() => localStorage.setItem('vector.aircraftWakes', 'true'));
  await page.route('**/api/sync/session', (route) => route.fulfill({ json: {
    connected: true, deviceId: 'test-device', profileId: 'test-profile', preferences, revision,
  } }));
  await page.route('**/api/sync/events', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/sync/preferences', (route) => {
    preferences = applySyncPreferencePatch(preferences, route.request().postDataJSON().patch);
    return route.fulfill({ json: { preferences, revision: ++revision } });
  });
  await page.goto('/');
  const jet = page.getByRole('button', { name: /^JET,/ }).locator('.aircraft-speed-wake');
  await expect(page.locator('.maplibre-surface')).toHaveAttribute('data-wake-enabled', 'false');
  await expect(jet).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Kaartlagen', exact: true }).click();
  await page.getByRole('button', { name: 'Toon vliegtuigsporen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verberg vliegtuigsporen', exact: true })).toContainText('Vliegtuigsporen');
  await expect(jet).toHaveCSS('opacity', '1');
  await expect.poll(() => preferences.aircraftWakes).toBe(true);
});

test('trails follow received turns without extra trace requests', async ({ page, radar }, testInfo) => {
  Object.assign(radar.extraAircraft[0], { lat: 52.3, lon: 4.8, track: 90 });
  await page.goto('/');
  const marker = page.getByRole('button', { name: /^JET,/ });
  const wake = marker.locator('.aircraft-speed-wake');
  const path = wake.locator('.aircraft-speed-wake-base').first();
  await expect(wake).toHaveAttribute('data-route', 'pending');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  for (const position of [
    { lon: 4.807, lat: 52.3, track: 90 }, { lon: 4.814, lat: 52.3, track: 90 },
    { lon: 4.814, lat: 52.303, track: 0 }, { lon: 4.814, lat: 52.306, track: 0 },
  ]) {
    const before = await path.getAttribute('d');
    const nextSample = radar.aircraftRequests + 4;
    Object.assign(radar.extraAircraft[0], position);
    // The shared trace buffer samples at two-second intervals.
    await expect.poll(() => radar.aircraftRequests).toBeGreaterThanOrEqual(nextSample);
    await expect.poll(() => path.getAttribute('d')).not.toBe(before);
    await expect(wake).toHaveAttribute('data-route', 'measured');
  }
  await expect.poll(() => marker.locator('.map-aircraft-icon').evaluate((icon) => {
    const matrix = new DOMMatrix(getComputedStyle(icon).transform);
    return Math.abs(matrix.b);
  })).toBeLessThan(.01);
  const geometry = await path.evaluate((element: SVGPathElement) => {
    const length = element.getTotalLength();
    const start = element.getPointAtLength(0), middle = element.getPointAtLength(length / 2), end = element.getPointAtLength(length);
    return { length, cross: (middle.x - start.x) * (end.y - start.y) - (middle.y - start.y) * (end.x - start.x), end: { x: end.x, y: end.y } };
  });
  expect(geometry.length).toBeGreaterThan(10);
  expect(Math.abs(geometry.cross)).toBeGreaterThan(5);
  expect(geometry.end.x).toBeLessThan(-1);
  expect(radar.traceRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('measured-turn-trails.png') });
  Object.assign(radar.extraAircraft[0], { lon: 4.4, lat: 52.3 });
  await expect(wake).toHaveAttribute('data-route', 'pending');
  await expect(path).toHaveAttribute('d', '');
});
