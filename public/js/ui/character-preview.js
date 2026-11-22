// The "You" dialog's live preview: a flat, front-facing drawing of the character in SVG, from the
// same profile and palettes the 3D figure is built from (world/agents/looks.js). SVG needs no
// WebGL, so the preview also works where the 3D town cannot start. Drawn again on every change:
// it is a few dozen shapes.
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES } from '../core/profile.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EYE = '#1A1A22';
const SOLE = '#2A1D15';

/**
 * @param {string} tag @param {Record<string, string|number>} attrs
 * @returns {SVGElement}
 */
function shape(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

/** A darker shade of a hex colour. @param {string} hex @param {number} t */
function darker(hex, t) {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (/** @type {number} */ v) => Math.min(255, Math.round(v * (1 - t))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/**
 * Draws a profile into a container (its previous drawing is replaced).
 * @param {HTMLElement} container
 * @param {import('../core/profile.js').Profile} profile
 * @param {string} color  the person's colour (hex)
 */
export function drawPreview(container, profile, color) {
  const l = profile.look;
  const skin = SKIN_TONES[l.skin].hex;
  const hair = HAIR_COLORS[l.hairColor].hex;
  const shirt = l.topColor === 'theme' ? color : CLOTH_COLORS[l.topColor].hex;
  const pants = CLOTH_COLORS[l.bottomColor].hex;
  const shoes = CLOTH_COLORS[l.shoesColor].hex;
  const svg = shape('svg', { viewBox: '0 0 120 200', class: 'hud-character__svg', 'aria-hidden': 'true', focusable: 'false' });
  const add = (/** @type {string} */ tag, /** @type {Record<string, string|number>} */ attrs) => svg.append(shape(tag, attrs));

  add('ellipse', { cx: 60, cy: 192, rx: 34, ry: 5, fill: 'rgb(0 0 0 / 18%)' });
  if (l.extra === 'cape') add('path', { d: 'M38 78 L82 78 L92 160 L28 160 Z', fill: darker(color, 0.2) });
  if (l.extra === 'backpack') add('rect', { x: 34, y: 82, width: 52, height: 48, rx: 8, fill: '#E8833A' });
  if (l.top === 'hoodie') add('ellipse', { cx: 60, cy: 76, rx: 22, ry: 10, fill: darker(shirt, 0.18) });

  legs(add, l, skin, pants);
  feet(add, l, skin, shoes);
  // Arms: sleeves in the top's colour, short for a T-shirt.
  for (const x of [26, 82]) {
    add('rect', { x, y: 80, width: 12, height: l.top === 'tee' ? 22 : 46, rx: 6, fill: shirt });
    if (l.top === 'tee') add('rect', { x: x + 1, y: 100, width: 10, height: 26, rx: 5, fill: skin });
    add('circle', { cx: x + 6, cy: 130, r: 6, fill: skin });
  }
  add('rect', { x: 36, y: 76, width: 48, height: 52, rx: 12, fill: shirt });
  top(add, l, shirt);
  add('rect', { x: 54, y: 66, width: 12, height: 12, fill: skin });

  head(add, l, skin, hair);
  if (l.extra === 'scarf') {
    add('rect', { x: 44, y: 72, width: 32, height: 9, rx: 4, fill: color });
    add('rect', { x: 62, y: 76, width: 8, height: 24, rx: 3, fill: darker(color, -0.15) });
  }
  if (l.extra === 'headphones') {
    add('path', { d: 'M32 46 A28 28 0 0 1 88 46', fill: 'none', stroke: '#2D3340', 'stroke-width': 4 });
    for (const cx of [32, 88]) add('rect', { x: cx - 5, y: 40, width: 10, height: 16, rx: 4, fill: color });
  }
  hat(add, l.hat, color);
  container.replaceChildren(svg);
}

/** @typedef {(tag: string, attrs: Record<string, string|number>) => void} Add */

/** @param {Add} add @param {import('../core/profile.js').PersonLook} l @param {string} skin @param {string} pants */
function legs(add, l, skin, pants) {
  for (const x of [44, 64]) {
    if (l.bottom === 'trousers') add('rect', { x, y: 122, width: 12, height: 56, rx: 4, fill: pants });
    else if (l.bottom === 'shorts') {
      add('rect', { x: x + 1, y: 140, width: 10, height: 38, rx: 4, fill: skin });
      add('rect', { x, y: 122, width: 12, height: 24, rx: 4, fill: pants });
    } else add('rect', { x: x + 1, y: 140, width: 10, height: 38, rx: 4, fill: skin });
  }
  if (l.bottom === 'skirt') add('path', { d: 'M40 120 L80 120 L88 152 L32 152 Z', fill: pants });
  else add('rect', { x: 42, y: 118, width: 36, height: 12, rx: 4, fill: pants });
}

/** @param {Add} add @param {import('../core/profile.js').PersonLook} l @param {string} skin @param {string} shoes */
function feet(add, l, skin, shoes) {
  for (const x of [42, 62]) {
    if (l.shoes === 'sandals') {
      add('rect', { x: x + 1, y: 176, width: 15, height: 6, rx: 3, fill: skin });
      add('rect', { x: x + 1, y: 177, width: 15, height: 2, fill: shoes });
      add('rect', { x, y: 182, width: 17, height: 3, rx: 1, fill: shoes });
    } else if (l.shoes === 'sneakers') {
      add('rect', { x, y: 175, width: 17, height: 8, rx: 4, fill: shoes });
      add('rect', { x, y: 182, width: 17, height: 3, rx: 1, fill: '#F2F0EA' });
    } else {
      add('rect', { x, y: 170, width: 17, height: 13, rx: 4, fill: shoes });
      add('rect', { x, y: 182, width: 17, height: 3, rx: 1, fill: SOLE });
    }
  }
}

/** @param {Add} add @param {import('../core/profile.js').PersonLook} l @param {string} shirt */
function top(add, l, shirt) {
  const trim = darker(shirt, 0.2);
  if (l.top === 'tee') add('rect', { x: 64, y: 88, width: 9, height: 8, rx: 1, fill: trim });
  else if (l.top === 'hoodie') {
    add('rect', { x: 46, y: 106, width: 28, height: 12, rx: 4, fill: trim });
    for (const x of [55, 64]) add('rect', { x, y: 80, width: 2, height: 12, fill: '#F2F0EA' });
  } else if (l.top === 'jacket') {
    add('rect', { x: 59, y: 78, width: 2, height: 50, fill: darker(shirt, 0.4) });
    add('path', { d: 'M48 76 L58 76 L56 88 Z M72 76 L62 76 L64 88 Z', fill: trim });
  } else {
    add('rect', { x: 50, y: 74, width: 20, height: 6, rx: 3, fill: trim });
    add('rect', { x: 36, y: 122, width: 48, height: 6, rx: 3, fill: trim });
  }
}

/** @param {Add} add @param {import('../core/profile.js').PersonLook} l @param {string} skin @param {string} hair */
function head(add, l, skin, hair) {
  if (l.hair === 'long') add('rect', { x: 34, y: 34, width: 52, height: 44, rx: 14, fill: hair });
  add('circle', { cx: 60, cy: 44, r: 25, fill: skin });
  for (const cx of [35, 85]) add('circle', { cx, cy: 46, r: 5, fill: skin });
  // Hair on top of the head.
  if (l.hair === 'buzz') add('path', { d: 'M36 40 A25 25 0 0 1 84 40 Q60 30 36 40 Z', fill: hair });
  else if (l.hair !== 'bald') add('path', { d: 'M35 44 A25 25 0 0 1 85 44 Q74 30 60 32 Q44 32 35 44 Z', fill: hair });
  if (l.hair === 'bun' && l.hat === 'none') add('circle', { cx: 60, cy: 14, r: 9, fill: hair });
  if (l.hair === 'curly' && l.hat === 'none') for (const [cx, cy] of [[42, 24], [52, 18], [64, 17], [76, 22], [84, 32], [36, 32]]) add('circle', { cx, cy, r: 7, fill: hair });
  // Eyes.
  for (const cx of [51, 69]) {
    if (l.eyes === 'happy') add('path', { d: `M${cx - 4} 48 Q${cx} 42 ${cx + 4} 48`, fill: 'none', stroke: EYE, 'stroke-width': 2.2, 'stroke-linecap': 'round' });
    else if (l.eyes === 'round') {
      add('circle', { cx, cy: 46, r: 5, fill: '#FFFFFF' });
      add('circle', { cx, cy: 46.5, r: 2.8, fill: EYE });
    } else add('ellipse', { cx, cy: 46, rx: 2.6, ry: 3.2, fill: EYE });
  }
  add('path', { d: 'M54 56 Q60 61 66 56', fill: 'none', stroke: '#6B2F2A', 'stroke-width': 2, 'stroke-linecap': 'round' });
  face(add, l, skin, hair);
}

/** @param {Add} add @param {import('../core/profile.js').PersonLook} l @param {string} skin @param {string} hair */
function face(add, l, skin, hair) {
  if (l.face === 'freckles') for (const [cx, cy] of [[44, 52], [47, 55], [42, 56], [76, 52], [73, 55], [78, 56]]) add('circle', { cx, cy, r: 1.1, fill: darker(skin, 0.3) });
  if (l.face === 'beard') add('path', { d: 'M38 50 Q40 74 60 74 Q80 74 82 50 Q74 64 60 64 Q46 64 38 50 Z', fill: hair });
  if (l.face === 'moustache') add('path', { d: 'M51 55 Q60 50 69 55 Q60 54 51 55 Z', fill: hair, stroke: hair, 'stroke-width': 2 });
  if (l.face === 'glasses') {
    for (const cx of [51, 69]) add('circle', { cx, cy: 46, r: 7, fill: 'none', stroke: '#2D3340', 'stroke-width': 2 });
    add('path', { d: 'M58 46 L62 46', stroke: '#2D3340', 'stroke-width': 2 });
  }
}

/** @param {Add} add @param {string} kind @param {string} color */
function hat(add, kind, color) {
  if (kind === 'cap') {
    add('path', { d: 'M35 36 A25 22 0 0 1 85 36 Z', fill: color });
    add('path', { d: 'M58 36 L92 36 Q90 41 58 40 Z', fill: darker(color, 0.25) });
  } else if (kind === 'beanie') {
    add('path', { d: 'M35 38 A25 26 0 0 1 85 38 Z', fill: color });
    add('rect', { x: 34, y: 33, width: 52, height: 8, rx: 3, fill: darker(color, 0.22) });
    add('circle', { cx: 60, cy: 11, r: 5, fill: '#F2F0EA' });
  } else if (kind === 'beret') {
    add('ellipse', { cx: 64, cy: 24, rx: 27, ry: 9, fill: '#8E2236', transform: 'rotate(-8 64 24)' });
  } else if (kind === 'sunhat') {
    add('ellipse', { cx: 60, cy: 30, rx: 40, ry: 6, fill: '#E9CD84' });
    add('path', { d: 'M42 30 Q42 12 60 12 Q78 12 78 30 Z', fill: '#E3C277' });
    add('rect', { x: 42, y: 25, width: 36, height: 5, fill: color });
  } else if (kind === 'wizard') {
    add('ellipse', { cx: 60, cy: 26, rx: 32, ry: 5, fill: '#4C3A9E' });
    add('path', { d: 'M42 26 L64 -10 L78 26 Z', fill: '#4C3A9E' });
    add('circle', { cx: 60, cy: 12, r: 2.5, fill: '#FFD54A' });
  } else if (kind === 'crown') {
    add('path', { d: 'M42 26 L42 12 L51 20 L60 8 L69 20 L78 12 L78 26 Z', fill: '#F4C430' });
    add('circle', { cx: 60, cy: 20, r: 2.4, fill: '#E0245E' });
  } else if (kind === 'hardhat') {
    add('path', { d: 'M36 32 A24 22 0 0 1 84 32 Z', fill: '#FFC21A' });
    add('rect', { x: 30, y: 30, width: 60, height: 5, rx: 2, fill: '#EBAA00' });
  }
}
