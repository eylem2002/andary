// Formatting rules for the place labels on the buildings (env/signs.js). Pure, unit-tested.

const MAX_STAT = 22;

/**
 * Normalises a stat chip text: trims, collapses whitespace, strips control characters and caps
 * the length so a chip never outgrows its label. Empty → null (no chip).
 * @param {unknown} text
 * @returns {string|null}
 */
export function formatStat(text) {
  if (text == null) return null;
  const raw = typeof text === 'number' ? String(text) : typeof text === 'string' ? text : '';
  let clean = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    clean += code < 32 || (code >= 127 && code < 160) ? ' ' : ch;
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const chars = Array.from(clean);
  return chars.length > MAX_STAT ? `${chars.slice(0, MAX_STAT - 1).join('').trimEnd()}…` : clean;
}

/**
 * Sign scale for a camera zoom (1 = whole town in view): signs grow a little when zooming in so
 * they stay proportionate, but never become unreadably small or huge.
 * @param {number} zoom
 */
export function signScale(zoom) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(1.25, Math.max(0.88, 0.94 + 0.14 * Math.log2(z)));
}

/**
 * Accessible-style label text for a sign, e.g. "Library, 42 reads".
 * @param {string} name
 * @param {string|null} stat
 */
export function signLabel(name, stat) {
  return stat ? `${name}, ${stat}` : name;
}
