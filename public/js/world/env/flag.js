// A small waving town flag (teal with a golden token), animated in the vertex shader.
import * as THREE from 'three';

/**
 * Draws the flag design: teal field, white stripe, golden coin with a "T".
 * @returns {THREE.CanvasTexture}
 */
function flagTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 84;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  g.fillStyle = '#1f7f78';
  g.fillRect(0, 0, 128, 84);
  g.fillStyle = '#f6f1e6';
  g.fillRect(0, 34, 128, 16);
  g.fillStyle = '#e8b54a';
  g.beginPath();
  g.arc(44, 42, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1f7f78';
  g.font = '800 28px Overpass, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('T', 44, 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Flag cloth hanging from x = 0 (the pole side) towards +x.
 * @param {import('./town-material.js').TownUniforms} town
 * @param {number} [width]
 */
export function createFlag(town, width = 0.9) {
  const height = width * 0.62;
  const geometry = new THREE.PlaneGeometry(width, height, 10, 3);
  geometry.translate(width / 2, 0, 0);
  const material = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.9 });
  material.name = 'flag';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTtTime = town.uTtTime;
    shader.uniforms.uTtSway = town.uTtSway;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTtTime;\nuniform float uTtSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float k = position.x / ${width.toFixed(3)};
        transformed.z += sin( position.x * 5.0 - uTtTime * 5.0 ) * 0.09 * k * uTtSway;
        transformed.y -= k * k * 0.05;`,
      );
  };
  material.customProgramCacheKey = () => 'flag';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'flag';
  mesh.castShadow = true;
  return mesh;
}
