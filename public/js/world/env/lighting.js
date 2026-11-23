// Lights: one shadow-casting directional key light (the sun by day, the moon by night) plus a
// hemisphere fill. The shadow camera is refitted around the plinth whenever the light moves.
import * as THREE from 'three';
import { boxCorners, fitLightFrame } from './shadow-fit.js';

/** World box that must receive shadows (the plinth plus the tallest towers). */
const SHADOW_BOX = Object.freeze({ min: [-27, -0.5, -37], max: [27, 12, 39] });
const CORNERS = boxCorners(/** @type {any} */ (SHADOW_BOX));

/**
 * @param {THREE.Scene} scene
 */
export function createLighting(scene) {
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.name = 'key-light';
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 3.5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x887766, 1);
  hemi.name = 'fill-light';
  scene.add(key, key.target, hemi);
  const lastDir = new THREE.Vector3();

  /**
   * @param {import('./daynight.js').SkyState} state
   * @param {(rgb: number[], out: THREE.Color) => THREE.Color} toColor
   */
  function apply(state, toColor) {
    toColor(state.light, key.color);
    key.intensity = state.lightIntensity;
    toColor(state.hemiSky, hemi.color);
    toColor(state.hemiGround, hemi.groundColor);
    hemi.intensity = state.hemiIntensity;
    const [x, y, z] = state.lightDir;
    if (lastDir.x === x && lastDir.y === y && lastDir.z === z) return;
    lastDir.set(x, y, z);
    fitShadow(key, state.lightDir);
  }

  /** @param {boolean} on */
  function setShadows(on) {
    key.castShadow = on;
  }

  function dispose() {
    key.shadow.map?.dispose();
    key.dispose();
    hemi.dispose();
    scene.remove(key, key.target, hemi);
  }

  return { key, hemi, apply, setShadows, dispose };
}

/**
 * @param {THREE.DirectionalLight} light
 * @param {[number, number, number]} toLight
 */
function fitShadow(light, toLight) {
  const frame = fitLightFrame(toLight, CORNERS, 90, 1.5);
  light.position.set(...frame.position);
  light.target.position.set(...frame.center);
  light.target.updateMatrixWorld();
  const cam = light.shadow.camera;
  cam.left = frame.left;
  cam.right = frame.right;
  cam.top = frame.top;
  cam.bottom = frame.bottom;
  cam.near = frame.near;
  cam.far = frame.far;
  cam.updateProjectionMatrix();
}
