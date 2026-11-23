// Pointer and keyboard input for the world container: click-vs-drag detection, throttled hover,
// keyboard camera controls, and the ray-vs-figure math used for picking agents. The math and key
// mapping are pure and unit-tested; `attachPointer`/`attachKeyboard` wire them to the DOM.

/** @typedef {{x: number, y: number, z: number}} Vec3 */

/** Pointer travel (px) above which a press counts as a drag (camera pan), not a click. */
const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 700;
const HOVER_INTERVAL_MS = 90;

/**
 * Closest approach between a ray (origin o, unit direction d) and a segment a→b.
 * @param {Vec3} o @param {Vec3} d @param {Vec3} a @param {Vec3} b
 * @returns {{distance: number, along: number}} along = distance along the ray to the closest point
 */
export function raySegmentDistance(o, d, a, b) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const wx = o.x - a.x;
  const wy = o.y - a.y;
  const wz = o.z - a.z;
  const B = d.x * ux + d.y * uy + d.z * uz;
  const C = ux * ux + uy * uy + uz * uz;
  const D = d.x * wx + d.y * wy + d.z * wz;
  const E = ux * wx + uy * wy + uz * wz;
  const denom = C - B * B;
  let t = denom > 1e-9 ? (E - B * D) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const s = Math.max(0, t * B - D);
  const px = o.x + d.x * s - (a.x + ux * t);
  const py = o.y + d.y * s - (a.y + uy * t);
  const pz = o.z + d.z * s - (a.z + uz * t);
  return { distance: Math.hypot(px, py, pz), along: s };
}

/**
 * @typedef {{type: 'pan', right: number, up: number} | {type: 'zoom', factor: number}
 *   | {type: 'rotate', dir: 1|-1} | {type: 'deselect'} | {type: 'reset'}
 *   | {type: 'step', right: number, up: number}} KeyAction
 *   step: walk mode, one tile in a screen direction (right, up: -1, 0 or 1)
 */

/** Walk mode's keys: arrows and WASD, by screen direction. */
const WALK_KEYS = Object.freeze({
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
  a: [-1, 0], d: [1, 0], w: [0, 1], s: [0, -1], A: [-1, 0], D: [1, 0], W: [0, 1], S: [0, -1],
});

/**
 * Maps a keydown to a camera action. Arrows pan (Shift pans further), +/- zoom, Q/E rotate,
 * Escape deselects, Home resets the camera. In walk mode arrows and WASD take a step instead,
 * and Shift+arrows pan.
 * @param {{key: string, shiftKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}} event
 * @param {{ walking?: boolean }} [mode]
 * @returns {KeyAction|null}
 */
export function keyAction(event, { walking = false } = {}) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null; // leave browser shortcuts alone
  const walk = /** @type {Record<string, number[]>} */ (WALK_KEYS)[event.key];
  if (walking && walk && !event.shiftKey) return { type: 'step', right: walk[0], up: walk[1] };
  const pan = /** @type {Record<string, number[]>} */ (PAN_KEYS)[event.key];
  if (pan) {
    const step = event.shiftKey && !walking ? 3 : 1;
    return { type: 'pan', right: pan[0] * step, up: pan[1] * step };
  }
  return /** @type {Record<string, KeyAction>} */ (CAMERA_KEYS)[event.key] ?? null;
}

const PAN_KEYS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] });

/** @type {Readonly<Record<string, KeyAction>>} */
const CAMERA_KEYS = Object.freeze({
  '+': { type: 'zoom', factor: 1.25 },
  '=': { type: 'zoom', factor: 1.25 },
  '-': { type: 'zoom', factor: 0.8 },
  _: { type: 'zoom', factor: 0.8 },
  q: { type: 'rotate', dir: -1 },
  Q: { type: 'rotate', dir: -1 },
  e: { type: 'rotate', dir: 1 },
  E: { type: 'rotate', dir: 1 },
  Escape: { type: 'deselect' },
  Home: { type: 'reset' },
});

/**
 * The tile step for a screen direction under the current camera: the screen vector turned onto
 * the ground, snapped to the nearest of the grid's four directions. The isometric view puts the
 * grid at 45° to the screen, so ties are broken a hair clockwise, the same way every time: each
 * of the four keys still takes its own direction.
 * @param {number} right @param {number} up  -1, 0 or 1
 * @param {number} faceYaw  the yaw that faces the camera (World view.faceYaw)
 * @returns {[number, number]} [dc, dr]
 */
export function stepToTile(right, up, faceYaw) {
  const fx = -Math.sin(faceYaw);
  const fz = -Math.cos(faceYaw);
  const x = right * -fz + up * fx;
  const z = right * fx + up * fz;
  const quarter = Math.round((Math.atan2(z, x) + 1e-3) / (Math.PI / 2));
  const angle = quarter * (Math.PI / 2);
  return [Math.round(Math.cos(angle)) || 0, Math.round(Math.sin(angle)) || 0];
}

/**
 * True when a press/release pair is a click rather than a drag.
 * @param {{x: number, y: number, t: number}} down
 * @param {{x: number, y: number, t: number}} up
 */
export function isClick(down, up) {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP_PX && up.t - down.t <= CLICK_MAX_MS;
}

/**
 * Listens for clicks and hovers on an element. `pick(x, y)` receives element-relative CSS px.
 * @param {HTMLElement} element
 * @param {{onClick: (x: number, y: number) => void, onHover: (x: number, y: number) => void, onLeave: () => void}} handlers
 * @returns {() => void} detach
 */
export function attachPointer(element, handlers) {
  /** @type {{x: number, y: number, t: number, id: number}|null} */
  let down = null;
  let lastHover = 0;
  /** @param {PointerEvent} e */
  const local = (e) => {
    const rect = element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
  };
  /** @param {PointerEvent} e */
  const onDown = (e) => {
    if (e.button !== 0) return;
    down = { ...local(e), id: e.pointerId };
  };
  /** @param {PointerEvent} e */
  const onUp = (e) => {
    if (!down || e.pointerId !== down.id) return;
    const up = local(e);
    if (isClick(down, up)) handlers.onClick(up.x, up.y);
    down = null;
  };
  /** @param {PointerEvent} e */
  const onMove = (e) => {
    if (e.pointerType === 'touch' || down || e.timeStamp - lastHover < HOVER_INTERVAL_MS) return;
    lastHover = e.timeStamp;
    const p = local(e);
    handlers.onHover(p.x, p.y);
  };
  const onCancel = () => {
    down = null;
  };
  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointercancel', onCancel);
  element.addEventListener('pointerleave', handlers.onLeave);
  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointercancel', onCancel);
    element.removeEventListener('pointerleave', handlers.onLeave);
  };
}

/**
 * Keyboard camera controls on the focusable world container.
 * @param {HTMLElement} element
 * @param {(action: KeyAction) => void} onAction
 * @param {() => boolean} [walking]  walk mode is on
 * @returns {() => void} detach
 */
export function attachKeyboard(element, onAction, walking = () => false) {
  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.target !== element) return; // typing in an overlay control must not move the camera
    const action = keyAction(e, { walking: walking() });
    if (!action) return;
    e.preventDefault();
    onAction(action);
  };
  element.addEventListener('keydown', onKey);
  return () => element.removeEventListener('keydown', onKey);
}
