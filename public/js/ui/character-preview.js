// The "You" dialog's drawings: the live preview and every option tile, a flat front view of the
// character in SVG from the same profile and palettes the 3D figure is built from
// (world/agents/figure-person.js; colours shaded the same way). A tile draws the whole character
// with that option and crops to the part it changes (the head for hair and face, the chest for
// tops…). SVG needs no WebGL, so it works where the 3D town cannot start.
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES } from '../core/profile.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EYE = '#1A1A22';
const MOUTH = '#6B2F2A';
const DARK = '#2D3340';
const GOLD = '#E0B33A';
const WHITE = '#F2F0EA';
const SOLE = '#2A1D15';
const STITCH = '#E8C07A';
/** Hats that cover the crown, as in the 3D figure (figure-person.js COVERING_HATS). */
const COVERING = new Set(['cap', 'beanie', 'beret', 'sunhat', 'wizard', 'hardhat', 'bucket', 'viking', 'tophat', 'chef', 'bandana']);
const LONG_SLEEVES = new Set(['longsleeve', 'hoodie', 'zip', 'denim', 'bomber', 'blazer', 'shirt', 'sweater', 'cardigan', 'labcoat', 'kimono', 'vest']);

/** Crops (viewBox) for the part a tile shows. */
export const CROPS = Object.freeze({
  whole: '-12 -18 144 216',
  head: '18 -6 84 84',
  top: '14 54 92 92',
  bottom: '22 104 76 82',
  feet: '30 150 60 44',
  hand: '0 96 70 56',
  pet: '70 120 64 70',
});

/** @param {string} hex @param {string} to @param {number} t */
function mix(hex, to, t) {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const c = (/** @type {number} */ s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}
/** @param {string} hex @param {number} t */
const darken = (hex, t) => mix(hex, '#000000', t);
/** @param {string} hex @param {number} t */
const lighten = (hex, t) => mix(hex, '#ffffff', t);

/** @typedef {(tag: string, attrs: Record<string, string|number>) => void} Add */
/** @typedef {import('../core/profile.js').PersonLook} Look */
/** @typedef {{ skin: string, hair: string, streak: string|null, shirt: string, pattern: string, pants: string, shoes: string, theme: string }} Colors */

/**
 * The resolved colours of a look, as the 3D figure resolves them (looks.js).
 * @param {Look} l @param {string} theme
 * @returns {Colors}
 */
function colorsOf(l, theme) {
  const cloth = (/** @type {'theme'|number} */ i) => (i === 'theme' ? theme : CLOTH_COLORS[i].hex);
  return {
    skin: SKIN_TONES[l.skin].hex,
    hair: HAIR_COLORS[l.hairColor].hex,
    streak: l.hairStreak === 'none' ? null : HAIR_COLORS[l.hairStreak].hex,
    shirt: cloth(l.topColor),
    pattern: cloth(l.patternColor),
    pants: cloth(l.bottomColor),
    shoes: cloth(l.shoesColor),
    theme,
  };
}

/**
 * @param {Element} parent @param {string} tag @param {Record<string, string|number>} attrs
 */
function append(parent, tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  parent.append(el);
  return el;
}

/**
 * The character as an SVG element.
 * @param {import('../core/profile.js').Profile} profile
 * @param {string} theme  the person's colour (hex)
 * @param {keyof typeof CROPS} [crop]
 * @returns {SVGSVGElement}
 */
export function characterSvg(profile, theme, crop = 'whole') {
  const l = profile.look;
  const c = colorsOf(l, theme);
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
  for (const [name, value] of Object.entries({ viewBox: CROPS[crop], class: 'hud-character__svg', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  /** @type {Add} */
  const add = (tag, attrs) => void append(svg, tag, attrs);
  // Height scales the body about the feet; the build widens the torso.
  const scale = l.height === 'short' ? 0.94 : l.height === 'tall' ? 1.05 : 1;
  const w = l.build === 'slim' ? 0.88 : l.build === 'broad' ? 1.16 : 1;
  const group = append(svg, 'g', { transform: `translate(60 188) scale(${scale}) translate(-60 -188)` });
  /** @type {Add} */
  const g = (tag, attrs) => void append(group, tag, attrs);
  add('ellipse', { cx: 60, cy: 190, rx: 36, ry: 5, fill: 'rgb(0 0 0 / 18%)' });
  behind(g, l, c, w);
  legs(g, l, c);
  feet(g, l, c);
  arms(g, l, c, w);
  torso(g, l, c, w);
  head(g, l, c);
  hat(g, l.hat, theme);
  front(g, l, c, w);
  pet(add, l.pet, theme);
  return svg;
}

/**
 * Draws a profile into a container (its previous drawing is replaced).
 * @param {HTMLElement} container
 * @param {import('../core/profile.js').Profile} profile
 * @param {string} theme
 * @param {keyof typeof CROPS} [crop]
 */
export function drawPreview(container, profile, theme, crop = 'whole') {
  container.replaceChildren(characterSvg(profile, theme, crop));
}

/** Capes, wings, backpacks and long hair: behind the body. @param {Add} g @param {Look} l @param {Colors} c @param {number} w */
function behind(g, l, c, w) {
  if (l.extra === 'cape') g('path', { d: `M${60 - 22 * w} 78 L${60 + 22 * w} 78 L${60 + 32 * w} 162 L${60 - 32 * w} 162 Z`, fill: darken(c.theme, 0.15) });
  if (l.extra === 'wings') for (const s of [-1, 1]) g('ellipse', { cx: 60 + s * 34, cy: 92, rx: 13, ry: 30, fill: '#FFFFFF', stroke: '#D8DEE6', transform: `rotate(${s * 25} ${60 + s * 34} 92)` });
  if (l.extra === 'backpack') g('rect', { x: 34, y: 82, width: 52, height: 48, rx: 8, fill: c.theme });
  if (l.top === 'hoodie') g('ellipse', { cx: 60, cy: 76, rx: 24 * w, ry: 10, fill: darken(c.shirt, 0.18) });
  if (l.hair === 'straight' || l.hair === 'wavy') g('rect', { x: 33, y: 34, width: 54, height: 46, rx: 14, fill: c.hair });
  if (l.hair === 'ponytail') g('path', { d: 'M78 30 Q98 40 90 72 Q84 54 74 40 Z', fill: c.streak ?? c.hair });
  if (l.hair === 'afro' && !COVERING.has(l.hat)) g('circle', { cx: 60, cy: 36, r: 36, fill: c.hair });
}

/** @param {Add} g @param {Look} l @param {Colors} c */
function legs(g, l, c) {
  const covered = !['shorts', 'skirt', 'longskirt'].includes(l.bottom);
  for (const x of [44, 64]) {
    g('rect', { x: x + (covered ? 0 : 1), y: covered ? 122 : 138, width: covered ? 12 : 10, height: covered ? 56 : 40, rx: 4, fill: covered ? c.pants : c.skin });
    const outer = x < 60 ? x + 1 : x + 10;
    if (l.bottom === 'shorts') g('rect', { x, y: 122, width: 12, height: 24, rx: 4, fill: c.pants });
    if (l.bottom === 'jeans') g('rect', { x: outer, y: 124, width: 1.2, height: 52, fill: STITCH });
    if (l.bottom === 'cargo') g('rect', { x: x < 60 ? x - 2 : x + 8, y: 138, width: 6, height: 12, rx: 1.5, fill: darken(c.pants, 0.15) });
    if (l.bottom === 'joggers') {
      g('rect', { x, y: 166, width: 12, height: 5, rx: 2, fill: darken(c.pants, 0.2) });
      g('rect', { x: outer, y: 124, width: 1.4, height: 40, fill: WHITE });
    }
  }
  if (l.bottom === 'skirt') g('path', { d: 'M40 120 L80 120 L88 152 L32 152 Z', fill: c.pants });
  else if (l.bottom === 'longskirt') g('path', { d: 'M40 118 L80 118 L92 176 L28 176 Z', fill: c.pants });
  else g('rect', { x: 42, y: 118, width: 36, height: 12, rx: 4, fill: c.pants });
  if (l.bottom === 'jeans') g('circle', { cx: 72, cy: 124, r: 1.4, fill: GOLD });
}

/** @param {Add} g @param {Look} l @param {Colors} c */
function feet(g, l, c) {
  for (const x of [42, 62]) {
    if (l.shoes === 'sandals') {
      g('rect', { x: x + 1, y: 176, width: 15, height: 6, rx: 3, fill: c.skin });
      g('rect', { x: x + 1, y: 177, width: 15, height: 2, fill: c.shoes });
      g('rect', { x, y: 182, width: 17, height: 3, rx: 1, fill: c.shoes });
    } else if (l.shoes === 'boots') {
      g('rect', { x, y: 166, width: 17, height: 17, rx: 4, fill: c.shoes });
      g('rect', { x, y: 168, width: 17, height: 2.5, fill: darken(c.shoes, 0.25) });
      g('rect', { x, y: 182, width: 17, height: 3, rx: 1, fill: SOLE });
    } else if (l.shoes === 'loafers') {
      g('rect', { x, y: 176, width: 17, height: 8, rx: 4, fill: c.shoes });
      g('rect', { x: x + 5, y: 177, width: 7, height: 2, fill: GOLD });
    } else if (l.shoes === 'slippers') {
      g('rect', { x: x - 1, y: 175, width: 19, height: 10, rx: 5, fill: c.shoes });
      g('circle', { cx: x + 8.5, cy: 177, r: 3, fill: lighten(c.shoes, 0.35) });
    } else {
      const high = l.shoes === 'hightops';
      g('rect', { x, y: high ? 168 : 175, width: 17, height: high ? 15 : 8, rx: 4, fill: c.shoes });
      g('rect', { x, y: 182, width: 17, height: 3, rx: 1, fill: WHITE });
      g('rect', { x: x + 5, y: high ? 170 : 176, width: 7, height: 2, fill: WHITE });
    }
  }
}

/** @param {Add} g @param {Look} l @param {Colors} c @param {number} w */
function arms(g, l, c, w) {
  const sleeve = l.top === 'tank' ? c.skin : l.top === 'vest' ? WHITE : l.top === 'overalls' ? c.pattern : c.shirt;
  const long = LONG_SLEEVES.has(l.top);
  const wide = l.top === 'kimono' ? 4 : 0;
  for (const side of [-1, 1]) {
    const x = 60 + side * 28 * w - 6 - wide / 2;
    g('rect', { x, y: 80, width: 12 + wide, height: long ? 46 : 22, rx: 6, fill: sleeve });
    if (!long) g('rect', { x: x + 1, y: 100, width: 10, height: 26, rx: 5, fill: c.skin });
    else if (l.top !== 'kimono') g('rect', { x, y: 120, width: 12 + wide, height: 4, rx: 2, fill: darken(sleeve, 0.15) });
    g('circle', { cx: x + 6 + wide / 2, cy: 130, r: 6, fill: c.skin });
  }
  if (l.extra === 'watch') g('rect', { x: 60 + 28 * w - 7, y: 118, width: 14, height: 5, rx: 1, fill: DARK });
  if (l.hand === 'laptop') {
    g('rect', { x: 8, y: 122, width: 30, height: 20, rx: 2, fill: '#9AA3AD' });
    g('circle', { cx: 23, cy: 132, r: 2, fill: c.theme });
  } else if (l.hand === 'coffee') {
    g('rect', { x: 24, y: 124, width: 10, height: 13, rx: 2, fill: WHITE });
    g('rect', { x: 24, y: 128, width: 10, height: 4, fill: c.theme });
  } else if (l.hand === 'book') {
    g('rect', { x: 20, y: 120, width: 16, height: 20, rx: 2, fill: c.theme });
    g('rect', { x: 22, y: 122, width: 12, height: 16, fill: WHITE });
  }
}

/** @param {Add} g @param {Look} l @param {Colors} c @param {number} w */
function torso(g, l, c, w) {
  const x = 60 - 24 * w;
  const width = 48 * w;
  const under = l.top === 'vest' ? WHITE : l.top === 'overalls' ? c.pattern : c.shirt;
  g('rect', { x, y: 76, width, height: 52, rx: 12, fill: under });
  if (l.top === 'tank') g('rect', { x: 60 - 15 * w, y: 76, width: 30 * w, height: 10, rx: 4, fill: c.skin });
  if (l.top === 'dress' || l.top === 'kimono' || l.top === 'labcoat') g('path', { d: `M${x + 2} 118 L${x + width - 2} 118 L${x + width + 8} 152 L${x - 8} 152 Z`, fill: c.shirt });
  if (l.top === 'overalls') {
    g('rect', { x: 60 - 15 * w, y: 96, width: 30 * w, height: 32, rx: 3, fill: c.shirt });
    for (const s of [-1, 1]) g('rect', { x: 60 + s * 12 * w - 3, y: 76, width: 6, height: 22, fill: c.shirt });
    g('rect', { x: 54, y: 104, width: 12, height: 8, rx: 1, fill: darken(c.shirt, 0.12) });
    if (l.topPattern === 'emblem') g('circle', { cx: 60, cy: 102, r: 3.5, fill: c.pattern });
    return;
  }
  if (l.top === 'vest') {
    for (const s of [-1, 1]) g('rect', { x: s < 0 ? x : 62, y: 80, width: width / 2 - 2, height: 46, rx: 4, fill: c.shirt });
    for (const y of [98, 106, 114]) g('circle', { cx: 63, cy: y, r: 1.4, fill: DARK });
    return;
  }
  pattern(g, l, c, w);
  topDetails(g, l, c, w);
  if (!['dress', 'kimono', 'labcoat', 'tank'].includes(l.top)) g('rect', { x: x + 1, y: 122, width: width - 2, height: 6, rx: 2, fill: darken(c.pants, 0.3) });
}

/** @param {Add} g @param {Look} l @param {Colors} c @param {number} w */
function pattern(g, l, c, w) {
  const p = c.pattern;
  if (l.topPattern === 'stripes') for (const y of [92, 102, 112]) g('rect', { x: 60 - 24 * w, y, width: 48 * w, height: 3.5, fill: p });
  else if (l.topPattern === 'checks') for (const [dx, y] of [[-12, 90], [12, 90], [0, 102], [-12, 114], [12, 114]]) g('rect', { x: 60 + dx * w - 4, y, width: 8, height: 8, fill: p });
  else if (l.topPattern === 'dots') for (const [dx, y] of [[-12, 110], [9, 104], [-4, 94], [13, 90], [-15, 88]]) g('circle', { cx: 60 + dx * w, cy: y, r: 2.2, fill: p });
  else if (l.topPattern === 'emblem') {
    g('circle', { cx: 60 + 11 * w, cy: 92, r: 5.5, fill: p });
    g('circle', { cx: 60 + 11 * w, cy: 92, r: 2, fill: darken(p, 0.35) });
  }
}

/** @type {Record<string, (g: Add, l: Look, c: Colors, w: number) => void>} */
const TOP_DETAILS = {
  tee: (g, l, c) => g('path', { d: 'M52 76 Q60 84 68 76', fill: 'none', stroke: darken(c.shirt, 0.15), 'stroke-width': 2 }),
  longsleeve: (g, l, c) => g('path', { d: 'M52 76 Q60 84 68 76', fill: 'none', stroke: darken(c.shirt, 0.15), 'stroke-width': 2 }),
  hoodie(g, l, c, w) {
    g('rect', { x: 60 - 13 * w, y: 106, width: 26 * w, height: 11, rx: 4, fill: darken(c.shirt, 0.18) });
    for (const x of [55, 64]) g('rect', { x, y: 80, width: 1.6, height: 12, fill: WHITE });
  },
  zip(g, l, c) {
    g('rect', { x: 59, y: 78, width: 2, height: 50, fill: '#C9CED6' });
    g('rect', { x: 48, y: 72, width: 24, height: 7, rx: 3, fill: darken(c.shirt, 0.15) });
  },
  bomber(g, l, c, w) {
    const trim = darken(c.shirt, 0.25);
    g('rect', { x: 59, y: 78, width: 2, height: 44, fill: '#C9CED6' });
    g('rect', { x: 48, y: 72, width: 24, height: 7, rx: 3, fill: trim });
    g('rect', { x: 60 - 24 * w, y: 120, width: 48 * w, height: 7, rx: 3, fill: trim });
  },
  denim(g, l, c, w) {
    for (const s of [-1, 1]) g('rect', { x: 60 + s * 11 * w - 5, y: 88, width: 10, height: 7, rx: 1, fill: darken(c.shirt, 0.12) });
    for (const s of [-1, 1]) g('rect', { x: 60 + s * 5 * w, y: 80, width: 1, height: 40, fill: STITCH });
    g('path', { d: 'M48 76 L58 76 L56 88 Z M72 76 L62 76 L64 88 Z', fill: darken(c.shirt, 0.2) });
  },
  blazer(g, l, c) {
    g('path', { d: 'M54 76 L66 76 L60 100 Z', fill: WHITE });
    g('path', { d: 'M50 76 L56 76 L60 102 L54 96 Z M70 76 L64 76 L60 102 L66 96 Z', fill: darken(c.shirt, 0.2) });
    for (const y of [108, 114]) g('circle', { cx: 60, cy: y, r: 1.4, fill: DARK });
  },
  labcoat(g, l, c) {
    g('path', { d: 'M54 76 L66 76 L60 100 Z', fill: WHITE });
    g('path', { d: 'M50 76 L56 76 L60 102 L54 96 Z M70 76 L64 76 L60 102 L66 96 Z', fill: darken(c.shirt, 0.08) });
    g('rect', { x: 70, y: 90, width: 1.4, height: 8, fill: '#3B5BDB' });
  },
  shirt(g, l, c) {
    g('path', { d: 'M50 74 L60 80 L54 86 Z M70 74 L60 80 L66 86 Z', fill: lighten(c.shirt, 0.15) });
    for (const y of [92, 102, 112]) g('circle', { cx: 60, cy: y, r: 1.3, fill: WHITE });
  },
  polo(g, l, c) {
    g('path', { d: 'M50 74 L60 80 L54 86 Z M70 74 L60 80 L66 86 Z', fill: darken(c.shirt, 0.15) });
    g('rect', { x: 58, y: 80, width: 4, height: 10, fill: darken(c.shirt, 0.1) });
  },
  sweater(g, l, c, w) {
    const trim = darken(c.shirt, 0.15);
    g('rect', { x: 50, y: 74, width: 20, height: 6, rx: 3, fill: trim });
    g('rect', { x: 60 - 24 * w, y: 120, width: 48 * w, height: 6, rx: 3, fill: trim });
  },
  cardigan(g, l, c) {
    g('rect', { x: 56, y: 78, width: 8, height: 48, fill: lighten(c.shirt, 0.3) });
    for (const y of [92, 102, 112]) g('circle', { cx: 65, cy: y, r: 1.5, fill: DARK });
  },
  dress: (g, l, c, w) => g('rect', { x: 60 - 24 * w, y: 114, width: 48 * w, height: 5, fill: c.pattern }),
  kimono(g, l, c, w) {
    g('rect', { x: 60 - 24 * w, y: 110, width: 48 * w, height: 10, rx: 3, fill: c.pattern });
    g('path', { d: 'M52 76 L68 108 L64 108 L50 80 Z', fill: darken(c.shirt, 0.25) });
  },
};

/** @param {Add} g @param {Look} l @param {Colors} c @param {number} w */
function topDetails(g, l, c, w) {
  TOP_DETAILS[l.top]?.(g, l, c, w);
}

/** @param {Add} g @param {Look} l @param {Colors} c */
function head(g, l, c) {
  g('rect', { x: 54, y: 66, width: 12, height: 12, fill: c.skin });
  g('circle', { cx: 60, cy: 44, r: 25, fill: c.skin });
  for (const cx of [35, 85]) g('circle', { cx, cy: 46, r: 5, fill: c.skin });
  if (l.earrings === 'studs') for (const cx of [34, 86]) g('circle', { cx, cy: 52, r: 1.8, fill: GOLD });
  if (l.earrings === 'hoops') for (const cx of [34, 86]) g('circle', { cx, cy: 55, r: 3.5, fill: 'none', stroke: GOLD, 'stroke-width': 1.2 });
  hair(g, l, c);
  eyes(g, l.eyes);
  if (l.brows !== 'none') {
    const width = l.brows === 'thick' ? 3 : 1.6;
    for (const [x1, x2] of [[45, 56], [64, 75]]) g('path', { d: l.brows === 'arched' ? `M${x1} 39 Q${(x1 + x2) / 2} 34 ${x2} 39` : `M${x1} 38 L${x2} 38`, fill: 'none', stroke: darken(c.hair, 0.1), 'stroke-width': width, 'stroke-linecap': 'round' });
  }
  mouth(g, l.mouth);
  if (l.cheeks === 'blush' || l.cheeks === 'both') for (const cx of [44, 76]) g('ellipse', { cx, cy: 53, rx: 4, ry: 2.4, fill: mix(c.skin, '#F27C7C', 0.5) });
  if (l.cheeks === 'freckles' || l.cheeks === 'both') for (const [cx, cy] of [[44, 50], [47, 53], [42, 54], [76, 50], [73, 53], [78, 54]]) g('circle', { cx, cy, r: 1.1, fill: darken(c.skin, 0.28) });
  facialHair(g, l.facialHair, c.hair);
  glasses(g, l.glasses, c.theme);
}

/** @type {Record<string, (g: Add, c: Colors, tips: string, covered: boolean) => void>} */
const HAIR = {
  short(g, c, tips, covered) {
    if (!covered) g('path', { d: 'M40 30 Q52 16 70 22 Q62 26 52 28 Z', fill: tips });
  },
  side(g, c, tips, covered) {
    if (covered) return;
    g('path', { d: 'M36 40 Q40 18 70 20 Q80 24 84 34 Q66 24 44 38 Z', fill: c.hair });
    g('path', { d: 'M66 20 L68 30', stroke: darken(c.hair, 0.35), 'stroke-width': 1.4 });
    g('circle', { cx: 78, cy: 28, r: 4, fill: tips });
  },
  quiff(g, c, tips, covered) {
    if (!covered) g('path', { d: 'M44 26 Q56 4 78 16 Q70 22 60 28 Z', fill: tips });
  },
  spiky(g, c, tips, covered) {
    if (!covered) g('path', { d: 'M38 30 L42 12 L50 26 L56 6 L62 24 L70 8 L74 26 L82 14 L82 32 Z', fill: tips });
  },
  straight(g, c, tips) {
    for (const x of [33, 79]) g('rect', { x, y: 40, width: 8, height: 34, rx: 3, fill: tips });
  },
  wavy(g, c, tips) {
    for (const [x, y] of [[33, 60], [87, 60], [36, 72], [84, 72]]) g('circle', { cx: x, cy: y, r: 7, fill: y > 65 ? tips : c.hair });
  },
  ponytail(g, c) {
    g('rect', { x: 74, y: 28, width: 5, height: 5, rx: 2, fill: lighten(c.hair, 0.4) });
  },
  pigtails(g, c, tips) {
    for (const s of [-1, 1]) g('ellipse', { cx: 60 + s * 32, cy: 54, rx: 6, ry: 14, fill: tips, transform: `rotate(${s * -20} ${60 + s * 32} 54)` });
  },
  bun(g, c, tips, covered) {
    if (!covered) g('circle', { cx: 60, cy: 14, r: 9, fill: tips });
  },
  braids(g, c, tips) {
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) g('circle', { cx: 60 + s * 24, cy: 52 + k * 7, r: 4.5, fill: k === 3 ? tips : c.hair });
  },
  curly(g, c, tips, covered) {
    if (covered) return;
    for (const [cx, cy] of [[42, 24], [52, 18], [64, 17], [76, 22], [84, 32], [36, 32]]) g('circle', { cx, cy, r: 7, fill: cy < 20 ? tips : c.hair });
  },
  mohawk(g, c, tips, covered) {
    if (!covered) g('rect', { x: 55, y: 4, width: 10, height: 24, rx: 4, fill: tips });
  },
};

/** @param {Add} g @param {Look} l @param {Colors} c */
function hair(g, l, c) {
  const covered = COVERING.has(l.hat);
  if (l.hair === 'bald') return;
  if (l.hair === 'buzz') {
    g('path', { d: 'M36 40 A25 25 0 0 1 84 40 Q60 30 36 40 Z', fill: c.hair });
    return;
  }
  g('path', { d: 'M35 44 A25 25 0 0 1 85 44 Q74 30 60 32 Q44 32 35 44 Z', fill: c.hair });
  if (c.streak && !covered) g('path', { d: 'M62 21 Q70 24 72 34 L68 34 Q66 26 60 23 Z', fill: c.streak });
  HAIR[l.hair]?.(g, c, c.streak ?? c.hair, covered);
}

/** @param {Add} g @param {string} kind */
function eyes(g, kind) {
  for (const cx of [51, 69]) {
    if (kind === 'happy' || (kind === 'wink' && cx === 51)) g('path', { d: `M${cx - 4} 48 Q${cx} 42 ${cx + 4} 48`, fill: 'none', stroke: EYE, 'stroke-width': 2.2, 'stroke-linecap': 'round' });
    else if (kind === 'round') {
      g('circle', { cx, cy: 46, r: 5, fill: '#FFFFFF' });
      g('circle', { cx, cy: 46.5, r: 2.8, fill: EYE });
    } else if (kind === 'sleepy') {
      g('path', { d: `M${cx - 4} 46 L${cx + 4} 46`, stroke: EYE, 'stroke-width': 1.6 });
      g('path', { d: `M${cx - 3.5} 46 Q${cx} 50 ${cx + 3.5} 46 Z`, fill: EYE });
    } else {
      g('ellipse', { cx, cy: 46, rx: 2.6, ry: 3.2, fill: EYE });
      if (kind === 'lashes') g('path', { d: `M${cx + (cx < 60 ? -3 : 3)} 43 l${cx < 60 ? -3 : 3} -3`, stroke: EYE, 'stroke-width': 1.3 });
    }
  }
}

/** @param {Add} g @param {string} kind */
function mouth(g, kind) {
  if (kind === 'grin') g('path', { d: 'M53 55 Q60 63 67 55 Z', fill: '#FFFFFF', stroke: MOUTH, 'stroke-width': 1.6 });
  else if (kind === 'neutral') g('path', { d: 'M55 57 L65 57', stroke: MOUTH, 'stroke-width': 2, 'stroke-linecap': 'round' });
  else if (kind === 'open') g('ellipse', { cx: 60, cy: 57, rx: 3.6, ry: 3, fill: MOUTH });
  else g('path', { d: 'M54 56 Q60 61 66 56', fill: 'none', stroke: MOUTH, 'stroke-width': 2, 'stroke-linecap': 'round' });
}

/** @param {Add} g @param {string} kind @param {string} color */
function facialHair(g, kind, color) {
  if (kind === 'stubble') g('path', { d: 'M38 52 Q40 70 60 70 Q80 70 82 52 Q74 62 60 62 Q46 62 38 52 Z', fill: mix(color, '#C89A7A', 0.55) });
  if (kind === 'beard') g('path', { d: 'M38 50 Q40 74 60 74 Q80 74 82 50 Q74 64 60 64 Q46 64 38 50 Z', fill: color });
  if (kind === 'goatee') g('path', { d: 'M56 62 L64 62 L60 72 Z', fill: color });
  if (kind === 'moustache' || kind === 'goatee' || kind === 'beard') g('path', { d: 'M51 55 Q60 50 69 55 Q60 54 51 55 Z', fill: color, stroke: color, 'stroke-width': 2 });
}

/** @param {Add} g @param {string} kind @param {string} theme */
function glasses(g, kind, theme) {
  if (kind === 'none') return;
  const frame = kind === 'goggles' ? '#5B4A3A' : kind === 'sunglasses' ? '#111114' : DARK;
  if (kind === 'goggles') g('rect', { x: 34, y: 42, width: 52, height: 4, fill: frame });
  for (const cx of [51, 69]) {
    if (kind === 'square' || kind === 'sunglasses') g('rect', { x: cx - 7, y: 41, width: 14, height: 10, rx: 2, fill: kind === 'sunglasses' ? '#24242A' : 'none', stroke: frame, 'stroke-width': 2 });
    else g('circle', { cx, cy: 46, r: kind === 'goggles' ? 8 : 7, fill: kind === 'goggles' ? mix(theme, '#9EE6FF', 0.6) : 'none', stroke: frame, 'stroke-width': kind === 'goggles' ? 3 : 2 });
  }
  g('path', { d: 'M58 46 L62 46', stroke: frame, 'stroke-width': 2 });
}

/** @type {Record<string, (g: Add, color: string) => void>} */
const HATS = {
  cap(g, color) {
    g('path', { d: 'M35 36 A25 22 0 0 1 85 36 Z', fill: lighten(color, 0.18) });
    g('path', { d: 'M58 36 L92 36 Q90 41 58 40 Z', fill: darken(color, 0.25) });
  },
  beanie(g, color) {
    g('path', { d: 'M35 38 A25 26 0 0 1 85 38 Z', fill: color });
    g('rect', { x: 34, y: 33, width: 52, height: 8, rx: 3, fill: darken(color, 0.22) });
    g('circle', { cx: 60, cy: 11, r: 5, fill: WHITE });
  },
  beret: (g) => g('ellipse', { cx: 64, cy: 24, rx: 27, ry: 9, fill: '#8E2236', transform: 'rotate(-8 64 24)' }),
  sunhat(g, color) {
    g('ellipse', { cx: 60, cy: 30, rx: 40, ry: 6, fill: '#E9CD84' });
    g('path', { d: 'M42 30 Q42 12 60 12 Q78 12 78 30 Z', fill: '#E3C277' });
    g('rect', { x: 42, y: 25, width: 36, height: 5, fill: color });
  },
  wizard(g) {
    g('ellipse', { cx: 60, cy: 26, rx: 32, ry: 5, fill: '#4C3A9E' });
    g('path', { d: 'M42 26 L64 -14 L78 26 Z', fill: '#4C3A9E' });
    g('circle', { cx: 60, cy: 12, r: 2.5, fill: '#FFD54A' });
  },
  crown(g) {
    g('path', { d: 'M42 26 L42 12 L51 20 L60 8 L69 20 L78 12 L78 26 Z', fill: '#F4C430' });
    g('circle', { cx: 60, cy: 20, r: 2.4, fill: '#E0245E' });
  },
  hardhat(g) {
    g('path', { d: 'M36 32 A24 22 0 0 1 84 32 Z', fill: '#FFC21A' });
    g('rect', { x: 30, y: 30, width: 60, height: 5, rx: 2, fill: '#EBAA00' });
  },
  bucket(g, color) {
    g('path', { d: 'M40 30 L44 12 Q60 8 76 12 L80 30 Z', fill: color });
    g('ellipse', { cx: 60, cy: 31, rx: 34, ry: 5, fill: darken(color, 0.18) });
  },
  headband: (g, color) => g('rect', { x: 35, y: 30, width: 50, height: 6, rx: 3, fill: color }),
  bandana(g, color) {
    g('path', { d: 'M35 38 A25 22 0 0 1 85 38 Z', fill: color });
    for (const [cx, cy] of [[48, 28], [62, 22], [74, 30]]) g('circle', { cx, cy, r: 1.6, fill: WHITE });
  },
  flowers(g) {
    ['#FF6B8B', '#FFD54A', '#FFFFFF', '#B987FF', '#FF9F43', '#FF6B8B'].forEach((fill, k) => g('circle', { cx: 37 + k * 9, cy: 24 + Math.abs(2.5 - k) * 2, r: 4.5, fill }));
  },
  viking(g) {
    g('path', { d: 'M35 34 A25 24 0 0 1 85 34 Z', fill: '#9AA3AD' });
    g('rect', { x: 34, y: 30, width: 52, height: 5, fill: '#C9944A' });
    g('path', { d: 'M36 28 Q22 22 24 6 Q30 18 40 22 Z M84 28 Q98 22 96 6 Q90 18 80 22 Z', fill: '#F2EAD8' });
  },
  tophat(g, color) {
    g('ellipse', { cx: 60, cy: 26, rx: 32, ry: 5, fill: '#1E1E22' });
    g('rect', { x: 44, y: -8, width: 32, height: 34, fill: '#1E1E22' });
    g('rect', { x: 44, y: 18, width: 32, height: 5, fill: color });
  },
  chef(g) {
    g('rect', { x: 42, y: 14, width: 36, height: 16, fill: '#FFFFFF', stroke: '#DADDE2' });
    for (const cx of [46, 60, 74]) g('circle', { cx, cy: 8, r: 10, fill: '#FFFFFF', stroke: '#DADDE2' });
  },
  halo: (g) => g('ellipse', { cx: 60, cy: 6, rx: 18, ry: 4, fill: 'none', stroke: '#FFE58A', 'stroke-width': 3 }),
};

/** @param {Add} g @param {string} kind @param {string} color */
function hat(g, kind, color) {
  HATS[kind]?.(g, color);
}

/** Scarves, ties, necklaces and headphones: in front. @param {Add} g @param {Look} l @param {Colors} c @param {number} w */
function front(g, l, c, w) {
  const color = c.theme;
  const draw = {
    scarf() {
      g('rect', { x: 44, y: 72, width: 32, height: 9, rx: 4, fill: color });
      g('rect', { x: 62, y: 76, width: 8, height: 24, rx: 3, fill: lighten(color, 0.15) });
    },
    headphones() {
      g('path', { d: 'M32 46 A28 28 0 0 1 88 46', fill: 'none', stroke: DARK, 'stroke-width': 4 });
      for (const cx of [32, 88]) g('rect', { x: cx - 5, y: 40, width: 10, height: 16, rx: 4, fill: color });
    },
    tie: () => g('path', { d: 'M57 78 L63 78 L62 82 L64 104 L60 108 L56 104 L58 82 Z', fill: color }),
    bowtie: () => g('path', { d: 'M52 76 L60 80 L52 84 Z M68 76 L60 80 L68 84 Z', fill: color }),
    necklace() {
      g('path', { d: 'M50 78 Q60 92 70 78', fill: 'none', stroke: GOLD, 'stroke-width': 1.4 });
      g('circle', { cx: 60, cy: 88, r: 2.6, fill: color });
    },
    satchel() {
      g('path', { d: `M${60 - 20 * w} 78 L${60 + 24 * w} 118`, stroke: '#5A3A1E', 'stroke-width': 3 });
      g('rect', { x: 60 + 20 * w, y: 112, width: 14, height: 16, rx: 3, fill: color });
    },
    backpack() {
      for (const s of [-1, 1]) g('rect', { x: 60 + s * 13 * w - 2, y: 78, width: 4, height: 40, fill: '#5A3A1E' });
    },
  };
  /** @type {Record<string, () => void>} */ (draw)[l.extra]?.();
}

/** A pet at the left heel, or a bird on the shoulder. @param {Add} add @param {string} kind @param {string} theme */
function pet(add, kind, theme) {
  if (kind === 'bird') {
    add('ellipse', { cx: 88, cy: 74, rx: 7, ry: 6, fill: '#F2C230' });
    add('path', { d: 'M94 73 L99 75 L94 76 Z', fill: '#E0742A' });
    add('circle', { cx: 91, cy: 72, r: 1, fill: EYE });
    return;
  }
  if (kind === 'none') return;
  const fur = kind === 'cat' ? '#8C8F96' : '#A86B3C';
  add('rect', { x: 92, y: 166, width: 26, height: 12, rx: 5, fill: fur });
  for (const x of [94, 111]) add('rect', { x, y: 174, width: 4, height: 12, rx: 1.5, fill: darken(fur, 0.15) });
  add('circle', { cx: 94, cy: 160, r: 9, fill: fur });
  if (kind === 'cat') add('path', { d: 'M87 154 L89 145 L93 152 Z M101 154 L99 145 L95 152 Z', fill: darken(fur, 0.2) });
  else for (const cx of [87, 101]) add('ellipse', { cx, cy: 158, rx: 3, ry: 6, fill: darken(fur, 0.2) });
  add('path', { d: kind === 'cat' ? 'M118 168 Q126 156 122 148' : 'M118 168 Q124 162 126 160', fill: 'none', stroke: fur, 'stroke-width': 3, 'stroke-linecap': 'round' });
  for (const cx of [91, 97]) add('circle', { cx, cy: 159, r: 1.2, fill: EYE });
  add('rect', { x: 88, y: 166, width: 12, height: 2.5, fill: theme });
}
