// The toy figure's skeleton. Every figure is ONE rigidly skinned mesh (each vertex follows exactly
// one bone), so a whole agent — body, hat, accessories and every prop it might hold — costs a
// single draw call. Props that are not in use sit on bones scaled to zero.

import * as THREE from 'three';
import { P } from './pose.js';
import { PROP_NAMES } from './activities.js';

/** Bone indices. Positions are figure units (about 1 unit from boots to crown). */
export const B = Object.freeze({
  BODY: 0,
  PELVIS: 1,
  SPINE: 2,
  HEAD: 3,
  EYES: 4,
  HAT: 5,
  ARM_L: 6,
  ELBOW_L: 7,
  HAND_L: 8,
  ARM_R: 9,
  ELBOW_R: 10,
  HAND_R: 11,
  LEG_L: 12,
  KNEE_L: 13,
  LEG_R: 14,
  KNEE_R: 15,
  FRONT: 16, // in front of the chest: two-handed props (book, laptop, box)
});

/** Key heights in figure units, shared with the part builders. */
export const JOINTS = Object.freeze({
  hipY: 0.3,
  waistY: 0.36,
  neckY: 0.65,
  shoulderX: 0.205,
  shoulderY: 0.6,
  upperArm: 0.13,
  forearm: 0.125,
  legX: 0.075,
  thigh: 0.15,
  headY: 0.8, // head centre
  headR: 0.165,
  hatY: 0.92,
  frontY: 0.48,
  frontZ: 0.2,
});

const J = JOINTS;

/** [parent, x, y, z] in the parent's space, for each body bone. */
const BODY_BONES = [
  [-1, 0, 0, 0], // body (root, pivots at the feet)
  [0, 0, J.hipY, 0], // pelvis
  [1, 0, J.waistY - J.hipY, 0], // spine
  [2, 0, J.neckY - J.waistY, 0], // head (pivots at the neck)
  [3, 0, J.headY - J.neckY, 0.158], // eyes (scale y to blink)
  [3, 0, J.hatY - J.neckY, 0], // hat
  [2, J.shoulderX, J.shoulderY - J.waistY, 0], // left shoulder
  [6, 0, -J.upperArm, 0], // left elbow
  [7, 0, -J.forearm, 0], // left hand
  [2, -J.shoulderX, J.shoulderY - J.waistY, 0], // right shoulder
  [9, 0, -J.upperArm, 0],
  [10, 0, -J.forearm, 0],
  [1, J.legX, 0, 0], // left hip
  [12, 0, -J.thigh, 0], // left knee
  [1, -J.legX, 0, 0],
  [14, 0, -J.thigh, 0],
  [2, 0, J.frontY - J.waistY, J.frontZ], // front
];

/** Which bone holds each prop (props sit at their holder's origin and scale with their own bone). */
const PROP_HOLDERS = Object.freeze({
  book: B.FRONT,
  laptop: B.FRONT,
  box: B.FRONT,
  mailbag: B.SPINE,
  hammer: B.HAND_R,
  magnifier: B.HAND_R,
  mug: B.HAND_R,
  pencil: B.HAND_R,
  clipboard: B.HAND_L,
  blueprint: B.HAND_L,
  toolbox: B.HAND_L,
  towel: B.HEAD,
});

/** Bone index per prop name; the hat prop is the hat bone itself. */
export const PROP_BONE = Object.freeze(
  Object.fromEntries(
    PROP_NAMES.map((name) => [name, name === 'hat' ? B.HAT : BODY_BONES.length + PROP_NAMES.filter((n) => n !== 'hat').indexOf(name)]),
  ),
);

/** [parent, x, y, z] for every bone, props appended after the body. */
const ALL_BONES = [
  ...BODY_BONES,
  ...PROP_NAMES.filter((n) => n !== 'hat').map((name) => [PROP_HOLDERS[name], 0, 0, 0]),
];

/** Rest-pose matrix of each bone in figure space, computed once. */
const REST_MATRICES = (() => {
  const bones = buildBones();
  bones[0].updateMatrixWorld(true);
  return bones.map((b) => b.matrixWorld.clone());
})();

/** Bind inverses are identical for every figure, so all skeletons share these matrices. */
const BONE_INVERSES = REST_MATRICES.map((m) => m.clone().invert());

function buildBones() {
  /** @type {THREE.Bone[]} */
  const bones = [];
  for (const [parent, x, y, z] of ALL_BONES) {
    const bone = new THREE.Bone();
    bone.position.set(x, y, z);
    if (parent >= 0) bones[parent].add(bone);
    bones.push(bone);
  }
  return bones;
}

/**
 * A fresh skeleton for one figure (bones are per agent; bind inverses are shared).
 * @returns {{bones: THREE.Bone[], skeleton: THREE.Skeleton}}
 */
export function createSkeleton() {
  const bones = buildBones();
  return { bones, skeleton: new THREE.Skeleton(bones, BONE_INVERSES) };
}

/**
 * Writes a pose and prop scales onto a figure's bones. Signs convert the pose's anatomical
 * convention (positive = forward/outward) into three.js rotations for a figure facing +z.
 * @param {THREE.Bone[]} bones
 * @param {Float32Array} pose
 * @param {Float32Array} propScale  per PROP_NAMES entry
 */
export function applyPose(bones, pose, propScale) {
  const body = bones[B.BODY];
  body.position.y = pose[P.ROOT_Y];
  body.rotation.set(pose[P.ROOT_PITCH], pose[P.ROOT_YAW], -pose[P.ROOT_ROLL]);
  bones[B.SPINE].rotation.set(pose[P.SPINE_PITCH], pose[P.SPINE_YAW], -pose[P.SPINE_ROLL]);
  bones[B.HEAD].rotation.set(pose[P.HEAD_PITCH], pose[P.HEAD_YAW], -pose[P.HEAD_ROLL]);
  bones[B.ARM_L].rotation.set(-pose[P.ARM_L_PITCH], pose[P.ARM_L_TWIST], pose[P.ARM_L_ABDUCT]);
  bones[B.ARM_R].rotation.set(-pose[P.ARM_R_PITCH], -pose[P.ARM_R_TWIST], -pose[P.ARM_R_ABDUCT]);
  bones[B.ELBOW_L].rotation.x = -pose[P.ELBOW_L];
  bones[B.ELBOW_R].rotation.x = -pose[P.ELBOW_R];
  bones[B.LEG_L].rotation.set(-pose[P.LEG_L_PITCH], 0, pose[P.LEG_L_SPLAY]);
  bones[B.LEG_R].rotation.set(-pose[P.LEG_R_PITCH], 0, -pose[P.LEG_R_SPLAY]);
  bones[B.KNEE_L].rotation.x = pose[P.KNEE_L];
  bones[B.KNEE_R].rotation.x = pose[P.KNEE_R];
  bones[B.EYES].scale.y = Math.max(0.08, pose[P.EYES]);
  const hat = bones[B.HAT];
  hat.position.y = J.hatY - J.neckY + pose[P.HAT_LIFT];
  hat.rotation.z = pose[P.HAT_LIFT] * 2.5;
  bones[B.FRONT].position.y = J.frontY - J.waistY + pose[P.PROP_BOB];
  for (let i = 0; i < PROP_NAMES.length; i++) {
    // A tiny non-zero scale keeps matrices invertible for anything that might ask.
    bones[PROP_BONE[PROP_NAMES[i]]].scale.setScalar(Math.max(1e-4, propScale[i]));
  }
}
