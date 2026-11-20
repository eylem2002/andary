// Theme and motion. The HUD is light by day and dark at night: "auto" follows the town's clock
// (or an explicit day/night choice) and otherwise the system preference; an explicit light/dark
// choice in Settings always wins. Reduced motion follows the system unless overridden.

/** @typedef {import('./prefs.js').Prefs} Prefs */
/** @typedef {import('./types.js').World} World */

const DAY_HOUR = 13;
/** Golden hour turning pink, with the first neon on. */
const SUNSET_HOUR = 18;
const NIGHT_HOUR = 22;

/**
 * The world's time of day for a time mode.
 * @param {Prefs['timeMode']} mode
 * @returns {number|'auto'}
 */
export function timeOfDayFor(mode) {
  if (mode === 'day') return DAY_HOUR;
  if (mode === 'sunset') return SUNSET_HOUR;
  if (mode === 'night') return NIGHT_HOUR;
  return 'auto';
}

/** @param {number} hour 0–24 */
export function isNightHour(hour) {
  return hour >= 19.5 || hour < 6;
}

/**
 * The theme to force on the document, or null to follow `prefers-color-scheme`.
 * @param {Pick<Prefs, 'theme'|'timeMode'>} prefs
 * @param {number} hour  the town's current hour
 * @returns {'light'|'dark'|null}
 */
export function resolveTheme(prefs, hour) {
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
  if (prefs.timeMode === 'night') return 'dark';
  if (prefs.timeMode === 'day' || prefs.timeMode === 'sunset') return null;
  return isNightHour(hour) ? 'dark' : null;
}

/**
 * @param {Pick<Prefs, 'motion'>} prefs
 * @param {boolean} systemReduce
 */
export function resolveReducedMotion(prefs, systemReduce) {
  if (prefs.motion === 'reduce') return true;
  if (prefs.motion === 'full') return false;
  return systemReduce;
}

/** @param {Prefs} prefs @param {World|null} world */
export function applyTheme(prefs, world) {
  const now = new Date();
  const hour = world?.getTimeOfDay?.() ?? now.getHours() + now.getMinutes() / 60;
  const theme = resolveTheme(prefs, hour);
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** Whether motion is reduced right now, as last applied by applyMotion (Settings or the system). */
export function motionReduced() {
  return document.documentElement.dataset.motion === 'reduce';
}

/** @param {Prefs} prefs @param {World|null} world */
export function applyMotion(prefs, world) {
  const reduce = resolveReducedMotion(prefs, matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
  world?.setReducedMotion(reduce);
}
