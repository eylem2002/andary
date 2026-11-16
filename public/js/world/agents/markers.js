// Ground markers under agents: soft blob shadows (one instanced draw call for everyone; they
// ground the figures even when real shadows are off) and the selection ring.

import * as THREE from 'three';

const SHADOW_CAPACITY = 160;

/** Radial alpha gradient, generated in code (no image request, no canvas). */
function blobTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = Math.max(0, 1 - r);
      data[(y * size + x) * 4 + 3] = Math.round(255 * Math.pow(a, 1.4));
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** @param {THREE.Scene} scene */
export function createMarkers(scene) {
  const texture = blobTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: '#1a1408',
    map: texture,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(shadowGeometry, shadowMaterial, SHADOW_CAPACITY);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;
  shadows.count = 0;
  shadows.name = 'agent-shadows';
  scene.add(shadows);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false });
  const fillMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false });
  const ring = new THREE.Group();
  ring.add(new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40).rotateX(-Math.PI / 2), ringMaterial));
  ring.add(new THREE.Mesh(new THREE.CircleGeometry(0.4, 40).rotateX(-Math.PI / 2), fillMaterial));
  ring.renderOrder = 2;
  ring.visible = false;
  ring.name = 'agent-selection';
  scene.add(ring);
  let shadowCount = 0;
  let ringColor = '';

  return {
    beginShadows() {
      shadowCount = 0;
    },
    /** @param {number} x @param {number} z @param {number} size @param {number} ground */
    addShadow(x, z, size, ground) {
      if (shadowCount >= SHADOW_CAPACITY || size <= 0.01) return;
      _m.compose(_p.set(x, ground + 0.015, z), _q, _s.set(size, 1, size * 0.85));
      shadows.setMatrixAt(shadowCount++, _m);
    },
    endShadows() {
      shadows.count = shadowCount;
      shadows.visible = shadowCount > 0;
      shadows.instanceMatrix.needsUpdate = true;
    },
    /**
     * @param {{x: number, z: number}|null} at  null hides the ring
     * @param {string} [color]
     * @param {number} [scale]
     * @param {number} [time] seconds, for the gentle pulse
     */
    setRing(at, color = '#ffffff', scale = 1, time = 0) {
      ring.visible = Boolean(at);
      if (!at) return;
      const pulse = 1 + 0.06 * Math.sin(time * 4);
      ring.position.set(at.x, 0.02, at.z);
      ring.scale.setScalar(scale * pulse);
      ring.rotation.y = time * 0.6;
      if (color !== ringColor) {
        ringColor = color; // parse only on change: Color.set(string) allocates
        fillMaterial.color.set(color);
      }
    },
    dispose() {
      shadows.removeFromParent();
      shadows.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      texture.dispose();
      ring.removeFromParent();
      for (const child of ring.children) /** @type {THREE.Mesh} */ (child).geometry.dispose();
      ringMaterial.dispose();
      fillMaterial.dispose();
    },
  };
}
