import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherSky } from '../../../../public/js/world/env/weather-sky.js';
import { skyState } from '../../../../public/js/world/env/daynight.js';

test('weatherSky greys and dims the sky and pulls the fog in', () => {
  const day = skyState(13);
  assert.equal(weatherSky(day, { overcast: 0, fog: 0 }).fogScale, 1);
  assert.deepEqual(weatherSky(day, { overcast: 0, fog: 0 }).zenith, day.zenith);
  const grey = weatherSky(day, { overcast: 1, fog: 0 });
  assert.ok(grey.lightIntensity < day.lightIntensity * 0.5);
  const spread = (rgb) => Math.max(...rgb) - Math.min(...rgb);
  assert.ok(spread(grey.zenith) < spread(day.zenith), 'less colourful');
  const foggy = weatherSky(day, { overcast: 0, fog: 1 });
  assert.ok(foggy.fogScale < 0.3);
  assert.equal(weatherSky(skyState(23), { overcast: 1, fog: 0 }).stars, 0, 'no stars behind clouds');
});

test('landmarks: earned ones are built once, ones no longer earned go, and the wheel stays on dry sand', async () => {
  const THREE = await import('three');
  const { createLandmarks } = await import('../../../../public/js/world/env/landmarks.js');
  const { BEACH, WATERLINE_Z } = await import('../../../../public/js/world/env/beach.js');
  const scene = new THREE.Scene();
  const landmarks = createLandmarks({ scene, material: new THREE.MeshBasicMaterial(), records: {} });
  landmarks.set(['bunting', 'wheel', 'balloon']);
  assert.deepEqual(landmarks.built.sort(), ['balloon', 'bunting', 'wheel']);
  landmarks.update(0.5);
  // The demo after a busier live town: only what it has earned stays.
  landmarks.set(['bunting']);
  assert.deepEqual(landmarks.built, ['bunting']);
  assert.equal(scene.getObjectByName('landmark-wheel'), undefined);
  landmarks.update(0.5);
  landmarks.set(['bunting', 'wheel']);
  const wheel = /** @type {import('three').Object3D} */ (scene.getObjectByName('landmark-wheel'));
  wheel.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(/** @type {import('three').Object3D} */ (wheel.getObjectByName('wheel-frame')), true);
  assert.ok(box.min.z > WATERLINE_Z, `the wheel's plinth (${box.min.z.toFixed(2)}) stays out of the sea (${WATERLINE_Z.toFixed(2)})`);
  assert.ok(box.max.z < BEACH.top.z, `and clear of the seawall (${box.max.z.toFixed(2)})`);
  landmarks.dispose();
  assert.equal(scene.children.length, 0);
});
