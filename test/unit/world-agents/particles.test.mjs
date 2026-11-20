import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CURVE, ParticleField, curveScale, spawnSpec } from '../../../public/js/world/agents/particles.js';

const field = (capacity = 8, orient = undefined) =>
  new ParticleField({ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial(), capacity, orient });

test('scale curves start, peak and end where they should', () => {
  assert.equal(curveScale(CURVE.SHRINK, 0), 1);
  assert.equal(curveScale(CURVE.SHRINK, 1), 0);
  assert.equal(curveScale(CURVE.CONST, 0.7), 1);
  assert.ok(curveScale(CURVE.POP, 0.05) < 1, 'pops in');
  assert.ok(curveScale(CURVE.POP, 0.17) > 1, 'with an overshoot');
  assert.equal(curveScale(CURVE.POP, 0.5), 1);
  assert.ok(curveScale(CURVE.POP, 0.999) < 0.01, 'and shrinks away');
  assert.ok(curveScale(CURVE.PUFF, 0) > 0 && curveScale(CURVE.PUFF, 1) === 0);
  assert.ok(curveScale(CURVE.GROW, 0.79) > curveScale(CURVE.GROW, 0.1));
  for (const curve of Object.values(CURVE)) {
    for (let u = 0; u <= 1; u += 0.05) assert.ok(Number.isFinite(curveScale(curve, u)));
  }
});

test('particles live for their life, then free their slot', () => {
  const f = field();
  const s = spawnSpec();
  s.life = 0.5;
  f.spawn(s);
  f.spawn(Object.assign(spawnSpec(), { life: 2 }));
  f.update(0.1, 0);
  assert.equal(f.mesh.count, 2);
  assert.equal(f.mesh.visible, true);
  f.update(0.5, 0);
  assert.equal(f.alive, 1, 'the short-lived one is gone');
  f.update(2, 0);
  assert.equal(f.alive, 0);
  assert.equal(f.mesh.visible, false, 'an empty field draws nothing');
});

test('a full pool drops new particles instead of growing', () => {
  const f = field(3);
  for (let i = 0; i < 10; i++) f.spawn(spawnSpec());
  assert.equal(f.alive, 3);
});

test('delayed particles stay hidden until their time', () => {
  const f = field();
  f.spawn(Object.assign(spawnSpec(), { delay: 0.3, life: 1 }));
  f.update(0.1, 0);
  assert.equal(f.mesh.count, 0, 'not drawn yet');
  f.update(0.3, 0);
  assert.equal(f.mesh.count, 1);
});

test('gravity pulls down and the floor bounces', () => {
  const f = field();
  f.spawn(Object.assign(spawnSpec(), { y: 1, vy: 0, gravity: -9, floor: 0, size: 0.2, life: 5 }));
  for (let i = 0; i < 120; i++) f.update(1 / 60, 0);
  assert.ok(f.a.py[0] >= 0.1 - 1e-6, 'never sinks below the floor');
  assert.ok(f.a.py[0] < 1, 'fell');
});

test('orbiting particles circle their centre', () => {
  const f = field();
  f.spawn(Object.assign(spawnSpec(), { x: 2, z: 3, orbit: 4, radius: 0.5, life: 5 }));
  for (let i = 0; i < 30; i++) {
    f.update(1 / 60, 0);
    const r = Math.hypot(f.a.px[0] - 2, f.a.pz[0] - 3);
    assert.ok(Math.abs(r - 0.5) < 1e-5);
  }
});

test('upright fields keep their geometry orientation; billboards face the camera', () => {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const upright = field(2, 'upright');
  upright.spawn(Object.assign(spawnSpec(), { spin: 10, life: 5 }));
  upright.update(0.1, 0);
  upright.mesh.getMatrixAt(0, m);
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  assert.ok(q.angleTo(new THREE.Quaternion()) < 1e-6);
  const board = field(2, 'billboard');
  board.spawn(Object.assign(spawnSpec(), { life: 5 }));
  board.update(0.1, 1.2);
  board.mesh.getMatrixAt(0, m);
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  e.setFromQuaternion(q);
  assert.ok(Math.abs(e.y - 1.2) < 1e-6, 'turned to the camera yaw');
});
