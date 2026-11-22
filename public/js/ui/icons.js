// Small line icons for the HUD, drawn on a 24-unit grid and built with createElementNS (no HTML
// parsing). A string is a path; an array is [tag, attributes] for circles and rects.

const NS = 'http://www.w3.org/2000/svg';

/** @typedef {string | [string, Record<string, string|number>]} Shape */

const dot = (cx, cy, r = 1.4) => /** @type {Shape} */ (['circle', { cx, cy, r, fill: 'currentColor', stroke: 'none' }]);
const circle = (cx, cy, r) => /** @type {Shape} */ (['circle', { cx, cy, r }]);
const ellipse = (cx, cy, rx, ry) => /** @type {Shape} */ (['ellipse', { cx, cy, rx, ry }]);
const rect = (x, y, width, height, rx = 2) => /** @type {Shape} */ (['rect', { x, y, width, height, rx }]);

/** @type {Record<string, Shape[]>} */
const ICONS = {
  video: [rect(2.5, 6.5, 13, 11, 2.2), 'M15.5 10.5 21.5 7v10l-6-3.5'],
  panels: [rect(2.5, 4.5, 19, 15, 2.2), 'M8.5 4.5v15M15.5 4.5v15'],
  repeat: ['M16.5 3.5 20 7l-3.5 3.5', 'M4 11.5v-1.5a3 3 0 0 1 3-3h13', 'M7.5 20.5 4 17l3.5-3.5', 'M20 12.5V14a3 3 0 0 1-3 3H4'],
  follow: [circle(12, 12, 6.5), 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4', dot(12, 12, 1.9)],
  rotateLeft: ['M4.5 4v5h5', 'M4.9 9A7.6 7.6 0 1 1 4.6 14.5'],
  rotateRight: ['M19.5 4v5h-5', 'M19.1 9A7.6 7.6 0 1 0 19.4 14.5'],
  zoomIn: [circle(10.5, 10.5, 6.5), 'M15.4 15.4 20.5 20.5M10.5 7.6v5.8M7.6 10.5h5.8'],
  zoomOut: [circle(10.5, 10.5, 6.5), 'M15.4 15.4 20.5 20.5M7.6 10.5h5.8'],
  resetView: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', circle(12, 12, 2.6)],
  sun: [circle(12, 12, 4), 'M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6'],
  moon: ['M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z'],
  sunset: ['M3 16.5h18', 'M7 16.5a5 5 0 0 1 10 0', 'M12 6v2.4M5.2 9.7l1.6 1.6M18.8 9.7l-1.6 1.6', 'M8 20h8'],
  clock: [circle(12, 12, 8.5), 'M12 7.4V12l3.2 2'],
  quality: ['M6.5 4h11l3.5 5-9 11-9-11z', 'M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5'],
  soundOn: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8'],
  soundOff: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5M21 9.5l-5 5'],
  pause: [rect(6.5, 5, 3.6, 14, 1), rect(13.9, 5, 3.6, 14, 1)],
  play: ['M7.5 4.8v14.4L19 12z'],
  help: [circle(12, 12, 9), 'M9.4 9.4a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.3-2.6 4', dot(12, 17.3, 1.2)],
  settings: ['M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9', circle(15.2, 7.5, 2.2), circle(8.8, 16.5, 2.2)],
  close: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
  chevronDown: ['M6.5 9.5 12 15l5.5-5.5'],
  chevronUp: ['M6.5 14.5 12 9l5.5 5.5'],
  bell: ['M6.2 16.5V11a5.8 5.8 0 0 1 11.6 0v5.5l1.7 2H4.5z', 'M10 20.6a2.1 2.1 0 0 0 4 0'],
  copy: [rect(8.5, 8.5, 11.5, 11.5), 'M15.5 8.5V5.6A1.6 1.6 0 0 0 13.9 4H5.6A1.6 1.6 0 0 0 4 5.6v8.3a1.6 1.6 0 0 0 1.6 1.6h2.9'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  cross: ['M7 7l10 10M17 7 7 17'],
  key: [circle(8, 15.5, 4), 'M10.9 12.6 19 4.5M15.5 8l2.6 2.6M17.6 5.9l2.2 2.2'],
  terminal: [rect(3, 4.5, 18, 15), 'M7 9.5l3 2.5-3 2.5M12.5 15H17'],
  book: ['M12 6.6C10 5 7 4.6 3.5 5v13c3.5-.4 6.5 0 8.5 1.6 2-1.6 5-2 8.5-1.6V5C17 4.6 14 5 12 6.6zM12 6.6v13'],
  pencil: ['M4.5 19.5l1-4.4L16.2 4.4a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.9 18.5z', 'M14 6.6l3.4 3.4'],
  search: [circle(10.5, 10.5, 6.5), 'M15.4 15.4 20.5 20.5'],
  globe: [circle(12, 12, 9), 'M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z'],
  list: ['M9.5 7h10.5M9.5 12h10.5M9.5 17h10.5', dot(5, 7), dot(5, 12), dot(5, 17)],
  mail: [rect(3, 5.5, 18, 13), 'M3.6 7.2 12 13l8.4-5.8'],
  anchor: [circle(12, 5.4, 2.2), 'M12 7.6V20.5M5 13.2a7 7 0 0 0 14 0M8.6 10.6h6.8'],
  shield: ['M12 3l7.5 3v5.6c0 4.4-3.2 7.9-7.5 9.4-4.3-1.5-7.5-5-7.5-9.4V6z'],
  steam: ['M8.2 3.8c-1 1.3 1 2.3 0 3.6M12 3.8c-1 1.3 1 2.3 0 3.6M15.8 3.8c-1 1.3 1 2.3 0 3.6', 'M4 11h16v1.2a8 7.2 0 0 1-16 0z'],
  cap: ['M2.5 9.2 12 4.8l9.5 4.4L12 13.6z', 'M6.5 11.3v4.9c1.5 1.4 3.4 2.2 5.5 2.2s4-.8 5.5-2.2v-4.9', 'M21.5 9.2v5'],
  cup: ['M4.5 9.5h11.5v4.6a5 5 0 0 1-5 5H9.5a5 5 0 0 1-5-5z', 'M16 10.8h1.6a2.4 2.4 0 0 1 0 4.8H16', 'M8.4 3.6c-.8 1.2.8 2 0 3.2M12.2 3.6c-.8 1.2.8 2 0 3.2'],
  tree: ['M12 3.2a5 5 0 0 1 4.7 6.7A3.9 3.9 0 0 1 15.2 17.3H8.8A3.9 3.9 0 0 1 7.3 9.9 5 5 0 0 1 12 3.2z', 'M12 11v9.8M9.4 20.8h5.2'],
  bus: [rect(4.5, 3.5, 15, 14, 3), 'M4.5 11h15M8 20.5v-3M16 20.5v-3', dot(8, 14.3, 1.1), dot(16, 14.3, 1.1)],
  columns: ['M3 9.4 12 4l9 5.4z', 'M5.5 10.4v7.6M9.8 10.4v7.6M14.2 10.4v7.6M18.5 10.4v7.6M3 20.5h18'],
  medal: [circle(12, 9, 5.2), 'M8.6 13 7 21l5-2.6 5 2.6-1.6-8'],
  warning: ['M12 3.6 21.4 20H2.6z', 'M12 10v4.6', dot(12, 17.2, 1.15)],
  hourglass: ['M6.5 3.5h11M6.5 20.5h11', 'M7.6 3.5c0 4.6 8.8 4.6 8.8 8.5s-8.8 3.9-8.8 8.5M16.4 3.5c0 4.6-8.8 4.6-8.8 8.5s8.8 3.9 8.8 8.5'],
  message: ['M4 5.5h16v10.2H10.2l-4.4 3.6v-3.6H4z'],
  swap: ['M6.5 8h11.5l-3-3M17.5 16H6l3 3'],
  flag: ['M5.5 21V4M5.5 4.5H17l-2 3.6 2 3.6H5.5'],
  info: [circle(12, 12, 9), 'M12 11v5.6', dot(12, 7.9, 1.2)],
  spark: ['M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M6 18l2.6-2.6M15.4 8.6 18 6'],
  users: [circle(9, 8.5, 3.4), 'M2.8 19.5a6.2 6.2 0 0 1 12.4 0', 'M15.6 5.4a3.4 3.4 0 0 1 0 6.5M18 13.9a6.2 6.2 0 0 1 3.2 5.6'],
  box: ['M3.5 7.6 12 3.2l8.5 4.4v8.8L12 20.8l-8.5-4.4z', 'M3.5 7.6 12 12l8.5-4.4M12 12v8.8'],
  stop: [rect(6.5, 6.5, 11, 11, 2)],
  coins: [ellipse(9, 6.8, 6, 2.6), 'M3 6.8v4.4c0 1.4 2.7 2.6 6 2.6', 'M15 6.8v3', ellipse(15, 13.2, 6, 2.6), 'M9 13.2v4.4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-4.4'],
  trophy: ['M7.5 4.5h9v4.6a4.5 4.5 0 0 1-9 0z', 'M7.5 6.2H4.8a2.6 2.6 0 0 0 2.9 3.5M16.5 6.2h2.7a2.6 2.6 0 0 1-2.9 3.5', 'M12 13.6v3.4M8.6 20.2h6.8M9.6 17h4.8v3.2H9.6z'],
  external: ['M14 4.5h5.5V10M19.5 4.5 11 13', 'M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4'],
};

/**
 * Builds a line icon. Icons are decorative (aria-hidden); the control around them carries the name.
 * @param {keyof typeof ICONS | string} name
 * @param {{ size?: number, className?: string }} [options]
 * @returns {SVGSVGElement}
 */
export function icon(name, { size = 20, className = '' } = {}) {
  const svg = svgRoot('0 0 24 24', size, size, `hud-icon ${className}`.trim());
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const shape of ICONS[name] ?? ICONS.info) svg.appendChild(shapeNode(shape));
  return svg;
}

/**
 * Status marks: shape and colour both differ, so status never depends on colour alone.
 * working = filled dot with activity bars, waiting = hourglass, idle = hollow ring,
 * error = triangle with "!", done = disc with a tick.
 * The working mark is HTML rather than SVG: its bars animate `transform`, which the compositor
 * runs without repainting, so a busy town costs next to nothing to keep moving.
 * @param {string} status
 * @returns {Element}
 */
export function statusMark(status) {
  if (status === 'working') return workingMark();
  const svg = svgRoot('0 0 16 16', 16, 16, `hud-mark hud-mark--${status}`);
  for (const shape of STATUS_SHAPES[status] ?? STATUS_SHAPES.idle) svg.appendChild(shapeNode(shape));
  return svg;
}

function workingMark() {
  const mark = document.createElement('span');
  mark.className = 'hud-mark hud-mark--working';
  mark.setAttribute('aria-hidden', 'true');
  for (const part of ['dot', 'bar', 'bar', 'bar']) {
    const piece = document.createElement('span');
    piece.className = `hud-mark__${part}`;
    mark.appendChild(piece);
  }
  return mark;
}

/** @type {Record<string, Shape[]>} */
const STATUS_SHAPES = {
  waiting: [
    ['path', { d: 'M3 1.6h10M3 14.4h10', class: 'hud-mark__stroke' }],
    ['path', { d: 'M4.3 2.6h7.4L8 7.6z', class: 'hud-mark__fill' }],
    ['path', { d: 'M8 8.4l3.7 5H4.3z', class: 'hud-mark__fill' }],
  ],
  idle: [['circle', { cx: 8, cy: 8, r: 5.2, class: 'hud-mark__ring' }]],
  error: [
    ['path', { d: 'M8 1.2 15.4 14.4H.6z', class: 'hud-mark__fill' }],
    ['path', { d: 'M8 5.8v4', class: 'hud-mark__cut' }],
    ['circle', { cx: 8, cy: 12, r: 1, class: 'hud-mark__dot' }],
  ],
  done: [
    ['circle', { cx: 8, cy: 8, r: 7, class: 'hud-mark__fill' }],
    ['path', { d: 'M4.8 8.3l2.2 2.2 4.2-4.6', class: 'hud-mark__cut' }],
  ],
};

/** @param {string} viewBox @param {number} width @param {number} height @param {string} className */
function svgRoot(viewBox, width, height, className) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/** @param {Shape} shape */
function shapeNode(shape) {
  const [tag, attrs] = typeof shape === 'string' ? ['path', { d: shape }] : shape;
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** Icons for the town's buildings, used by log rows and the building card. */
export const BUILDING_ICONS = Object.freeze({
  hall: 'columns',
  library: 'book',
  workshop: 'pencil',
  terminal: 'terminal',
  detective: 'search',
  web: 'globe',
  board: 'list',
  post: 'mail',
  harbor: 'anchor',
  permits: 'shield',
  spa: 'steam',
  academy: 'cap',
  cafe: 'cup',
  grove: 'tree',
  station: 'bus',
});
