// Place labels: small signs drawn on the buildings themselves (the icon, plus the name and an
// optional stat chip when there is room), decor labels and worktree tags. Every frame each anchor
// is projected with the camera, env/sign-layout.js decides what shows where, and only changed
// transforms, classes and z-indices are written.
//
// The labels used to float above the roofs, which on an isometric view is the street behind, where
// the next building's agents stand. Now a label sits inside its building's outline, names appear
// only when they fit (zoom in to read them), and a figure in front of a label fades it out and
// gets the clicks (rules in sign-layout.js).
import * as THREE from 'three';
import { BUILDINGS, BUILDING_KEYS } from '../../core/catalog.js';
import { isPlaceNames } from '../../core/place-names.js';
import { formatStat, signLabel, signScale } from './sign-format.js';
import { coversFigure, placeLabels } from './sign-layout.js';
import { LOT_Y } from './terrain.js';

/** @typedef {import('../../core/catalog.js').BuildingKey} BuildingKey */
/** @typedef {import('../../core/place-names.js').PlaceNames} PlaceNames */
/** @typedef {import('./sign-layout.js').FigureBox} FigureBox */

/**
 * @typedef {object} SignRecord
 * @property {THREE.Vector3} signAnchor  the designed sign spot, at the front of the main building
 * @property {number} height
 * @property {THREE.Box3} pickBox        the lot, up to the building's height
 */

/**
 * @typedef {import('./sign-layout.js').LabelBox & {
 *   id: string, el: HTMLElement, anchor: THREE.Vector3, groundAt: THREE.Vector3,
 *   corners: THREE.Vector3[]|null, roomUnits: number, measured: boolean,
 *   shown: string, shownFaded: boolean, shownFocused: boolean, lx: number, ly: number, ls: number, z: number,
 *   stat?: HTMLElement, name?: string,
 * }} Placed
 */

const _v = new THREE.Vector3();
/** Size of the round icon-only label; keep in sync with --sign-size in env.css. */
const ICON_SIZE = 24;
/** Share of a lot's width on screen a name may take: lots have yards around the building. */
const ROOM_FILL = 0.55;
/** Height of a label on its building, as a share of the building's height. */
const LABEL_HEIGHT = 0.68;
/** World width a decor label (Sandbox, node_modules) may use before it shrinks to its icon. */
const DECOR_ROOM = 3.2;
const STATES = /** @type {const} */ (['name', 'icon', 'hidden']);

/**
 * @param {{container: HTMLElement, records: Record<BuildingKey, SignRecord>, onSelect?: (key: BuildingKey) => void}} opts
 */
export function createSigns({ container, records, onSelect }) {
  // The overlay is absolutely positioned over the container, which therefore must be positioned.
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const root = document.createElement('div');
  root.className = 'tt-env-signs';
  // Decorative: the HUD lists the same buildings and stats as text.
  root.setAttribute('aria-hidden', 'true');
  container.append(root);
  /** @type {Map<string, Placed>} */
  const placed = new Map();
  /** @type {Placed[]} placing order, reused */
  const order = [];
  /** @type {PlaceNames} */
  let mode = 'auto';
  /** @type {string|null} */
  let selected = null;
  /** @type {string|null} */
  let pointed = null; // the 3D view's hover
  /** @type {string|null} */
  let touched = null; // the pointer over a label itself
  /** @type {() => ReadonlyArray<FigureBox>} */
  let figures = () => [];
  const focus = () => {
    for (const item of placed.values()) item.focused = item.id === selected || item.id === pointed || item.id === touched;
  };
  const hover = (/** @type {string|null} */ id) => {
    touched = id;
    focus();
  };
  for (const key of BUILDING_KEYS) placed.set(key, makeSign(key, records[key], root, onSelect, hover));
  let list = [...placed.values()];
  document.fonts?.ready.then(() => remeasure(list));

  return {
    /**
     * @param {THREE.Camera} camera
     * @param {number} width @param {number} height  viewport px
     * @param {number} zoom  camera zoom (1 = whole town)
     */
    update(camera, width, height, zoom) {
      const scale = signScale(zoom);
      const ppu = pixelsPerUnit(camera, height);
      for (const item of list) project(item, camera, width, height, ppu);
      placeLabels(list, mode, scale, order);
      const people = figures();
      for (const item of list) write(item, scale, item.state !== 'hidden' && coversFigure(item, people));
    },
    /** @param {BuildingKey} key @param {string|null} text */
    setStat(key, text) {
      const sign = placed.get(key);
      if (!sign?.stat) return;
      const value = formatStat(text);
      const changed = sign.stat.textContent !== (value ?? '');
      sign.stat.textContent = value ?? '';
      sign.stat.hidden = !value;
      sign.el.title = `${signLabel(sign.name ?? '', value)} — ${BUILDINGS[key].blurb}`;
      sign.measured = false;
      if (changed && value) bump(sign.stat);
    },
    /**
     * Small label that follows a world position (decor names, worktree tags). The position is
     * read every frame, so moving the vector moves the label.
     * @param {{id: string, text: string, icon?: string, position: THREE.Vector3, kind?: 'decor'|'tree'}} label
     */
    addLabel(label) {
      placed.get(label.id)?.el.remove();
      placed.set(label.id, makeLabel(label, root));
      list = [...placed.values()];
    },
    /** @param {string} id */
    removeLabel(id) {
      const item = placed.get(id);
      if (!item || item.kind === 'building') return;
      item.el.remove();
      placed.delete(id);
      list = [...placed.values()];
    },
    /** @param {unknown} next 'auto' | 'always' | 'off' */
    setMode(next) {
      if (isPlaceNames(next)) mode = next;
    },
    /** The selected building shows its name whatever the mode. @param {string|null} key */
    setSelected(key) {
      selected = key;
      focus();
    },
    /** The building under the pointer in the 3D view shows its name too. @param {string|null} key */
    setHovered(key) {
      pointed = key;
      focus();
    },
    /** Where the agents are on screen (last frame), so labels can make way. @param {() => ReadonlyArray<FigureBox>} fn */
    setFigures(fn) {
      figures = typeof fn === 'function' ? fn : () => [];
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      root.classList.toggle('tt-env-signs--reduced', on);
    },
    dispose() {
      root.remove();
      placed.clear();
      list = [];
      order.length = 0;
    },
  };
}

/**
 * @param {Partial<Placed> & {id: string, el: HTMLElement, kind: Placed['kind'], align: Placed['align'], anchor: THREE.Vector3, groundAt: THREE.Vector3}} parts
 * @returns {Placed}
 */
function placedItem(parts) {
  return {
    x: 0, y: 0, wName: 0, wIcon: 0, h: 0, room: Infinity, depth: 0, ground: 0,
    focused: false, visible: false, state: 'hidden', faded: false,
    left: 0, top: 0, right: 0, bottom: 0,
    corners: null, roomUnits: 0, measured: false,
    shown: 'hidden', shownFaded: false, shownFocused: false, lx: NaN, ly: NaN, ls: NaN, z: 0,
    ...parts,
  };
}

/**
 * @param {BuildingKey} key
 * @param {SignRecord} record
 * @param {HTMLElement} root
 * @param {((key: BuildingKey) => void) | undefined} onSelect
 * @param {(id: string|null) => void} hover
 * @returns {Placed}
 */
function makeSign(key, record, root, onSelect, hover) {
  const info = BUILDINGS[key];
  const el = document.createElement('button');
  el.type = 'button';
  el.tabIndex = -1;
  el.className = 'tt-sign is-hidden';
  el.dataset.building = key;
  el.title = `${info.name} — ${info.blurb}`;
  const icon = document.createElement('span');
  icon.className = 'tt-sign__icon';
  icon.textContent = info.icon;
  const name = document.createElement('span');
  name.className = 'tt-sign__name';
  name.textContent = info.name;
  const stat = document.createElement('span');
  stat.className = 'tt-sign__stat';
  stat.hidden = true;
  el.append(icon, name, stat);
  el.addEventListener('click', () => onSelect?.(key));
  el.addEventListener('pointerenter', () => hover(key));
  el.addEventListener('pointerleave', () => hover(null));
  root.append(el);
  // On the building, about two thirds up its front: inside its outline from every side.
  const sign = record.signAnchor;
  const top = Math.min(LOT_Y + record.height, sign.y);
  const anchor = new THREE.Vector3(sign.x, LOT_Y + (top - LOT_Y) * LABEL_HEIGHT, sign.z);
  const box = record.pickBox;
  const corners = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  return placedItem({
    id: key, el, kind: 'building', align: 'center', anchor,
    groundAt: new THREE.Vector3(sign.x, LOT_Y, sign.z), corners, stat, name: info.name,
  });
}

/**
 * @param {{id: string, text: string, icon?: string, position: THREE.Vector3, kind?: 'decor'|'tree'}} label
 * @param {HTMLElement} root
 * @returns {Placed}
 */
function makeLabel(label, root) {
  const kind = label.kind ?? 'decor';
  const el = document.createElement('span');
  el.className = `tt-sign tt-sign--${kind} is-hidden`;
  if (label.icon) {
    const icon = document.createElement('span');
    icon.className = 'tt-sign__icon';
    icon.textContent = label.icon;
    el.append(icon);
  }
  const text = document.createElement('span');
  text.className = 'tt-sign__name';
  text.textContent = label.text;
  el.append(text);
  root.append(el);
  return placedItem({
    id: label.id, el, kind, align: 'bottom', anchor: label.position,
    // The ground under the label, read every frame like the label itself.
    groundAt: new THREE.Vector3(), roomUnits: kind === 'decor' ? DECOR_ROOM : 0,
    wIcon: kind === 'decor' && label.icon ? ICON_SIZE : 0,
  });
}

/** @param {Placed[]} items */
function remeasure(items) {
  for (const item of items) item.measured = false;
}

/**
 * Screen pixels per world unit for an orthographic camera.
 * @param {THREE.Camera} camera @param {number} height viewport px
 */
function pixelsPerUnit(camera, height) {
  const cam = /** @type {THREE.OrthographicCamera} */ (camera);
  return cam.isOrthographicCamera ? (height * cam.zoom) / Math.max(1e-6, cam.top - cam.bottom) : 30;
}

/**
 * Projects an item's anchor, ground and lot to screen space.
 * @param {Placed} item
 * @param {THREE.Camera} camera
 * @param {number} width @param {number} height
 * @param {number} ppu
 */
function project(item, camera, width, height, ppu) {
  _v.copy(item.anchor).project(camera);
  item.x = (_v.x + 1) * 0.5 * width;
  item.y = (1 - _v.y) * 0.5 * height;
  item.depth = _v.z;
  item.visible = item.x > -80 && item.x < width + 80 && item.y > -40 && item.y < height + 60 && _v.z < 1;
  if (!item.visible) return;
  if (item.kind === 'building') _v.copy(item.groundAt);
  else _v.set(item.anchor.x, 0, item.anchor.z);
  _v.project(camera);
  item.ground = (1 - _v.y) * 0.5 * height;
  if (item.corners) {
    let min = Infinity;
    let max = -Infinity;
    for (const corner of item.corners) {
      const sx = (_v.copy(corner).project(camera).x + 1) * 0.5 * width;
      if (sx < min) min = sx;
      if (sx > max) max = sx;
    }
    item.room = (max - min) * ROOM_FILL;
  } else {
    item.room = item.roomUnits > 0 ? item.roomUnits * ppu : Infinity;
  }
  if (!item.measured) measure(item);
}

/**
 * Reads the label's size with its name showing (a layout read, only after creation, font loads and
 * stat changes).
 * @param {Placed} item
 */
function measure(item) {
  const el = item.el;
  el.classList.add('is-measuring');
  item.wName = el.offsetWidth;
  item.h = el.offsetHeight;
  el.classList.remove('is-measuring');
  if (item.kind === 'building') item.wIcon = ICON_SIZE;
  item.measured = item.wName > 0;
}

/**
 * Writes what changed: state and fade classes, transform, z-index.
 * @param {Placed} item
 * @param {number} scale
 * @param {boolean} faded
 */
function write(item, scale, faded) {
  const el = item.el;
  if (item.state !== item.shown) {
    for (const state of STATES) el.classList.toggle(`is-${state}`, item.state === state);
    item.shown = item.state;
  }
  if (faded !== item.shownFaded) {
    el.classList.toggle('is-faded', faded);
    item.shownFaded = faded;
  }
  if (item.focused !== item.shownFocused) {
    el.classList.toggle('is-focused', item.focused);
    item.shownFocused = item.focused;
  }
  if (item.state === 'hidden') return;
  if (Math.abs(item.x - item.lx) > 0.1 || Math.abs(item.y - item.ly) > 0.1 || scale !== item.ls) {
    item.lx = item.x;
    item.ly = item.y;
    item.ls = scale;
    const lift = item.align === 'center' ? '-50%' : '-100%';
    el.style.transform = `translate3d(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px, 0) translate(-50%, ${lift}) scale(${scale.toFixed(3)})`;
  }
  const z = item.focused ? 5000 : Math.round(item.y / 4) + 100;
  if (z !== item.z) {
    item.z = z;
    el.style.zIndex = String(z);
  }
}

/** @param {HTMLElement} el */
function bump(el) {
  el.classList.remove('is-bumped');
  // Restart the CSS animation on the next frame.
  requestAnimationFrame(() => el.classList.add('is-bumped'));
}
