// A pose is a flat Float32Array of joint values, so activities can be computed and blended every
// frame without allocating. "L"/"R" are the figure's own left/right (its left is +x at yaw 0).
// Angles are radians with anatomical signs: positive pitch = forward, positive abduct = outward.

/** Channel indices into a pose array. */
export const P = Object.freeze({
  ROOT_Y: 0, // whole-body vertical offset (bob, hops, sitting)
  ROOT_PITCH: 1, // whole-body lean forward, pivoting at the feet
  ROOT_ROLL: 2, // whole-body sway toward the figure's left
  ROOT_YAW: 3, // extra spin on top of the heading (celebration twirls)
  SPINE_PITCH: 4,
  SPINE_YAW: 5,
  SPINE_ROLL: 6,
  HEAD_PITCH: 7, // positive nods down
  HEAD_YAW: 8, // positive looks to the figure's left
  HEAD_ROLL: 9,
  ARM_L_PITCH: 10,
  ARM_L_ABDUCT: 11, // negative brings the hand across the body
  ARM_L_TWIST: 12,
  ELBOW_L: 13, // positive bends the forearm forward/up
  ARM_R_PITCH: 14,
  ARM_R_ABDUCT: 15,
  ARM_R_TWIST: 16,
  ELBOW_R: 17,
  LEG_L_PITCH: 18,
  LEG_L_SPLAY: 19,
  KNEE_L: 20, // positive bends the shin backward
  LEG_R_PITCH: 21,
  LEG_R_SPLAY: 22,
  KNEE_R: 23,
  EYES: 24, // 1 open, 0 closed
  HAT_LIFT: 25, // hat hops off the head (celebrate)
  PROP_BOB: 26, // vertical nudge of two-handed props (adjusting the grip)
});

export const POSE_SIZE = 27;

/** @returns {Float32Array} a neutral pose */
export function createPose() {
  const pose = new Float32Array(POSE_SIZE);
  neutralPose(pose);
  return pose;
}

/**
 * Resets a pose to relaxed standing: arms hang slightly away from the body, eyes open.
 * @param {Float32Array} out
 */
export function neutralPose(out) {
  out.fill(0);
  out[P.ARM_L_ABDUCT] = 0.08;
  out[P.ARM_R_ABDUCT] = 0.08;
  out[P.ELBOW_L] = 0.12;
  out[P.ELBOW_R] = 0.12;
  out[P.EYES] = 1;
  return out;
}

/**
 * out = a + (b - a) * w for every channel. `out` may alias `a` or `b`.
 * @param {Float32Array} out @param {Float32Array} a @param {Float32Array} b @param {number} w
 */
export function blendPose(out, a, b, w) {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * w;
  return out;
}

/** Channels that move the arms and torso, used to layer an upper-body action over walking. */
export const UPPER_BODY = Object.freeze([
  P.SPINE_PITCH,
  P.ARM_L_PITCH,
  P.ARM_L_ABDUCT,
  P.ARM_L_TWIST,
  P.ELBOW_L,
  P.ARM_R_PITCH,
  P.ARM_R_ABDUCT,
  P.ARM_R_TWIST,
  P.ELBOW_R,
  P.PROP_BOB,
]);

/**
 * Copies the listed channels from `src` into `out`.
 * @param {Float32Array} out @param {Float32Array} src @param {readonly number[]} channels
 */
export function copyChannels(out, src, channels) {
  for (let i = 0; i < channels.length; i++) out[channels[i]] = src[channels[i]];
  return out;
}
