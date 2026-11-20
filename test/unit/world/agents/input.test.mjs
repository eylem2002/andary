import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClick, keyAction, raySegmentDistance } from '../../../../public/js/world/agents/input.js';

const v = (x, y, z) => ({ x, y, z });

test('a ray through a figure has zero distance to its axis', () => {
  const norm = Math.SQRT1_2;
  const hit = raySegmentDistance(v(-10, 10, 0), v(norm, -norm, 0), v(0, 0, 0), v(0, 1, 0));
  assert.ok(hit.distance < 1e-9);
  assert.ok(Math.abs(hit.along - Math.hypot(10, 10)) < 1e-9);
});

test('a ray passing beside a figure reports the gap', () => {
  const miss = raySegmentDistance(v(0.5, 10, -5), v(0, 0, 1), v(0, 0, 0), v(0, 1, 0));
  // The ray runs at height 10, above the segment's top (y = 1): closest point is the top end.
  assert.ok(Math.abs(miss.distance - Math.hypot(0.5, 9)) < 1e-9);
});

test('a ray parallel to the figure axis measures the horizontal gap', () => {
  const r = raySegmentDistance(v(0.3, 10, 0), v(0, -1, 0), v(0, 0, 0), v(0, 1, 0));
  assert.ok(Math.abs(r.distance - 0.3) < 1e-9);
});

test('keys map to camera actions; modified keys are left to the browser', () => {
  assert.deepEqual(keyAction({ key: 'ArrowLeft' }), { type: 'pan', right: -1, up: 0 });
  assert.deepEqual(keyAction({ key: 'ArrowUp', shiftKey: true }), { type: 'pan', right: 0, up: 3 });
  assert.deepEqual(keyAction({ key: '+' }), { type: 'zoom', factor: 1.25 });
  assert.deepEqual(keyAction({ key: '-' }), { type: 'zoom', factor: 0.8 });
  assert.deepEqual(keyAction({ key: 'q' }), { type: 'rotate', dir: -1 });
  assert.deepEqual(keyAction({ key: 'E' }), { type: 'rotate', dir: 1 });
  assert.deepEqual(keyAction({ key: 'Escape' }), { type: 'deselect' });
  assert.equal(keyAction({ key: 'r', ctrlKey: true }), null);
  assert.equal(keyAction({ key: 'x' }), null);
});

test('a small, quick press is a click; a drag is not', () => {
  assert.equal(isClick({ x: 10, y: 10, t: 0 }, { x: 13, y: 12, t: 150 }), true);
  assert.equal(isClick({ x: 10, y: 10, t: 0 }, { x: 40, y: 10, t: 150 }), false);
  assert.equal(isClick({ x: 10, y: 10, t: 0 }, { x: 10, y: 10, t: 5000 }), false);
});
