// How the town labels its places (Settings → Place names, the "P" key): 'auto' writes a name on a
// building only when it fits there at the current zoom and shows just its icon otherwise,
// 'always' writes every name, 'off' shows no labels until a place is pointed at or selected.
// Shared by the HUD (preference, shortcut) and the world (env/sign-layout.js).

/** @typedef {'auto'|'always'|'off'} PlaceNames */

/** @type {ReadonlyArray<PlaceNames>} */
export const PLACE_NAMES = Object.freeze(['auto', 'always', 'off']);

/** @param {unknown} mode @returns {mode is PlaceNames} */
export function isPlaceNames(mode) {
  return PLACE_NAMES.includes(/** @type {PlaceNames} */ (mode));
}

/**
 * The next mode for the "P" key: auto → always → off → auto.
 * @param {unknown} mode
 * @returns {PlaceNames}
 */
export function nextPlaceNames(mode) {
  const i = PLACE_NAMES.indexOf(/** @type {PlaceNames} */ (mode));
  return PLACE_NAMES[(i + 1) % PLACE_NAMES.length];
}
