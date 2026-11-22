// Orthographic isometric camera: fixed pitch, 90° yaw steps, damped drag-pan with inertia,
// wheel/pinch zoom towards the pointer, smooth focus and follow. Zoom is relative to the framing
// that fits the whole town (1 = whole town), so callers never need to know the viewport size.
import * as THREE from 'three';
import {
  ISO_PITCH,
  MAX_ZOOM,
  MIN_ZOOM,
  cameraDirection,
  clamp,
  clampTarget,
  damp,
  easeInOutCubic,
  fitHalfHeight,
  groundTargetFor,
  screenPanToWorld,
  yawForStep,
} from './camera-math.js';

/** Camera distance from its target; fog distances are relative to it. */
export const CAMERA_DISTANCE = 120;
const HOME = Object.freeze({ x: 0, z: 1.5 });
const BOUNDS = Object.freeze({ minX: -30, maxX: 30, minZ: -38, maxZ: 42 });
const DRAG_THRESHOLD = 6;
const ROTATE_SECONDS = 0.7;

/**
 * @param {{container: HTMLElement, reducedMotion?: boolean}} options
 */
export function createCameraRig({ container, reducedMotion = false }) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 420);
  camera.name = 'iso-camera';
  const s = {
    width: 1,
    height: 1,
    halfHeight: 30,
    target: new THREE.Vector3(HOME.x, 0, HOME.z),
    goal: new THREE.Vector3(HOME.x, 0, HOME.z),
    zoom: 1,
    zoomGoal: 1,
    yawStep: 0,
    yaw: yawForStep(0),
    yawFrom: yawForStep(0),
    yawT: 1,
    /** @type {null | (() => ({x: number, y: number, z: number} | null))} */
    follow: null,
    velocity: new THREE.Vector2(),
    reduced: reducedMotion,
    dirty: true,
  };
  const input = attachInput(container, camera, s);
  applyCamera(camera, s);

  function snap() {
    s.target.copy(s.goal);
    s.zoom = s.zoomGoal;
    s.yaw = yawForStep(s.yawStep);
    s.yawT = 1;
    s.dirty = true;
  }

  return {
    camera,
    get zoom() {
      return s.zoom;
    },
    get yaw() {
      return s.yaw;
    },
    /** @param {number} dt */
    update(dt) {
      stepRig(s, dt, input.dragging());
      if (s.dirty) applyCamera(camera, s);
      const changed = s.dirty;
      s.dirty = false;
      return changed;
    },
    /** @param {number} width @param {number} height */
    resize(width, height) {
      s.width = Math.max(1, width);
      s.height = Math.max(1, height);
      s.halfHeight = fitHalfHeight(s.width, s.height);
      s.dirty = true;
      applyCamera(camera, s);
    },
    /**
     * @param {{x: number, y: number, z: number}} point
     * @param {{zoom?: number, follow?: () => ({x: number, y: number, z: number} | null)}} [opts]
     */
    focus(point, opts = {}) {
      if (point) setGoalFromPoint(s, point);
      if (Number.isFinite(opts.zoom)) s.zoomGoal = clamp(opts.zoom, MIN_ZOOM, MAX_ZOOM);
      s.follow = typeof opts.follow === 'function' ? opts.follow : null;
      s.velocity.set(0, 0);
      if (s.reduced) snap();
    },
    stopFollow() {
      s.follow = null;
    },
    reset() {
      s.follow = null;
      s.goal.set(HOME.x, 0, HOME.z);
      s.zoomGoal = 1;
      s.velocity.set(0, 0);
      startRotation(s, Math.round(s.yawStep / 4) * 4);
      if (s.reduced) snap();
    },
    /** @param {number} dir */
    rotate(dir) {
      startRotation(s, s.yawStep + (dir < 0 ? -1 : 1));
      if (s.reduced) snap();
    },
    /** @param {number} factor */
    zoomBy(factor) {
      if (!(factor > 0)) return;
      s.zoomGoal = clamp(s.zoomGoal * factor, MIN_ZOOM, MAX_ZOOM);
      if (s.reduced) snap();
    },
    /**
     * Pans in screen terms (dx = right, dz = towards the viewer), in world units at zoom 1.
     * @param {number} dx @param {number} dz
     */
    panBy(dx, dz) {
      const w = screenPanToWorld(dx / s.zoomGoal, dz / s.zoomGoal, yawForStep(s.yawStep));
      s.follow = null;
      s.goal.x += w.x;
      s.goal.z += w.z;
      clampTarget(s.goal, BOUNDS);
      if (s.reduced) snap();
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      s.reduced = !!on;
      if (s.reduced) {
        s.velocity.set(0, 0);
        snap();
      }
    },
    dispose() {
      input.dispose();
    },
  };
}

/**
 * @param {any} s rig state
 * @param {{x: number, y: number, z: number}} point
 */
function setGoalFromPoint(s, point) {
  const t = groundTargetFor(point, cameraDirection(yawForStep(s.yawStep), ISO_PITCH));
  s.goal.set(t.x, 0, t.z);
  clampTarget(s.goal, BOUNDS);
}

/** @param {any} s @param {number} step */
function startRotation(s, step) {
  if (step === s.yawStep && s.yawT >= 1) return;
  s.yawFrom = s.yaw;
  s.yawStep = step;
  s.yawT = 0;
}

/**
 * Advances follow, inertia, damping and rotation.
 * @param {any} s @param {number} dt @param {boolean} dragging
 */
function stepRig(s, dt, dragging) {
  if (s.follow) {
    const p = s.follow();
    if (p) setGoalFromPoint(s, p);
    else s.follow = null;
  }
  if (!dragging && s.velocity.lengthSq() > 1e-4) {
    s.goal.x += s.velocity.x * dt;
    s.goal.z += s.velocity.y * dt;
    s.velocity.multiplyScalar(Math.exp(-dt * 4.5));
    clampTarget(s.goal, BOUNDS);
  }
  const lambda = dragging ? 30 : s.follow ? 6 : 10;
  const before = s.target.x + s.target.z * 7 + s.zoom * 13 + s.yaw * 17;
  s.target.x = damp(s.target.x, s.goal.x, lambda, dt);
  s.target.z = damp(s.target.z, s.goal.z, lambda, dt);
  s.zoom = Math.exp(damp(Math.log(s.zoom), Math.log(s.zoomGoal), 9, dt));
  if (s.yawT < 1) {
    s.yawT = Math.min(1, s.yawT + dt / ROTATE_SECONDS);
    const to = yawForStep(s.yawStep);
    s.yaw = s.yawFrom + (to - s.yawFrom) * easeInOutCubic(s.yawT);
  }
  const after = s.target.x + s.target.z * 7 + s.zoom * 13 + s.yaw * 17;
  if (Math.abs(after - before) > 1e-6) s.dirty = true;
}

/**
 * @param {THREE.OrthographicCamera} camera
 * @param {any} s
 */
function applyCamera(camera, s) {
  const aspect = s.width / s.height;
  camera.top = s.halfHeight;
  camera.bottom = -s.halfHeight;
  camera.left = -s.halfHeight * aspect;
  camera.right = s.halfHeight * aspect;
  camera.zoom = s.zoom;
  const [dx, dy, dz] = cameraDirection(s.yaw, ISO_PITCH);
  camera.position.set(s.target.x + dx * CAMERA_DISTANCE, dy * CAMERA_DISTANCE, s.target.z + dz * CAMERA_DISTANCE);
  camera.lookAt(s.target.x, 0, s.target.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/**
 * Pointer, touch and wheel handling on the world container.
 * @param {HTMLElement} el
 * @param {THREE.OrthographicCamera} camera
 * @param {any} s
 */
function attachInput(el, camera, s) {
  /** @type {Map<number, {x: number, y: number}>} */
  const pointers = new Map();
  const drag = { active: false, moved: 0, lastT: 0, pinch: 0, suppressClick: false };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const sampleVelocity = new THREE.Vector2();
  el.style.touchAction = 'none';

  /** World units per screen pixel at the current zoom. */
  const unitsPerPixel = () => (2 * s.halfHeight) / s.zoom / s.height;

  /** @param {number} dx @param {number} dy screen px */
  function panPixels(dx, dy) {
    const k = unitsPerPixel();
    const w = screenPanToWorld(-dx * k, -dy * k / Math.sin(ISO_PITCH), s.yaw);
    s.goal.x += w.x;
    s.goal.z += w.z;
    clampTarget(s.goal, BOUNDS);
    return w;
  }

  /** @param {number} clientX @param {number} clientY */
  function groundAt(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(ground, hit);
  }

  /** Zooms keeping the ground point under the pointer fixed. */
  function zoomAt(factor, clientX, clientY) {
    const p = groundAt(clientX, clientY);
    const before = s.zoomGoal;
    s.zoomGoal = clamp(s.zoomGoal * factor, MIN_ZOOM, MAX_ZOOM);
    if (!p || s.zoomGoal === before) return;
    const k = before / s.zoomGoal;
    s.goal.x = p.x - (p.x - s.goal.x) * k;
    s.goal.z = p.z - (p.z - s.goal.z) * k;
    clampTarget(s.goal, BOUNDS);
    s.follow = null;
  }

  const onDown = (/** @type {PointerEvent} */ e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.active = true;
    drag.moved = 0;
    drag.lastT = performance.now();
    s.velocity.set(0, 0);
    if (pointers.size === 2) drag.pinch = pinchDistance(pointers);
  };

  const onMove = (/** @type {PointerEvent} */ e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev || !drag.active) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (pointers.size >= 2) {
      handlePinch(e);
      return;
    }
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved < DRAG_THRESHOLD) return;
    if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    s.follow = null;
    const w = panPixels(dx, dy);
    const now = performance.now();
    const dt = Math.max(8, now - drag.lastT) / 1000;
    drag.lastT = now;
    s.velocity.lerp(sampleVelocity.set(w.x / dt, w.z / dt), 0.5);
  };

  /** @param {PointerEvent} e */
  function handlePinch(e) {
    const dist = pinchDistance(pointers);
    if (drag.pinch > 0 && dist > 0) {
      const mid = pinchMidpoint(pointers);
      zoomAt(dist / drag.pinch, mid.x, mid.y);
    }
    drag.pinch = dist;
    drag.moved += DRAG_THRESHOLD;
    if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
  }

  const onUp = (/** @type {PointerEvent} */ e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (drag.moved >= DRAG_THRESHOLD) drag.suppressClick = true;
    if (performance.now() - drag.lastT > 90 || s.reduced) s.velocity.set(0, 0);
    if (pointers.size === 0) drag.active = false;
    drag.pinch = pointers.size === 2 ? pinchDistance(pointers) : 0;
  };

  const onWheel = (/** @type {WheelEvent} */ e) => {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    zoomAt(Math.exp(-e.deltaY * scale * 0.0016), e.clientX, e.clientY);
  };

  // A drag must never also count as a click on a building, agent or sign.
  const onClickCapture = (/** @type {MouseEvent} */ e) => {
    if (!drag.suppressClick) return;
    drag.suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('click', onClickCapture, { capture: true });

  return {
    dragging: () => drag.active && drag.moved >= DRAG_THRESHOLD,
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('click', onClickCapture, { capture: true });
    },
  };
}

/** @param {Map<number, {x: number, y: number}>} pointers */
function pinchDistance(pointers) {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

/** @param {Map<number, {x: number, y: number}>} pointers */
function pinchMidpoint(pointers) {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
