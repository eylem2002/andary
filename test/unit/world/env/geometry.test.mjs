import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GeometryBatch } from '../../../../public/js/world/env/batch.js';
import { Kit } from '../../../../public/js/world/env/kit.js';
import { S } from '../../../../public/js/world/env/palette.js';
import { bounceAt } from '../../../../public/js/world/env/building-fx.js';

const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

test('GeometryBatch merges parts with colour and per-vertex info', () => {
  const batch = new GeometryBatch(4);
  const box = new THREE.BoxGeometry(1, 1, 1);
  batch.add(box, new THREE.Matrix4().makeTranslation(10, 0, 0), { color: 0xff0000, surface: S.glass, building: 3, glow: 1, seed: 0.5 });
  batch.add(box, new THREE.Matrix4(), { color: 0x0000ff });
  const g = batch.build();
  assert.equal(g.getAttribute('position').count, 48, 'buffers grew past the initial capacity');
  assert.equal(g.getIndex().count, 72);
  const info = g.getAttribute('aInfo');
  assert.deepEqual([info.getX(0), info.getY(0), info.getZ(0), info.getW(0)], [3, S.glass, 255, 128]);
  assert.deepEqual([info.getX(30), info.getY(30)], [0, S.matte]);
  const color = g.getAttribute('color');
  assert.equal(color.normalized, true);
  assert.equal(color.array[0], 255, 'red channel');
  assert.equal(color.array[2], 0, 'blue channel');
  g.computeBoundingBox();
  assert.ok(near(g.boundingBox.max.x, 10.5) && near(g.boundingBox.min.x, -0.5));
  box.dispose();
  g.dispose();
});

test('Kit places boxes by their bottom centre and nests frames', () => {
  const batch = new GeometryBatch();
  const kit = new Kit(batch);
  kit.push(100, 0, 0, Math.PI / 2);
  kit.box([0, 2, 0], [2, 4, 6], 0xffffff);
  kit.pop();
  const g = batch.build();
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  // Rotated a quarter turn: the 6-deep box now spans x, the 2-wide side spans z.
  assert.ok(near(min.y, 2) && near(max.y, 6), 'stands on y = 2');
  assert.ok(near(max.x - min.x, 6) && near(max.z - min.z, 2));
  assert.ok(near((min.x + max.x) / 2, 100), 'inside the pushed frame');
  kit.dispose();
  g.dispose();
});

test('Kit.beam spans exactly between its end points', () => {
  const batch = new GeometryBatch();
  const kit = new Kit(batch);
  kit.beam([0, 0, 0], [0, 5, 0], 0.1, 0xffffff);
  kit.beam([1, 1, 1], [1, 1, 1], 0.1, 0xffffff);
  const g = batch.build();
  g.computeBoundingBox();
  assert.equal(g.getAttribute('position').count, 24, 'a zero-length beam adds nothing');
  assert.ok(near(g.boundingBox.min.y, 0) && near(g.boundingBox.max.y, 5));
  kit.dispose();
  g.dispose();
});

test('Kit caches shared unit geometry', () => {
  const kit = new Kit(new GeometryBatch());
  kit.box([0, 0, 0], [1, 1, 1], 0xffffff);
  kit.box([5, 0, 0], [2, 3, 4], 0xffffff);
  kit.cyl([0, 0, 0], 1, 2, 0xffffff);
  kit.cyl([0, 0, 0], 3, 1, 0xffffff);
  assert.equal(kit.cache.size, 2);
  kit.dispose();
  assert.equal(kit.cache.size, 0);
});

test('a pulse bounce stretches first, then settles to rest', () => {
  assert.equal(bounceAt(0), 0);
  assert.ok(bounceAt(0.12) > 0.05, 'stretches up first');
  const later = Array.from({ length: 10 }, (_, i) => Math.abs(bounceAt(0.9 + i * 0.02)));
  assert.ok(Math.max(...later) < 0.03, 'nearly still before it ends');
});
