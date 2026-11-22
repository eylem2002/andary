// A person's profile in a team town (CONTRACTS §4.11): their colour, their house style and their
// character's whole look, chosen in the "You" dialog (ui/character.js). The host checks every
// profile with validateProfile before it saves or broadcasts it, and every browser draws it the
// same way. Version 1: every value is enumerated and colours are indices into the fixed palettes
// below, never free hex, so bounds and contrast hold by construction. Any unknown or missing key,
// or any value out of range, rejects the whole profile, and so does one over 512 bytes. Pure: the
// server shares it.

/** Most bytes a serialised profile may take. */
export const PROFILE_MAX_BYTES = 512;

/** How many person colours there are: the crew colours (core/catalog.js CREW_COLORS), in order. */
export const PERSON_COLOR_COUNT = 8;
/** Names of the person colours, for screen readers and the colour note. */
export const PERSON_COLOR_NAMES = Object.freeze(['Cobalt', 'Raspberry', 'Pine', 'Violet', 'Copper', 'Lagoon', 'Brick', 'Olive']);

/** @typedef {'coast'|'snow'|'neon'|'desert'|'amman'} HouseStyle */
/** House styles, one per town look (core/looks.js). */
export const HOUSE_STYLES = Object.freeze(/** @type {HouseStyle[]} */ (['coast', 'snow', 'neon', 'desert', 'amman']));

/** @typedef {Readonly<{ name: string, hex: string }>} Swatch */

/** @param {[string, string][]} rows @returns {ReadonlyArray<Swatch>} */
const swatches = (rows) => Object.freeze(rows.map(([name, hex]) => Object.freeze({ name, hex })));

export const SKIN_TONES = swatches([
  ['Porcelain', '#F7D7BC'], ['Peach', '#EDBB93'], ['Honey', '#D9A06F'], ['Caramel', '#B97D4E'],
  ['Bronze', '#A06A42'], ['Chestnut', '#8F5A36'], ['Mocha', '#6E452B'], ['Espresso', '#5E3B25'],
]);
export const HAIR_COLORS = swatches([
  ['Black', '#1C1C1F'], ['Dark brown', '#2B1B12'], ['Brown', '#4A2E1C'], ['Auburn', '#7A4A24'], ['Blond', '#C9944A'],
  ['Ginger', '#9E3B1F'], ['Grey', '#A7A9AE'], ['Pink', '#E27BA8'], ['Teal', '#2C8C8C'],
]);
export const CLOTH_COLORS = swatches([
  ['Navy', '#2F3B57'], ['Charcoal', '#3A3F48'], ['Khaki', '#8A7556'], ['Denim', '#25496E'], ['White', '#E9E6DF'],
  ['Red', '#C0392B'], ['Mustard', '#D4A12A'], ['Forest', '#2E6B4A'], ['Plum', '#6B3A6E'], ['Sky', '#5DA9D6'],
]);

/** The choices of every look field: an enumeration, or a palette (any index into it). */
export const LOOK_CHOICES = Object.freeze({
  skin: SKIN_TONES,
  hair: Object.freeze(['short', 'long', 'bun', 'curly', 'buzz', 'bald']),
  hairColor: HAIR_COLORS,
  eyes: Object.freeze(['dot', 'round', 'happy']),
  face: Object.freeze(['none', 'freckles', 'beard', 'moustache', 'glasses']),
  top: Object.freeze(['tee', 'hoodie', 'jacket', 'sweater']),
  topColor: CLOTH_COLORS,
  bottom: Object.freeze(['trousers', 'shorts', 'skirt']),
  bottomColor: CLOTH_COLORS,
  shoes: Object.freeze(['boots', 'sneakers', 'sandals']),
  shoesColor: CLOTH_COLORS,
  hat: Object.freeze(['none', 'cap', 'beanie', 'beret', 'sunhat', 'wizard', 'crown', 'hardhat']),
  extra: Object.freeze(['none', 'cape', 'scarf', 'backpack', 'headphones']),
});

/** @typedef {keyof typeof LOOK_CHOICES} LookField */
/** The look's fields, in the order the dialog shows them and a profile serialises them. */
export const LOOK_FIELDS = Object.freeze(/** @type {LookField[]} */ (Object.keys(LOOK_CHOICES)));

/**
 * @typedef {object} PersonLook
 * @property {number} skin
 * @property {'short'|'long'|'bun'|'curly'|'buzz'|'bald'} hair
 * @property {number} hairColor
 * @property {'dot'|'round'|'happy'} eyes
 * @property {'none'|'freckles'|'beard'|'moustache'|'glasses'} face
 * @property {'tee'|'hoodie'|'jacket'|'sweater'} top
 * @property {'theme'|number} topColor   'theme': the person's own colour
 * @property {'trousers'|'shorts'|'skirt'} bottom
 * @property {number} bottomColor
 * @property {'boots'|'sneakers'|'sandals'} shoes
 * @property {number} shoesColor
 * @property {'none'|'cap'|'beanie'|'beret'|'sunhat'|'wizard'|'crown'|'hardhat'} hat
 * @property {'none'|'cape'|'scarf'|'backpack'|'headphones'} extra
 */

/**
 * @typedef {object} Profile
 * @property {1} v
 * @property {number} color      0–7: the person colour they ask for
 * @property {HouseStyle} house
 * @property {PersonLook} look
 */

/** @typedef {{ ok: boolean, profile?: Profile, error?: string }} ProfileCheck  profile when ok, error when not */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** @param {unknown} value @param {number} count */
function isIndex(value, count) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0 && /** @type {number} */ (value) < count;
}

/**
 * Whether a look field holds an allowed value.
 * @param {LookField} field @param {unknown} value
 */
function validChoice(field, value) {
  if (field === 'topColor' && value === 'theme') return true;
  const choices = LOOK_CHOICES[field];
  return typeof choices[0] === 'string' ? /** @type {readonly string[]} */ (choices).includes(/** @type {string} */ (value)) : isIndex(value, choices.length);
}

/** @param {Record<string, unknown>} object @param {readonly string[]} keys */
function exactKeys(object, keys) {
  const own = Object.keys(object);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

/**
 * Checks a profile from anywhere (a browser's message, people.json, storage). The returned
 * profile is a fresh copy in a fixed key order; nothing of the input is kept.
 * @param {unknown} raw
 * @returns {ProfileCheck}
 */
export function validateProfile(raw) {
  let text;
  try {
    text = JSON.stringify(raw);
  } catch {
    return { ok: false, error: 'The profile is not JSON' };
  }
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > PROFILE_MAX_BYTES) return { ok: false, error: `A profile takes at most ${PROFILE_MAX_BYTES} bytes` };
  if (!isPlainObject(raw) || !exactKeys(raw, ['v', 'color', 'house', 'look'])) return { ok: false, error: 'A profile has exactly v, color, house and look' };
  if (raw.v !== 1) return { ok: false, error: 'Only version 1 profiles are known' };
  if (!isIndex(raw.color, PERSON_COLOR_COUNT)) return { ok: false, error: `color is a number from 0 to ${PERSON_COLOR_COUNT - 1}` };
  if (!HOUSE_STYLES.includes(/** @type {HouseStyle} */ (raw.house))) return { ok: false, error: `house is one of ${HOUSE_STYLES.join(', ')}` };
  const look = raw.look;
  if (!isPlainObject(look) || !exactKeys(look, LOOK_FIELDS)) return { ok: false, error: `look has exactly ${LOOK_FIELDS.join(', ')}` };
  const bad = LOOK_FIELDS.find((field) => !validChoice(field, look[field]));
  if (bad) return { ok: false, error: `look.${bad} is not one of its choices` };
  const clean = /** @type {PersonLook} */ (Object.fromEntries(LOOK_FIELDS.map((field) => [field, look[field]])));
  return { ok: true, profile: { v: 1, color: /** @type {number} */ (raw.color), house: /** @type {HouseStyle} */ (raw.house), look: clean } };
}

/**
 * A profile picked at random (the dialog's Random button, and a newcomer's first look).
 * @param {() => number} [random]  0 ≤ x < 1
 * @param {{ color?: number, house?: HouseStyle }} [keep]  colour and house to keep
 * @returns {Profile}
 */
export function randomProfile(random = Math.random, keep = {}) {
  const pick = (/** @type {number} */ n) => Math.min(n - 1, Math.floor(random() * n));
  const look = /** @type {PersonLook} */ (Object.fromEntries(LOOK_FIELDS.map((field) => {
    const choices = LOOK_CHOICES[field];
    const index = pick(choices.length);
    return [field, typeof choices[0] === 'string' ? choices[index] : index];
  })));
  // Most people wear their own colour on top; a hat now and then.
  if (random() < 0.6) look.topColor = 'theme';
  if (random() < 0.4) look.hat = 'none';
  return { v: 1, color: keep.color ?? pick(PERSON_COLOR_COUNT), house: keep.house ?? HOUSE_STYLES[pick(HOUSE_STYLES.length)], look };
}

/**
 * The look of someone who has not chosen one yet: a plain, friendly default in their colour.
 * @param {number} color
 * @returns {Profile}
 */
export function defaultProfile(color) {
  return {
    v: 1,
    color: isIndex(color, PERSON_COLOR_COUNT) ? color : 0,
    house: 'coast',
    look: { skin: 1, hair: 'short', hairColor: 2, eyes: 'dot', face: 'none', top: 'tee', topColor: 'theme', bottom: 'trousers', bottomColor: 0, shoes: 'sneakers', shoesColor: 4, hat: 'none', extra: 'none' },
  };
}
