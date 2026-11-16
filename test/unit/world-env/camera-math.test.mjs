import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISO_PITCH,
  ISO_YAW,
  cameraDirection,
  clamp,
  clampTarget,
  damp,
  easeInOutCubic,
  fitHalfHeight,
  groundTargetFor,
  projectedTownSize,
  screenPanToWorld,
  yawForStep,
} from '../../../public/js/world/env/camera-math.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('the default camera looks from the south-east and from above', () => {
  const [x, y, z] = cameraDirection(ISO_YAW, ISO_PITCH);
  assert.ok(x > 0 && z > 0 && y > 0);
  assert.ok(near(Math.hypot(x, y, z), 1));
});

test('damp converges and is frame-rate independent', () => {
  const oneStep = damp(0, 10, 5, 0.1);
  const twoSteps = damp(damp(0, 10, 5, 0.05), 10, 5, 0.05);
  assert.ok(near(oneStep, twoSteps, 1e-9));
  assert.ok(damp(0, 10, 5, 10) > 9.99);
  assert.equal(damp(3, 3, 5, 0.1), 3);
});

test('easeInOutCubic is clamped and symmetric', () => {
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(2), 1);
  assert.ok(near(easeInOutCubic(0.5), 0.5));
  assert.ok(near(easeInOutCubic(0.25) + easeInOutCubic(0.75), 1));
});

test('groundTargetFor puts a raised point on the screen centre ray', () => {
  const dir = cameraDirection(ISO_YAW, ISO_PITCH);
  const p = { x: 3, y: 2, z: -4 };
  const t = groundTargetFor(p, dir);
  // The point must lie on the ray from the ground target towards the camera.
  const k = p.y / dir[1];
  assert.ok(near(t.x + dir[0] * k, p.x));
  assert.ok(near(t.z + dir[2] * k, p.z));
  assert.deepEqual(groundTargetFor({ x: 1, y: 0, z: 2 }, dir), { x: 1, z: 2 });
});

test('screenPanToWorld moves right along the camera right vector', () => {
  const right = screenPanToWorld(1, 0, ISO_YAW);
  // Looking north-west from the south-east, screen-right points north-east.
  assert.ok(right.x > 0 && right.z < 0);
  assert.ok(near(Math.hypot(right.x, right.z), 1));
  const toward = screenPanToWorld(0, 1, ISO_YAW);
  assert.ok(toward.x > 0 && toward.z > 0, 'towards the viewer is south-east');
});

test('yawForStep rotates in quarter turns', () => {
  assert.equal(yawForStep(0), ISO_YAW);
  assert.ok(near(yawForStep(2) - yawForStep(0), Math.PI));
});

test('fitHalfHeight frames the whole town on wide screens and crops less on phones', () => {
  const desktop = fitHalfHeight(1440, 900);
  const size = projectedTownSize(ISO_YAW, ISO_PITCH);
  const visibleWidth = desktop * 2 * (1440 / 900);
  const visibleHeight = desktop * 2;
  assert.ok(visibleWidth >= size.width * 0.9 - 1e-9);
  assert.ok(visibleHeight >= size.height * 0.9);
  const phone = fitHalfHeight(390, 844);
  const phoneWidth = phone * 2 * (390 / 844);
  assert.ok(phoneWidth < size.width, 'phones crop the corners');
  assert.ok(phoneWidth > size.width * 0.5, 'but still show most of the town');
});

test('clamp and clampTarget keep values in bounds', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.deepEqual(clampTarget({ x: 100, z: -100 }, { minX: -10, maxX: 10, minZ: -5, maxZ: 5 }), { x: 10, z: -5 });
});
