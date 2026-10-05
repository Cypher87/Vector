import { test, expect } from './radar-fixture';
import { aircraftWakeLane } from '../../src/map/aircraft-wake-route';

for (const [type, description, category] of [['A320', 'L2J', 'A3'], ['C25A', 'L2J', 'A2'], ['B744', 'L4J', 'A5']]) {
for (const tone of ['dark', 'light']) {
test(`${type} parallel trails retain equal visual weight at different headings in ${tone}`, async ({ page, radar }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  radar.extraAircraft = [{
    hex: 'ff2000', flight: 'WAKE', t: type, desc: description, category,
    type: 'adsb_icao', lat: 52.3, lon: 4.8, alt_baro: 15000,
    gs: 400, track: 0, seen: 0, seen_pos: 0, messages: 50,
  }];
  await page.goto('/');
  const source = page.getByRole('button', { name: /^WAKE,/ });
  await expect(source.locator('.aircraft-speed-wake')).toHaveCSS('display', 'inline');

  // Use the actual DOM renderer and app CSS, at real CSS-pixel size. A uniform
  // background isolates rasterization from road labels and map-tile details.
  const samples = await source.evaluate((element, tone) => {
    const stage = document.createElement('section');
    stage.id = 'wake-rendering-review';
    stage.className = 'maplibre-surface';
    stage.style.setProperty('--aircraft-wake-opacity', '1');
    const background = tone === 'dark' ? 220 : 40;
    Object.assign(stage.dataset, { iconAnimation: 'running', pageVisible: 'true', wakeEnabled: 'true', wakeVisible: 'true', wakeTone: tone });
    Object.assign(stage.style, { position: 'fixed', inset: '0 auto auto 0', width: '360px', height: '660px', background: `rgb(${background}, ${background}, ${background})`, zIndex: '999999' });
    document.body.append(stage);
    return [0, 27, 45, 90, 203, 315].map((heading, index) => {
      const marker = element.cloneNode(true) as HTMLElement;
      marker.querySelector('.map-plane-label')?.remove();
      const x = 90 + (index % 2) * 180 + index * .13;
      const y = 80 + Math.floor(index / 2) * 220;
      Object.assign(marker.style, { left: `${x}px`, top: `${y}px`, transform: 'translate(-50%, -50%)' });
      const icon = marker.querySelector<SVGSVGElement>('.aircraft-wake-svg')!;
      icon.style.transform = `rotate(${heading}deg) scale(1)`;
      marker.querySelector<SVGSVGElement>('.map-aircraft-icon')!.style.transform = icon.style.transform;
      const gradient = icon.querySelector('linearGradient')!;
      gradient.id = `wake-review-${index}`;
      // Isolate pixel coverage with a straight reference route; geographic
      // route geometry and turn anchoring have separate regression tests.
      const length = icon.querySelector<SVGGElement>('.aircraft-speed-wake')!.dataset.length!;
      gradient.setAttribute('x2', '0');
      gradient.setAttribute('y2', length);
      for (const path of icon.querySelectorAll<SVGPathElement>('.aircraft-speed-wake path')) {
        path.setAttribute('stroke', `url(#${gradient.id})`);
        // Clip the straight sample, not its full-length gradient, so other
        // test markers' longer tails cannot contaminate the pixel comparison.
        path.setAttribute('d', `M0 0V${Math.min(95, Number(length))}`);
      }
      // Compare equal animation phases, not different moments in the flow.
      for (const flow of icon.querySelectorAll<SVGPathElement>('.aircraft-speed-wake-flow')) {
        flow.style.animation = 'none';
        flow.style.strokeDashoffset = '0';
      }
      stage.append(marker);
      const label = document.createElement('span');
      label.textContent = `${heading}°`;
      Object.assign(label.style, { position: 'absolute', left: `${x - 12}px`, top: `${y + 98}px`, color: tone === 'dark' ? '#384348' : '#c4d0d0', font: '12px sans-serif' });
      stage.append(label);
      return { heading, lanes: [...icon.querySelectorAll<SVGPathElement>('.aircraft-speed-wake-base')].map((path) => {
        const matrix = path.getScreenCTM()!;
        return Array.from({ length: 30 }, (_, offset) => {
          const point = path.getPointAtLength(20 + offset).matrixTransform(matrix);
          return { x: point.x, y: point.y };
        });
      }) };
    });
  }, tone);
  const screenshot = await page.screenshot({ path: testInfo.outputPath('wake-rendering.png'), clip: { x: 0, y: 0, width: 360, height: 660 }, scale: 'css' });
  const weights = await page.evaluate(async ({ png, samples, background }) => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    image.close();
    return samples.map(({ heading, lanes }) => {
      const ink = lanes.map((points) => points.reduce((sum, point) => {
        let darkest = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const pixel = ((Math.floor(point.y) + dy) * canvas.width + Math.floor(point.x) + dx) * 4;
          darkest = Math.max(darkest, Math.abs(background - pixels[pixel]));
        }
        return sum + darkest;
      }, 0) / points.length);
      return { heading, ink, ratio: Math.max(...ink) / Math.min(...ink) };
    });
  }, { png: screenshot.toString('base64'), samples, background: tone === 'dark' ? 220 : 40 });
  await testInfo.attach('stroke-weights', { body: JSON.stringify(weights, null, 2), contentType: 'application/json' });
  for (const sample of weights) {
    expect(Math.min(...sample.ink), JSON.stringify(sample)).toBeGreaterThan(15);
    expect(sample.ratio, JSON.stringify(sample)).toBeLessThan(1.2);
  }
});
}
}

for (const tone of ['dark', 'light']) {
test(`long curved trails remain light and continuous in ${tone}`, async ({ page, radar }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  radar.extraAircraft = [{
    hex: 'ff2000', flight: 'WAKE', t: 'A320', desc: 'L2J', category: 'A3',
    type: 'adsb_icao', lat: 52.3, lon: 4.8, alt_baro: 15000,
    gs: 400, track: 0, seen: 0, seen_pos: 0, messages: 50,
  }];
  await page.goto('/');
  const source = page.getByRole('button', { name: /^WAKE,/ });
  await expect(source.locator('.aircraft-speed-wake')).toHaveAttribute('data-length', '405');
  const centerline = [[0, 0], [0, 120], [65, 220], [60, 370], [-25, 450], [-45, 600], [0, 800], [0, 900]]
    .map(([x, y]) => ({ x: x / 2, y: y / 2 }));
  const lanes = [0, 1].map((index) => aircraftWakeLane({
    style: 'jet', origins: [[11.5, 27], [28.5, 27]], length: 405, width: 2.5, duration: 1.6,
  }, index, centerline));
  // Feed a long reference route to the real SVG/CSS renderer. Live feed-to-route
  // integration is covered separately; this isolates the full trail's styling.
  await source.evaluate((element, { tone, lanes }) => {
    const stage = document.createElement('section');
    stage.id = 'long-wake-review';
    stage.className = 'maplibre-surface';
    stage.style.setProperty('--aircraft-wake-opacity', '1');
    Object.assign(stage.dataset, { iconAnimation: 'running', pageVisible: 'true', wakeEnabled: 'true', wakeVisible: 'true', wakeTone: tone });
    Object.assign(stage.style, { position: 'fixed', inset: '0 auto auto 0', width: '360px', height: '720px', background: tone === 'dark' ? '#dcdcdc' : '#282828', zIndex: '999999' });
    const marker = element.cloneNode(true) as HTMLElement;
    marker.querySelector('.map-plane-label')?.remove();
    Object.assign(marker.style, { left: '180px', top: '65px', transform: 'translate(-50%, -50%)' });
    const icon = marker.querySelector<SVGSVGElement>('.aircraft-wake-svg')!;
    icon.style.transform = 'rotate(0deg) scale(1)';
    const gradients = icon.querySelectorAll('linearGradient');
    for (const [index, group] of [...icon.querySelectorAll('.aircraft-speed-wake > g')].entries()) {
      const gradient = gradients[index];
      gradient.id = `long-wake-review-${index}`;
      gradient.setAttribute('x2', String(lanes[index].end.x));
      gradient.setAttribute('y2', String(lanes[index].end.y));
      for (const path of group.querySelectorAll('path')) {
        path.setAttribute('stroke', `url(#${gradient.id})`);
        path.setAttribute('d', lanes[index].path);
        path.style.animation = 'none';
      }
    }
    stage.append(marker);
    document.body.append(stage);
  }, { tone, lanes });
  const strokes = page.locator('#long-wake-review .aircraft-speed-wake-base');
  for (const stroke of await strokes.all()) {
    await expect(stroke).toHaveCSS('opacity', '0.45');
    expect(await stroke.evaluate((path: SVGPathElement) => path.getTotalLength())).toBeGreaterThan(370);
  }
  await page.screenshot({ path: testInfo.outputPath('long-curved-trails.png'), clip: { x: 0, y: 0, width: 360, height: 720 }, scale: 'css' });
});
}
