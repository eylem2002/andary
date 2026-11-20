// The town's look (Settings → Town look): which palette, sky, sea and trees it is built with.
// It is read once when the page loads (from ?look= or the saved preference), because the town's
// geometry carries its colours; changing it reloads the page. Pure data, no three.js.

/** @typedef {'coast'|'snow'|'neon'|'desert'|'amman'} LookId */

/** @type {ReadonlyArray<Readonly<{ id: LookId, name: string, about: string }>>} */
export const LOOKS = Object.freeze([
  Object.freeze({ id: 'coast', name: 'Sunset coast', about: 'Pastel stucco, palms, a beach and neon at dusk' }),
  Object.freeze({ id: 'snow', name: 'Snowy village', about: 'Painted wooden houses, pines, snow and warm lights' }),
  Object.freeze({ id: 'neon', name: 'Neon city', about: 'Dark towers, glowing signs and a violet haze, even by day' }),
  Object.freeze({ id: 'desert', name: 'Desert oasis', about: 'Adobe walls, tiled accents, palms and red rock' }),
  Object.freeze({ id: 'amman', name: 'Amman old town', about: 'Warm limestone, golden domes and teal trees' }),
]);

const IDS = new Set(LOOKS.map((look) => look.id));

/**
 * The look to build: ?look= wins (for links and tests), then the saved preference.
 * @param {string} [search]  location.search
 * @param {Pick<Storage, 'getItem'>|null} [storage]
 * @returns {LookId}
 */
export function readLook(search = globalThis.location?.search ?? '', storage = safeStorage()) {
  const asked = new URLSearchParams(search).get('look');
  if (asked && IDS.has(/** @type {LookId} */ (asked))) return /** @type {LookId} */ (asked);
  try {
    const saved = JSON.parse(storage?.getItem('andary:prefs') ?? 'null')?.townLook;
    if (IDS.has(saved)) return saved;
  } catch {
    // unreadable preferences: the default look
  }
  return 'coast';
}

/** The look this page was built with. */
export const LOOK = readLook();

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
