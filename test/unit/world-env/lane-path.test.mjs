import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleDelta, createPath, offsetPolyline, rightOf, roundCorners } from '../../../public/js/world/env/lane-path.js';
import { ringRoadCorners } from '../../../public/js/world/layout.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('rightOf: facing east, the right-hand side is south (+z)', () => {
  const r = rightOf(1, 0);
  assert.ok(near(r.x, 0) && near(r.z, 1));
});

test('clockwise ring road traffic drives on the inside of the loop', () => {
  const corners = ringRoadCorners();
  const lane = offsetPolyline(corners, 0.5, true);
  // North-west corner moves south-east (inside), by the lane width on each axis.
  assert.ok(near(lane[0].x, corners[0].x + 0.5));
  assert.ok(near(lane[0].z, corners[0].z + 0.5));
  // South-east corner moves north-west.
  assert.ok(near(lane[2].x, corners[2].x - 0.5));
  assert.ok(near(lane[2].z, corners[2].z - 0.5));
});

test('offsetPolyline keeps an open straight line parallel', () => {
  const lane = offsetPolyline([{ x: 0, z: 0 }, { x: 10, z: 0 }], 1, false);
  assert.deepEqual(lane.map((p) => [p.x, p.z]), [
    [0, 1],
    [10, 1],
  ]);
});

test('roundCorners keeps the end points of an open path and shortens corners', () => {
  const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  const round = roundCorners(pts, 2, false, 4);
  assert.deepEqual(round[0], { x: 0, z: 0 });
  assert.deepEqual(round[round.length - 1], { x: 10, z: 10 });
  const sharp = createPath(pts, false).length;
  const curved = createPath(round, false).length;
  assert.ok(curved < sharp);
});

test('createPath samples by distance and wraps closed paths', () => {
  const square = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
  const path = createPath(square, true);
  assert.equal(path.length, 16);
  const out = { x: 0, z: 0, angle: 0 };
  path.sample(2, out);
  assert.ok(near(out.x, 2) && near(out.z, 0));
  assert.ok(near(out.angle, 0), 'heading east');
  path.sample(18, out);
  assert.ok(near(out.x, 2) && near(out.z, 0), 'wraps around');
  path.sample(6, out);
  assert.ok(near(out.x, 4) && near(out.z, 2));
  assert.ok(near(out.angle, -Math.PI / 2), 'heading south');
  path.sample(1, out);
  assert.ok(near(out.x, 1), 'sampling backwards works after moving the cursor forward');
});

test('open paths clamp at their ends', () => {
  const path = createPath([{ x: 0, z: 0 }, { x: 3, z: 0 }], false);
  const out = { x: 0, z: 0, angle: 0 };
  path.sample(99, out);
  assert.equal(out.x, 3);
  path.sample(-5, out);
  assert.equal(out.x, 0);
});

test('angleDelta picks the short way round', () => {
  assert.ok(near(angleDelta(0.1, -0.1), -0.2));
  assert.ok(near(angleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2));
});
