// Building signs: white DOM pills (icon + name + optional stat chip) floating above each building,
// plus small labels (decor names, worktree tags). Positioned every frame by projecting their
// anchors with the camera, then decluttered in screen space so pills never pile on top of each
// other (nearer pills keep their place, farther ones move up). Only `transform` is written, and
// only when it changed.
import * as THREE from 'three';
import { BUILDINGS, BUILDING_KEYS } from '../../core/catalog.js';
import { compactSigns, formatStat, signLabel, signScale } from './sign-format.js';

/** @typedef {import('../../core/catalog.js').BuildingKey} BuildingKey */

/**
 * @typedef {object} Placed
 * @property {string} id
 * @property {HTMLElement} el
 * @property {THREE.Vector3} anchor
 * @property {string} transform  last written transform
 * @property {boolean} visible
 * @property {number} z          last written z-index
 * @property {number} w          measured size at scale 1 (0 = measure again)
 * @property {number} h
 * @property {number} x          this frame's screen position (bottom centre)
 * @property {number} y
 * @property {number} lx         last written position and scale (skip the DOM write if unchanged)
 * @property {number} ly
 * @property {number} ls
 * @property {HTMLElement} [stat]
 * @property {string} [name]
 */

const _v = new THREE.Vector3();
const GAP = 3;
/** Nearest (lowest on screen) first. */
const byNearest = (/** @type {Placed} */ a, /** @type {Placed} */ b) => b.y - a.y;

/**
 * @param {{container: HTMLElement, records: Record<BuildingKey, {signAnchor: THREE.Vector3}>, onSelect?: (key: BuildingKey) => void}} opts
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
  /** @type {Placed[]} visible items this frame, reused */
  const shown = [];
  for (const key of BUILDING_KEYS) placed.set(key, makeSign(key, records[key].signAnchor, root, onSelect));
  let list = [...placed.values()];
  let compact = false;
  document.fonts?.ready.then(() => remeasure(list));

  return {
    /**
     * @param {THREE.Camera} camera
     * @param {number} width @param {number} height  viewport px
     * @param {number} zoom  camera zoom (1 = whole town)
     */
    update(camera, width, height, zoom) {
      const nextCompact = compactSigns(width, zoom);
      if (nextCompact !== compact) {
        compact = nextCompact;
        root.classList.toggle('tt-env-signs--compact', compact);
        remeasure(list);
      }
      const scale = signScale(zoom);
      shown.length = 0;
      for (const item of list) {
        if (project(item, camera, width, height)) shown.push(item);
      }
      shown.sort(byNearest);
      declutter(shown, scale);
      for (const item of shown) write(item, scale);
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
      sign.w = 0;
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
      if (!item || BUILDING_KEYS.includes(/** @type {BuildingKey} */ (id))) return;
      item.el.remove();
      placed.delete(id);
      list = [...placed.values()];
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      root.classList.toggle('tt-env-signs--reduced', on);
    },
    dispose() {
      root.remove();
      placed.clear();
      list = [];
    },
  };
}

/**
 * @param {BuildingKey} key
 * @param {THREE.Vector3} anchor
 * @param {HTMLElement} root
 * @param {((key: BuildingKey) => void) | undefined} onSelect
 * @returns {Placed}
 */
function makeSign(key, anchor, root, onSelect) {
  const info = BUILDINGS[key];
  const el = document.createElement('button');
  el.type = 'button';
  el.tabIndex = -1;
  el.className = 'tt-sign';
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
  root.append(el);
  return { id: key, el, anchor, transform: '', visible: true, z: 0, w: 0, h: 0, x: 0, y: 0, lx: NaN, ly: NaN, ls: NaN, stat, name: info.name };
}

/**
 * @param {{id: string, text: string, icon?: string, position: THREE.Vector3, kind?: 'decor'|'tree'}} label
 * @param {HTMLElement} root
 * @returns {Placed}
 */
function makeLabel(label, root) {
  const el = document.createElement('span');
  el.className = `tt-label tt-label--${label.kind ?? 'decor'}`;
  if (label.icon) {
    const icon = document.createElement('span');
    icon.className = 'tt-label__icon';
    icon.textContent = label.icon;
    el.append(icon);
  }
  const text = document.createElement('span');
  text.textContent = label.text;
  el.append(text);
  root.append(el);
  return { id: label.id, el, anchor: label.position, transform: '', visible: true, z: 0, w: 0, h: 0, x: 0, y: 0, lx: NaN, ly: NaN, ls: NaN };
}

/** @param {Placed[]} items */
function remeasure(items) {
  for (const item of items) item.w = 0;
}

/**
 * Projects an anchor to screen space; hides items that are off-screen.
 * @param {Placed} item
 * @param {THREE.Camera} camera
 * @param {number} width @param {number} height
 */
function project(item, camera, width, height) {
  _v.copy(item.anchor).project(camera);
  item.x = (_v.x + 1) * 0.5 * width;
  item.y = (1 - _v.y) * 0.5 * height;
  const visible = item.x > -80 && item.x < width + 80 && item.y > -40 && item.y < height + 100 && _v.z < 1;
  if (visible !== item.visible) {
    item.visible = visible;
    item.el.style.visibility = visible ? '' : 'hidden';
  }
  if (visible && item.w === 0) {
    // Layout read, only after creation, font loads and stat changes.
    item.w = item.el.offsetWidth;
    item.h = item.el.offsetHeight;
  }
  return visible;
}

/**
 * Moves pills up until they no longer overlap a nearer pill. Items are sorted nearest first.
 * @param {Placed[]} items
 * @param {number} scale
 */
function declutter(items, scale) {
  for (let i = 1; i < items.length; i++) {
    const a = items[i];
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let j = 0; j < i; j++) {
        const b = items[j];
        const overlapX = Math.abs(a.x - b.x) < ((a.w + b.w) / 2) * scale + GAP;
        const overlapY = a.y > b.y - b.h * scale - GAP && a.y - a.h * scale < b.y + GAP;
        if (overlapX && overlapY) {
          a.y = b.y - b.h * scale - GAP;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
}

/**
 * Writes the transform only when the pill moved by a tenth of a pixel or rescaled.
 * @param {Placed} item
 * @param {number} scale
 */
function write(item, scale) {
  if (Math.abs(item.x - item.lx) > 0.1 || Math.abs(item.y - item.ly) > 0.1 || scale !== item.ls) {
    item.lx = item.x;
    item.ly = item.y;
    item.ls = scale;
    item.transform = `translate3d(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    item.el.style.transform = item.transform;
  }
  const z = Math.round(item.y / 4) + 100;
  if (z !== item.z) {
    item.z = z;
    item.el.style.zIndex = String(z);
  }
}

/** @param {HTMLElement} el */
function bump(el) {
  el.classList.remove('is-bumped');
  // Restart the CSS animation on the next frame.
  requestAnimationFrame(() => el.classList.add('is-bumped'));
}
