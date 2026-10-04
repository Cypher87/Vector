import assert from 'node:assert/strict';
import test from 'node:test';
import { boxesOverlap, compactAircraftLabel, layoutAircraftLabels, type LabelCandidate } from '../src/map/label-layout.ts';

const candidate = (id: string, overrides: Partial<LabelCandidate> = {}): LabelCandidate => ({
  id, x: 250, y: 200, width: 82, height: 32, selected: false, favorite: false, focused: false, ...overrides,
});

test('dense labels avoid each other, boundaries and controls in CSS pixels', () => {
  const candidates = Array.from({ length: 80 }, (_, i) => candidate(String(i), {
    x: 30 + (i % 10) * 32, y: 60 + Math.floor(i / 10) * 28,
  }));
  const control = { left: 325, right: 390, top: 0, bottom: 220 };
  const placements = layoutAircraftLabels(candidates, 390, 500, 8, [control]);
  assert.ok(placements.size > 0 && placements.size < candidates.length);
  const boxes = [...placements.values()].map((value) => value.box);
  for (const [index, box] of boxes.entries()) {
    assert.ok(box.left >= 6 && box.right <= 384 && box.top >= 6 && box.bottom <= 494);
    assert.equal(boxesOverlap(box, control), false);
    for (const other of boxes.slice(index + 1)) assert.equal(boxesOverlap(box, other), false);
  }
});

test('selected and focused aircraft take priority, followed by favorites', () => {
  const entries = [candidate('a'), candidate('b', { favorite: true }), candidate('c', { selected: true })];
  const result = layoutAircraftLabels(entries, 400, 400, 8);
  assert.equal([...result.keys()][0], 'c');
  assert.equal([...result.keys()][1], 'b');
  const distant = layoutAircraftLabels([candidate('a'), candidate('b', { favorite: true }), candidate('c', { focused: true })], 400, 400, 4);
  assert.equal(distant.has('a'), false);
  assert.equal(distant.has('b'), true);
  assert.equal(distant.has('c'), true);
});

test('labels use another side near edges and preserve a valid previous side', () => {
  const result = layoutAircraftLabels([candidate('edge', { x: 360 })], 400, 400, 8);
  assert.equal(result.get('edge')?.side, 'left');
  assert.equal(layoutAircraftLabels([candidate('stable', { previous: 'top' })], 500, 400, 8).get('stable')?.side, 'top');
});

test('layout is deterministic regardless of feed order and becomes compact when zoomed out', () => {
  const entries = [candidate('b'), candidate('a', { x: 280 }), candidate('c', { y: 250 })];
  assert.deepEqual(layoutAircraftLabels(entries, 500, 400, 8), layoutAircraftLabels([...entries].reverse(), 500, 400, 8));
  assert.equal(compactAircraftLabel(6, false), true);
  assert.equal(compactAircraftLabel(6, true), false);
  assert.equal(compactAircraftLabel(8, false), false);
});
