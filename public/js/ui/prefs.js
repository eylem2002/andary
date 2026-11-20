// Viewer preferences, persisted in localStorage. Storage can be unavailable (private windows,
// blocked third-party storage) or hold values from an older version, so reading validates every
// field and falls back to the default, and writing never throws.

import { PREFS_STORAGE_KEY } from '../core/looks.js';

/**
 * @typedef {object} Prefs
 * @property {boolean} sound          sound effects (off until the viewer turns them on)
 * @property {number} volume          0–1
 * @property {'auto'|'day'|'sunset'|'night'} timeMode
 * @property {'auto'|'high'|'low'} quality
 * @property {'system'|'reduce'|'full'} motion
 * @property {'auto'|'light'|'dark'} theme
 * @property {boolean} crewsCollapsed
 * @property {'crews'|'tasks'|'activity'|'approvals'} tab
 * @property {1|2|4} speed            demo speed
 * @property {boolean} errorsOnly     activity log filter
 * @property {boolean} announce       read out activity summaries to screen readers
 * @property {boolean} setupSeen      the "run it yourself" dialog was shown once
 * @property {'auto'|'on'|'off'} directorCam  the camera follows the action by itself; auto is on unless motion is reduced
 * @property {'auto'|'shown'|'hidden'} panels  side panels; auto hides them in a hosted demo
 * @property {boolean} weather       rain, storms, fog and rainbows from what the crews go through
 * @property {boolean} desktopNotify notifications on this computer while the town is in the background
 * @property {boolean} ambient       waves, gulls, city hum and soft music while sound is on
 * @property {'coast'|'snow'|'neon'|'desert'|'amman'} townLook  the town's look (core/looks.js, read by page.js); changing it reloads
 */

/** @type {Readonly<Prefs>} */
export const DEFAULT_PREFS = Object.freeze({
  sound: false,
  volume: 0.6,
  timeMode: 'auto',
  quality: 'auto',
  motion: 'system',
  theme: 'auto',
  crewsCollapsed: false,
  tab: 'activity',
  speed: 1,
  errorsOnly: false,
  announce: true,
  setupSeen: false,
  directorCam: 'auto',
  panels: 'auto',
  weather: true,
  desktopNotify: false,
  ambient: true,
  townLook: 'coast',
});

export const STORAGE_KEY = PREFS_STORAGE_KEY;

/** @type {Record<string, readonly any[]>} */
const CHOICES = {
  timeMode: ['auto', 'day', 'sunset', 'night'],
  quality: ['auto', 'high', 'low'],
  motion: ['system', 'reduce', 'full'],
  theme: ['auto', 'light', 'dark'],
  tab: ['crews', 'tasks', 'activity', 'approvals'],
  speed: [1, 2, 4],
  panels: ['auto', 'shown', 'hidden'],
  directorCam: ['auto', 'on', 'off'],
  townLook: ['coast', 'snow', 'neon', 'desert', 'amman'],
};

/**
 * Parses stored preferences, keeping only valid fields.
 * @param {string|null|undefined} raw
 * @returns {Prefs}
 */
export function parsePrefs(raw) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(raw ?? 'null');
  } catch {
    data = null;
  }
  const prefs = { ...DEFAULT_PREFS };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return prefs;
  for (const key of /** @type {(keyof Prefs)[]} */ (Object.keys(DEFAULT_PREFS))) {
    if (isValid(key, data[key])) /** @type {any} */ (prefs)[key] = data[key];
  }
  return prefs;
}

/**
 * @param {keyof Prefs} key
 * @param {unknown} value
 */
function isValid(key, value) {
  if (CHOICES[key]) return CHOICES[key].includes(value);
  if (key === 'volume') return typeof value === 'number' && value >= 0 && value <= 1;
  return typeof value === typeof DEFAULT_PREFS[key];
}

/**
 * @param {Pick<Storage, 'getItem'>|null} [storage]
 * @returns {Prefs}
 */
export function loadPrefs(storage = safeStorage()) {
  try {
    return parsePrefs(storage?.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * @param {Prefs} prefs
 * @param {Pick<Storage, 'setItem'>|null} [storage]
 */
export function savePrefs(prefs, storage = safeStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota exceeded or storage disabled: preferences just won't survive a reload.
  }
}

/** localStorage, or null where touching it throws (sandboxed frames, disabled storage). */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
