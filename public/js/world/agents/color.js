// Colour helpers for crew colours: parsing, mixing, and keeping white name-pill text at WCAG AA
// contrast whatever colour a crew is given. Pure, unit-tested.

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * @param {unknown} hex "#rgb" or "#rrggbb"
 * @returns {[number, number, number]|null} 0..255 channels
 */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1];
  return /** @type {[number, number, number]} */ ([0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)));
}

/** @param {number[]} rgb */
export function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** @param {unknown} hex @param {string} fallback */
export function safeColor(hex, fallback) {
  const rgb = parseHex(hex);
  return rgb ? toHex(rgb) : fallback;
}

/** WCAG relative luminance. @param {number[]} rgb */
export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} a @param {string} b */
export function contrastRatio(a, b) {
  const la = relativeLuminance(parseHex(a) ?? [0, 0, 0]);
  const lb = relativeLuminance(parseHex(b) ?? [0, 0, 0]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Linear mix of two colours in sRGB space. @param {string} a @param {string} b @param {number} t */
export function mix(a, b, t) {
  const ca = parseHex(a) ?? [0, 0, 0];
  const cb = parseHex(b) ?? [0, 0, 0];
  return toHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

/** @param {string} hex @param {number} t 0..1 */
export function lighten(hex, t) {
  return mix(hex, '#ffffff', t);
}

/** @param {string} hex @param {number} t 0..1 */
export function darken(hex, t) {
  return mix(hex, '#000000', t);
}

/**
 * Darkens a colour just enough for white text on it to reach `minRatio`.
 * @param {string} hex
 * @param {number} [minRatio]
 */
export function ensureContrastWithWhite(hex, minRatio = 4.5) {
  let color = safeColor(hex, '#2457d6');
  for (let i = 0; i < 20 && contrastRatio(color, '#ffffff') < minRatio; i++) {
    color = darken(color, 0.08);
  }
  return color;
}
