// Geometry for effect particles: little 3D toy icons (check, cross, heart, Z, bulb, magnifier)
// rather than flat emoji, so they sit in the diorama with the same lighting as everything else.

import * as THREE from 'three';
import { ball, cyl, mergeColored, rbox, ring } from './figure-parts.js';

/** @param {number[][]} points closed polygon */
function polygon(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return shape;
}

/** Extrudes a shape into a chunky toy icon about 1 unit across, centred on the origin. @param {THREE.Shape} shape @param {number} depth */
function chunky(shape, depth) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.center();
  return geo;
}

function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.08, -0.38, 0.5, -0.12, 0.5, 0.14);
  s.bezierCurveTo(0.5, 0.42, 0.18, 0.52, 0, 0.3);
  s.bezierCurveTo(-0.18, 0.52, -0.5, 0.42, -0.5, 0.14);
  s.bezierCurveTo(-0.5, -0.12, -0.08, -0.38, 0, -0.5);
  return s;
}

/** Builds every icon geometry once. */
export function createEffectShapes() {
  return {
    spark: new THREE.OctahedronGeometry(1, 0),
    puff: new THREE.IcosahedronGeometry(1, 1),
    flake: new THREE.PlaneGeometry(1, 0.6),
    book: rbox(1, 0.32, 0.76, 0.08),
    crate: rbox(1, 1, 1, 0.1),
    drop: new THREE.BoxGeometry(0.028, 0.18, 0.028),
    ring: new THREE.TorusGeometry(1, 0.035, 4, 40).rotateX(Math.PI / 2),
    heart: chunky(heartShape(), 0.24),
    zee: chunky(
      polygon([
        [-0.4, 0.5],
        [0.4, 0.5],
        [0.4, 0.3],
        [-0.1, -0.3],
        [0.4, -0.3],
        [0.4, -0.5],
        [-0.4, -0.5],
        [-0.4, -0.3],
        [0.1, 0.3],
        [-0.4, 0.3],
      ]),
      0.14,
    ),
    check: chunky(
      polygon([
        [-0.52, 0.02],
        [-0.34, 0.2],
        [-0.14, 0.0],
        [0.34, 0.48],
        [0.52, 0.3],
        [-0.14, -0.36],
      ]),
      0.2,
    ),
    cross: chunky(
      polygon([
        [0, 0.14],
        [0.36, 0.5],
        [0.5, 0.36],
        [0.14, 0],
        [0.5, -0.36],
        [0.36, -0.5],
        [0, -0.14],
        [-0.36, -0.5],
        [-0.5, -0.36],
        [-0.14, 0],
        [-0.5, 0.36],
        [-0.36, 0.5],
      ]),
      0.2,
    ),
    bulb: mergeColored([
      [ball(0.32, 14, 10).translate(0, 0.12, 0), '#FFE066'],
      [cyl(0.15, 0.17, 0.12, 10).translate(0, -0.18, 0), '#FFF3B0'],
      [cyl(0.14, 0.11, 0.16, 10).translate(0, -0.3, 0), '#9AA3AD'],
      [ring(0.145, 0.025, Math.PI * 2, 12).rotateX(Math.PI / 2).translate(0, -0.27, 0), '#7D8691'],
    ]),
    lens: mergeColored([
      [ring(0.3, 0.06, Math.PI * 2, 24), '#C9A227'],
      [cyl(0.28, 0.28, 0.03, 20).rotateX(Math.PI / 2), '#BFE6FF'],
      [cyl(0.06, 0.07, 0.45, 8).rotateZ(Math.PI / 4).translate(0.36, -0.36, 0), '#6B4226'],
    ]),
  };
}

/**
 * The portal's light beam: an open cylinder whose vertex alpha fades out toward the top.
 * @returns {THREE.BufferGeometry}
 */
export function createBeamGeometry() {
  const geo = new THREE.CylinderGeometry(0.42, 0.5, 3.2, 24, 4, true).translate(0, 1.6, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getY(i) / 3.2;
    colors.set([0.45, 0.78, 1, Math.pow(1 - u, 1.4) * 0.6], i * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geo;
}
