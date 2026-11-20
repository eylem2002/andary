// Per-frame placement of the DOM name tags: project each agent's head to the screen, hide tags
// that are off-screen, scale them gently with zoom, shrink pills lost in a crowd to their status
// dot, keep the number of bubbles down (a few at once, two over one spot), and nudge overlapping
// bubbles apart.
// Transforms only (no layout reads), and no allocations once the box pool has grown.

import * as THREE from 'three';
import { bubblePriority, deOverlap, pickBubbles } from './bubbles.js';
import { BUBBLE_GAP } from './overlay.js';
import { clamp, damp } from './easing.js';

/** Pill height and the gap under it, in CSS px; keep in sync with .tt-pill in world.css. */
const PILL_HEIGHT = 22;
const PILL_BOTTOM = 4;
/** Pixels per world unit at which tags are drawn at their natural size. */
const NATURAL_PPU = 34;
const MARGIN_NDC = 1.08;
/** Half a figure's width in world units at height 1, arms and carried tools included. */
const FIGURE_HALF_WIDTH = 0.42;
/** Width of a pill shrunk to its status dot; keep in sync with .tt-tag.is-compact in world.css. */
const COMPACT_W = 20;
/** Extra room a shrunk pill needs before it expands again, so crowd edges don't flicker. */
const EXPAND_MARGIN = 6;

const _v = new THREE.Vector3();
/** Pills (fixed) and bubbles (movable) on screen this frame; reused across frames. @type {Array<import('./bubbles.js').BubbleBox & {tag: import('./overlay.js').AgentTag|null}>} */
const boxes = [];
let order = new Int32Array(64);
/** Visible pills this frame, for the crowd pass; reused across frames. @type {CrowdPill[]} */
const pills = [];
let pillOrder = new Int32Array(64);
/** Bubbles that want to show this frame, for the budget pass; reused across frames. @type {Array<import('./bubbles.js').BubbleCandidate & {tag: import('./overlay.js').AgentTag|null}>} */
const talkers = [];
let talkOrder = new Int32Array(64);

/**
 * @typedef {object} CrowdPill
 * @property {number} x         horizontal centre (px)
 * @property {number} y         bottom edge (px)
 * @property {number} w
 * @property {number} h
 * @property {number} priority  higher keeps its full pill
 * @property {boolean} compact  in: last frame's state; out: this frame's
 * @property {import('./agent.js').Agent|null} agent
 */

/**
 * Decides which name pills shrink to their status dot so the rest of a crowd stays readable.
 * Greedy by priority: a pill keeps its full width unless it would overlap a full pill that was
 * placed before it. Allocation-free; `scratch` must hold `count` entries.
 * @param {CrowdPill[]} list @param {number} count @param {Int32Array} scratch
 */
export function pickCompactPills(list, count, scratch) {
  for (let i = 0; i < count; i++) scratch[i] = i;
  for (let i = 1; i < count; i++) {
    const k = scratch[i];
    let j = i - 1;
    while (j >= 0 && list[scratch[j]].priority < list[k].priority) {
      scratch[j + 1] = scratch[j];
      j--;
    }
    scratch[j + 1] = k;
  }
  for (let i = 0; i < count; i++) {
    const p = list[scratch[i]];
    const margin = p.compact ? EXPAND_MARGIN : 0;
    let clash = false;
    for (let j = 0; j < i && !clash; j++) {
      const q = list[scratch[j]];
      if (q.compact) continue;
      clash = Math.abs(p.x - q.x) * 2 < p.w + q.w + 2 * margin && Math.abs(p.y - q.y) < (p.h + q.h) / 2 + margin;
    }
    p.compact = clash;
  }
}

/**
 * Selected or hovered agents first, then those speaking, then the ones nearest the camera.
 * @param {import('./agent.js').Agent} a @param {number} screenY
 */
function pillPriority(a, screenY) {
  if (a.tag.selected || a.tag.hovered) return 3e6 + screenY;
  if (a.tag.bubbleShown) return 2e6 + screenY;
  return screenY;
}

/** @param {number} n */
function crowdPill(n) {
  return (pills[n] ??= { x: 0, y: 0, w: 0, h: 0, priority: 0, compact: false, agent: null });
}

/**
 * Shrinks crowded pills, then returns each visible agent's pill width for the bubble pass.
 * @param {number} count @param {number} scale
 */
function settleCrowd(count, scale) {
  if (pillOrder.length < count) pillOrder = new Int32Array(count * 2);
  pickCompactPills(pills, count, pillOrder);
  for (let i = 0; i < count; i++) {
    const p = pills[i];
    p.agent.tag.setCompact(p.compact);
    p.w = (p.compact ? COMPACT_W : p.agent.tag.pillW) * scale;
  }
}

/**
 * Screen pixels per world unit for an orthographic camera (a fixed guess otherwise).
 * @param {THREE.Camera} camera @param {number} height viewport CSS px
 */
function pixelsPerUnit(camera, height) {
  const cam = /** @type {THREE.OrthographicCamera} */ (camera);
  if (!cam.isOrthographicCamera) return NATURAL_PPU;
  return (height * cam.zoom) / Math.max(1e-6, cam.top - cam.bottom);
}

/** Tag scale for a zoom level: grows and shrinks a little with the map, but stays legible. @param {number} ppu */
function tagScale(ppu) {
  return clamp(Math.sqrt(ppu / NATURAL_PPU), 0.8, 1.15);
}

/**
 * How far above a head (world units) clears its name pill, so 3D icons are not hidden behind it.
 * @param {{camera: THREE.Camera, height: number}} view
 */
export function pillClearance(view) {
  const ppu = pixelsPerUnit(view.camera, view.height);
  const px = (PILL_HEIGHT + PILL_BOTTOM + 6) * tagScale(ppu);
  // A vertical world distance d shows as d·cos(pitch) on screen; the camera looks down ~35°.
  return px / (ppu * 0.82);
}

/**
 * Size boost for icons above heads when zoomed out, so a ✓ stays readable at overview zoom.
 * @param {{camera: THREE.Camera, height: number}} view
 */
export function iconBoost(view) {
  return clamp(Math.sqrt(NATURAL_PPU / pixelsPerUnit(view.camera, view.height)), 1, 1.6);
}

/** @param {number} n */
function box(n) {
  return (boxes[n] ??= { x: 0, bottom: 0, w: 0, h: 0, dy: 0, fixed: false, tag: null });
}

/**
 * Fills the de-overlap boxes: every visible pill is a fixed obstacle the bubbles must not cover,
 * and every shown bubble is a movable box. Returns the number of boxes.
 * @param {number} count @param {number} scale
 */
function obstaclesAndBubbles(count, scale) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const p = pills[i];
    const tag = p.agent.tag;
    const pill = box(n++);
    pill.x = p.x;
    pill.bottom = p.y;
    pill.w = p.w;
    pill.h = p.h;
    pill.fixed = true;
    pill.tag = null;
    if (tag.bubbleShown && !tag.bubbleMuted) {
      const bubble = box(n++);
      bubble.x = p.x;
      bubble.bottom = p.y - (PILL_HEIGHT + BUBBLE_GAP) * scale;
      bubble.w = tag.bubbleW * scale;
      bubble.h = tag.bubbleH * scale;
      bubble.fixed = false;
      bubble.tag = tag;
    }
    p.agent = null;
  }
  return n;
}

/**
 * Mutes the bubbles over the budget (pickBubbles): the selected agent, urgent lines and the newest
 * keep theirs.
 * @param {number} count visible pills @param {number} scale
 */
function settleBubbles(count, scale) {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const agent = pills[i].agent;
    const tag = agent.tag;
    if (!tag.bubbleShown) continue;
    const t = (talkers[n++] ??= { x: 0, y: 0, w: 0, h: 0, priority: 0, muted: false, tag: null });
    t.x = pills[i].x;
    t.y = pills[i].y - (PILL_HEIGHT + BUBBLE_GAP) * scale;
    t.w = tag.bubbleW * scale;
    t.h = tag.bubbleH * scale;
    t.muted = tag.bubbleMuted;
    t.priority = bubblePriority({ selected: tag.selected, hovered: tag.hovered, tone: tag.bubbleTone, shownAt: agent.bubble.current?.shownAt ?? 0, muted: tag.bubbleMuted });
    t.tag = tag;
  }
  if (talkOrder.length < n) talkOrder = new Int32Array(n * 2);
  pickBubbles(talkers, n, talkOrder);
  for (let i = 0; i < n; i++) {
    talkers[i].tag.setBubbleMuted(talkers[i].muted);
    talkers[i].tag = null;
  }
}

/**
 * @param {import('./agent.js').Agent[]} agents
 * @param {{camera: THREE.Camera, width: number, height: number}} view
 * @param {number} dt
 */
export function layoutTags(agents, view, dt) {
  const { camera, width, height } = view;
  const ppu = pixelsPerUnit(camera, height);
  const scale = tagScale(ppu);
  let visibleCount = 0;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    _v.copy(a.top).project(camera);
    const onScreen = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) < MARGIN_NDC && Math.abs(_v.y) < MARGIN_NDC;
    const visible = onScreen && a.group.visible && a.appear > 0.3;
    const x = (_v.x + 1) * 0.5 * width;
    const y = (1 - _v.y) * 0.5 * height;
    a.screen.x = x;
    a.screen.y = y;
    a.screen.visible = visible;
    a.tag.place(x, y, scale, visible);
    if (!visible) continue;
    // The whole figure, head to feet, for the building labels to make way for (env/signs.js).
    _v.copy(a.position).project(camera);
    a.screen.feet = (1 - _v.y) * 0.5 * height;
    a.screen.half = FIGURE_HALF_WIDTH * a.look.height * ppu;
    a.tag.setDepth(y);
    const p = crowdPill(visibleCount++);
    p.x = x;
    p.y = y - PILL_BOTTOM * scale;
    p.w = a.tag.pillW * scale;
    p.h = PILL_HEIGHT * scale;
    p.priority = pillPriority(a, y);
    p.compact = a.tag.compact;
    p.agent = a;
  }
  settleCrowd(visibleCount, scale);
  settleBubbles(visibleCount, scale);
  const n = obstaclesAndBubbles(visibleCount, scale);
  if (order.length < n) order = new Int32Array(n * 2);
  deOverlap(boxes, n, order, 4);
  const k = damp(14, dt);
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    if (!b.tag) continue;
    const target = b.dy / scale;
    const shift = b.tag.shift;
    // Slide toward the de-overlapped place; snap when close so it settles exactly.
    b.tag.setBubbleShift(Math.abs(target - shift) < 2 ? target : shift + (target - shift) * k);
    b.tag = null;
  }
}
