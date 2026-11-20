// Traffic and people: cars wait for anyone in their lane (the facade hands in the crowd's query).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicles } from '../../../../public/js/world/env/vehicles.js';

/** The town's traffic with a stand-in post office (its garage is all the mail truck needs). */
function traffic() {
  const scene = new THREE.Scene();
  const post = { anchors: { garage: new THREE.Vector3(3, 0, -8) }, root: new THREE.Group() };
  const records = /** @type {any} */ ({ post });
  const vehicles = createVehicles({ scene, material: new THREE.MeshBasicMaterial(), records, reducedMotion: false });
  const cars = /** @type {THREE.Object3D[]} */ (scene.getObjectByName('vehicles')?.children.filter((c) => c.name === 'car'));
  const where = () => cars.map((car) => car.position.clone());
  /** @param {number} seconds */
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += 0.05) vehicles.update(0.05, t);
  };
  return { vehicles, cars, where, run };
}

test('cars drive on when the road is clear, and wait while someone is in their lane ahead', () => {
  const { vehicles, cars, where, run } = traffic();
  assert.equal(cars.length, 3);
  run(1);
  const before = where();
  run(2);
  assert.ok(where().every((p, i) => p.distanceTo(before[i]) > 1), 'all three cars move');

  // Someone stands right in front of the first car.
  const ahead = cars[0].position.clone().add(new THREE.Vector3(Math.cos(cars[0].rotation.y), 0, -Math.sin(cars[0].rotation.y)).multiplyScalar(1.2));
  vehicles.setPedestrians((x, z, reach) => Math.hypot(x - ahead.x, z - ahead.z) < reach);
  run(1.5);
  const waiting = where();
  run(3);
  assert.ok(where()[0].distanceTo(waiting[0]) < 0.01, 'the first car waits');
  assert.ok(where()[2].distanceTo(waiting[2]) > 1, 'the car in the other lane drives on');

  vehicles.setPedestrians(() => false);
  run(2);
  assert.ok(where()[0].distanceTo(waiting[0]) > 1, 'and drives on once the lane is clear');
  vehicles.dispose();
});
