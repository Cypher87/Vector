import assert from 'node:assert/strict';
import test from 'node:test';
import { aircraftMapIconScale, createAircraftIconSizer } from '../src/map/aircraft-map-size.ts';

test('map icons stay bounded between overview size and 46 pixels', () => {
  for (const zoom of [NaN, Infinity, -Infinity, -1, 5, 7.2]) assert.equal(aircraftMapIconScale(zoom), 1);
  for (const zoom of [11.5, 12, 24]) assert.equal(32.4 * aircraftMapIconScale(zoom), 46);
  assert.ok(32.4 * aircraftMapIconScale(9.2) > 38 && 32.4 * aircraftMapIconScale(9.2) < 39);
});

test('map icon sizing has no threshold jumps or overshoot', () => {
  let previous = 32.4;
  for (let step = 1; step <= 430; step++) {
    const size = 32.4 * aircraftMapIconScale(7.2 + step / 100);
    assert.ok(size >= previous && size <= 46);
    assert.ok(size - previous < .05);
    previous = size;
  }
  assert.ok(aircraftMapIconScale(7.201) - 1 < .000001);
  assert.ok(46 / 32.4 - aircraftMapIconScale(11.499) < .000001);
});

function sizeAnimation() {
  let now = 0, id = 0;
  const callbacks = new Map<number, (time: number) => void>();
  const sizes: number[] = [];
  const state = { animate: true };
  const sizer = createAircraftIconSizer(7.2, {
    now: () => now,
    requestFrame: (callback) => { callbacks.set(++id, callback); return id; },
    cancelFrame: (key) => { callbacks.delete(key); },
    shouldAnimate: () => state.animate,
    setScale: (value) => sizes.push(value),
  });
  return { sizer, sizes, state, callbacks, step(time: number) {
    now = time;
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(now));
  } };
}

test('icon size stays fixed during camera zoom, then eases to the target in 180ms', () => {
  const { sizer, sizes, step, callbacks } = sizeAnimation();
  sizer.zoomStart();
  step(1_000);
  assert.deepEqual(sizes, [1]);
  sizer.zoomEnd(9.2);
  for (const time of [1_030, 1_060, 1_090, 1_120, 1_150, 1_180]) step(time);
  const target = aircraftMapIconScale(9.2);
  assert.equal(sizes.at(-1), target);
  assert.ok(sizes.slice(1, -1).every((value) => value > 1 && value < target));
  assert.ok(sizes.every((value, index) => index === 0 || value > sizes[index - 1]));
  assert.equal(callbacks.size, 0);
  sizer.zoomStart();
  step(2_000);
  assert.equal(sizes.at(-1), target);
  sizer.zoomEnd(7.2);
  step(2_090);
  assert.ok(sizes.at(-1)! < target && sizes.at(-1)! > 1);
  step(2_180);
  assert.equal(sizes.at(-1), 1);
});

test('a new zoom freezes an unfinished resize and resumes from that size without jumping', () => {
  const { sizer, sizes, step, callbacks } = sizeAnimation();
  sizer.zoomEnd(11.5);
  step(60);
  const frozen = sizes.at(-1)!;
  const staleCallback = [...callbacks.values()][0];
  sizer.zoomStart();
  staleCallback(180);
  step(600);
  assert.equal(sizes.at(-1), frozen);
  assert.equal(callbacks.size, 0);
  sizer.zoomEnd(7.2);
  step(630);
  assert.ok(sizes.at(-1)! < frozen && sizes.at(-1)! > 1);
  step(780);
  assert.equal(sizes.at(-1), 1);
});

test('reduced motion settles immediately; disposing cancels all queued resizing', () => {
  const { sizer, state, sizes, callbacks, step } = sizeAnimation();
  state.animate = false;
  sizer.zoomEnd(9.2);
  assert.equal(sizes.at(-1), aircraftMapIconScale(9.2));
  assert.equal(callbacks.size, 0);
  state.animate = true;
  sizer.zoomEnd(11.5);
  step(30);
  state.animate = false;
  step(60);
  assert.equal(sizes.at(-1), aircraftMapIconScale(11.5));
  state.animate = true;
  sizer.zoomEnd(7.2);
  const pending = [...callbacks.values()][0];
  sizer.dispose();
  pending(300);
  sizer.zoomEnd(7.2);
  assert.equal(callbacks.size, 0);
  assert.equal(sizes.at(-1), aircraftMapIconScale(11.5));
});
