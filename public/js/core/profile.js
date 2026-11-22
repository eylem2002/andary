// A person's profile in a team town (CONTRACTS §4.11): their colour, their house style, the name
// their character shows, one name for all their agents, and their character's whole look, chosen
// in the "You" dialog (ui/character.js). The host checks every profile with validateProfile
// before it saves or broadcasts it, and every browser draws it the same way. Version 1: every look
// value is enumerated and colours are indices into the fixed palettes below, never free hex, so
// bounds and contrast hold by construction; the two names are short plain text (letters and
// digits of any script, spaces, dots, dashes, underscores), always shown as text. Any unknown or
// missing key, any value out of range, or a profile over PROFILE_MAX_BYTES rejects the whole
// profile. Pure: the server shares it.

/** Most bytes a serialised profile may take. */
export const PROFILE_MAX_BYTES = 768;
/** Most characters (code points) of the character's name and of the agents' name. */
export const NAME_MAX_CHARS = 20;

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
  ['Porcelain', '#F9E0CC'], ['Ivory', '#F7D7BC'], ['Peach', '#EDBB93'], ['Sand', '#E2B288'], ['Honey', '#D9A06F'], ['Olive', '#C69C6D'],
  ['Caramel', '#B97D4E'], ['Bronze', '#A06A42'], ['Chestnut', '#8F5A36'], ['Mocha', '#6E452B'], ['Espresso', '#5E3B25'], ['Ebony', '#4A2D1D'],
]);
export const HAIR_COLORS = swatches([
  ['Black', '#1C1C1F'], ['Dark brown', '#2B1B12'], ['Brown', '#4A2E1C'], ['Auburn', '#7A4A24'], ['Blond', '#C9944A'], ['Platinum', '#E6D8B8'],
  ['Ginger', '#9E3B1F'], ['Grey', '#A7A9AE'], ['Pink', '#E27BA8'], ['Teal', '#2C8C8C'], ['Blue', '#3B5BDB'], ['Purple', '#7048B6'],
]);
export const CLOTH_COLORS = swatches([
  ['Navy', '#2F3B57'], ['Charcoal', '#3A3F48'], ['Khaki', '#8A7556'], ['Denim', '#25496E'], ['White', '#E9E6DF'], ['Red', '#C0392B'],
  ['Mustard', '#D4A12A'], ['Forest', '#2E6B4A'], ['Plum', '#6B3A6E'], ['Sky', '#5DA9D6'], ['Coral', '#E8735A'], ['Black', '#1E1E22'],
]);

/** The choices of every look field: an enumeration, or a palette (any index into it). */
export const LOOK_CHOICES = Object.freeze({
  skin: SKIN_TONES,
  height: Object.freeze(['short', 'medium', 'tall']),
  build: Object.freeze(['slim', 'regular', 'broad']),
  hair: Object.freeze(['short', 'side', 'quiff', 'spiky', 'straight', 'wavy', 'ponytail', 'pigtails', 'bun', 'braids', 'afro', 'curly', 'mohawk', 'buzz', 'bald']),
  hairColor: HAIR_COLORS,
  hairStreak: HAIR_COLORS,
  eyes: Object.freeze(['dot', 'round', 'happy', 'sleepy', 'lashes', 'wink']),
  brows: Object.freeze(['none', 'thin', 'thick', 'arched']),
  mouth: Object.freeze(['smile', 'grin', 'neutral', 'open']),
  facialHair: Object.freeze(['none', 'stubble', 'beard', 'goatee', 'moustache']),
  glasses: Object.freeze(['none', 'round', 'square', 'sunglasses', 'goggles']),
  cheeks: Object.freeze(['none', 'freckles', 'blush', 'both']),
  earrings: Object.freeze(['none', 'studs', 'hoops']),
  top: Object.freeze(['tee', 'longsleeve', 'hoodie', 'zip', 'denim', 'bomber', 'blazer', 'shirt', 'polo', 'tank', 'sweater', 'cardigan', 'vest', 'labcoat', 'overalls', 'dress', 'kimono']),
  topPattern: Object.freeze(['plain', 'stripes', 'checks', 'dots', 'emblem']),
  topColor: CLOTH_COLORS,
  patternColor: CLOTH_COLORS,
  bottom: Object.freeze(['trousers', 'jeans', 'cargo', 'shorts', 'skirt', 'longskirt', 'joggers']),
  bottomColor: CLOTH_COLORS,
  shoes: Object.freeze(['sneakers', 'hightops', 'boots', 'sandals', 'loafers', 'slippers']),
  shoesColor: CLOTH_COLORS,
  hat: Object.freeze(['none', 'cap', 'beanie', 'beret', 'sunhat', 'wizard', 'crown', 'hardhat', 'bucket', 'headband', 'bandana', 'flowers', 'viking', 'tophat', 'chef', 'halo']),
  extra: Object.freeze(['none', 'cape', 'scarf', 'backpack', 'headphones', 'tie', 'bowtie', 'necklace', 'watch', 'satchel', 'wings']),
  pet: Object.freeze(['none', 'cat', 'dog', 'bird']),
  hand: Object.freeze(['none', 'laptop', 'coffee', 'book']),
});

/** Fields whose palette also takes 'theme' (the person's own colour) or 'none' (no streak). */
const SPECIAL = Object.freeze({ topColor: 'theme', patternColor: 'theme', hairStreak: 'none' });

/** @typedef {keyof typeof LOOK_CHOICES} LookField */
/** The look's fields, in the order a profile serialises them. */
export const LOOK_FIELDS = Object.freeze(/** @type {LookField[]} */ (Object.keys(LOOK_CHOICES)));

/**
 * @typedef {object} PersonLook  each field one of LOOK_CHOICES (or an index into its palette)
 * @property {number} skin
 * @property {string} height     'short'|'medium'|'tall'
 * @property {string} build      'slim'|'regular'|'broad'
 * @property {string} hair
 * @property {number} hairColor
 * @property {'none'|number} hairStreak  a second hair colour (tips and a streak)
 * @property {string} eyes
 * @property {string} brows
 * @property {string} mouth
 * @property {string} facialHair
 * @property {string} glasses
 * @property {string} cheeks
 * @property {string} earrings
 * @property {string} top
 * @property {string} topPattern
 * @property {'theme'|number} topColor   'theme': the person's own colour
 * @property {'theme'|number} patternColor
 * @property {string} bottom
 * @property {number} bottomColor
 * @property {string} shoes
 * @property {number} shoesColor
 * @property {string} hat
 * @property {string} extra
 * @property {string} pet
 * @property {string} hand
 */

/**
 * @typedef {object} Profile
 * @property {1} v
 * @property {number} color      0–7: the person colour they ask for
 * @property {HouseStyle} house
 * @property {string} name       the name their character shows; '' for their roster name
 * @property {string} agents     one name for all their agents ("Pixel": Pixel, Pixel 1, …); '' for role names
 * @property {PersonLook} look
 */

/** @typedef {{ ok: boolean, profile?: Profile, error?: string }} ProfileCheck  profile when ok, error when not */

const PROFILE_KEYS = Object.freeze(['v', 'color', 'house', 'name', 'agents', 'look']);

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
export function validChoice(field, value) {
  if (value !== undefined && /** @type {Record<string, unknown>} */ (SPECIAL)[field] === value) return true;
  const choices = LOOK_CHOICES[field];
  return typeof choices[0] === 'string' ? /** @type {readonly string[]} */ (choices).includes(/** @type {string} */ (value)) : isIndex(value, choices.length);
}

/** @param {Record<string, unknown>} object @param {readonly string[]} keys */
function exactKeys(object, keys) {
  const own = Object.keys(object);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

/**
 * A name as people see it: letters and digits of any script, spaces, dots, dashes and
 * underscores; no control or invisible characters; single spaces; at most NAME_MAX_CHARS.
 * @param {unknown} raw
 * @returns {string}  '' when nothing is left
 */
export function cleanDisplayName(raw) {
  if (typeof raw !== 'string') return '';
  const name = raw.normalize('NFC').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(name).slice(0, NAME_MAX_CHARS).join('').trim();
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
  if (!isPlainObject(raw) || !exactKeys(raw, PROFILE_KEYS)) return { ok: false, error: `A profile has exactly ${PROFILE_KEYS.join(', ')}` };
  if (raw.v !== 1) return { ok: false, error: 'Only version 1 profiles are known' };
  if (!isIndex(raw.color, PERSON_COLOR_COUNT)) return { ok: false, error: `color is a number from 0 to ${PERSON_COLOR_COUNT - 1}` };
  if (!HOUSE_STYLES.includes(/** @type {HouseStyle} */ (raw.house))) return { ok: false, error: `house is one of ${HOUSE_STYLES.join(', ')}` };
  for (const key of /** @type {const} */ (['name', 'agents'])) {
    if (typeof raw[key] !== 'string' || cleanDisplayName(raw[key]) !== raw[key]) return { ok: false, error: `${key} is up to ${NAME_MAX_CHARS} letters, digits, spaces, dots, dashes or underscores` };
  }
  const look = raw.look;
  if (!isPlainObject(look) || !exactKeys(look, LOOK_FIELDS)) return { ok: false, error: `look has exactly ${LOOK_FIELDS.join(', ')}` };
  const bad = LOOK_FIELDS.find((field) => !validChoice(field, look[field]));
  if (bad) return { ok: false, error: `look.${bad} is not one of its choices` };
  const clean = /** @type {PersonLook} */ (/** @type {unknown} */ (Object.fromEntries(LOOK_FIELDS.map((field) => [field, look[field]]))));
  return { ok: true, profile: { v: 1, color: /** @type {number} */ (raw.color), house: /** @type {HouseStyle} */ (raw.house), name: /** @type {string} */ (raw.name), agents: /** @type {string} */ (raw.agents), look: clean } };
}

/**
 * A look picked at random (the dialog's Random button, and a newcomer's first look).
 * @param {() => number} [random]  0 ≤ x < 1
 * @returns {PersonLook}
 */
export function randomLook(random = Math.random) {
  const pick = (/** @type {number} */ n) => Math.min(n - 1, Math.floor(random() * n));
  const look = /** @type {Record<string, unknown>} */ (Object.fromEntries(LOOK_FIELDS.map((field) => {
    const choices = LOOK_CHOICES[field];
    const index = pick(choices.length);
    return [field, typeof choices[0] === 'string' ? choices[index] : index];
  })));
  // Most people wear their own colour; most have no streak, no hat, no pet and empty hands.
  if (random() < 0.6) look.topColor = 'theme';
  if (random() < 0.5) look.patternColor = 'theme';
  if (random() < 0.7) look.hairStreak = 'none';
  if (random() < 0.4) look.hat = 'none';
  if (random() < 0.6) look.pet = 'none';
  if (random() < 0.6) look.hand = 'none';
  return /** @type {PersonLook} */ (/** @type {unknown} */ (look));
}

/**
 * A profile picked at random, keeping what is not about the look.
 * @param {() => number} [random]
 * @param {Partial<Pick<Profile, 'color'|'house'|'name'|'agents'>>} [keep]
 * @returns {Profile}
 */
export function randomProfile(random = Math.random, keep = {}) {
  const pick = (/** @type {number} */ n) => Math.min(n - 1, Math.floor(random() * n));
  return { v: 1, color: keep.color ?? pick(PERSON_COLOR_COUNT), house: keep.house ?? HOUSE_STYLES[pick(HOUSE_STYLES.length)], name: keep.name ?? '', agents: keep.agents ?? '', look: randomLook(random) };
}

/** @type {PersonLook} */
const PLAIN = Object.freeze({
  skin: 2, height: 'medium', build: 'regular', hair: 'short', hairColor: 2, hairStreak: 'none', eyes: 'dot', brows: 'thin', mouth: 'smile',
  facialHair: 'none', glasses: 'none', cheeks: 'blush', earrings: 'none', top: 'tee', topPattern: 'plain', topColor: 'theme', patternColor: 4,
  bottom: 'trousers', bottomColor: 0, shoes: 'sneakers', shoesColor: 4, hat: 'none', extra: 'none', pet: 'none', hand: 'none',
});

/**
 * The look of someone who has not chosen one yet: a plain, friendly default in their colour.
 * @param {number} color
 * @returns {Profile}
 */
export function defaultProfile(color) {
  return { v: 1, color: isIndex(color, PERSON_COLOR_COUNT) ? color : 0, house: 'coast', name: '', agents: '', look: { ...PLAIN } };
}

/**
 * Ready-made outfits: the clothes and accessories of a look, over whatever body, hair and face
 * the person chose.
 * @type {ReadonlyArray<Readonly<{ id: string, name: string, look: Readonly<Partial<PersonLook>> }>>}
 */
export const OUTFITS = Object.freeze([
  { id: 'coder', name: 'Coder', look: { top: 'hoodie', topPattern: 'emblem', topColor: 'theme', patternColor: 4, bottom: 'jeans', bottomColor: 3, shoes: 'sneakers', shoesColor: 4, hat: 'none', extra: 'headphones', glasses: 'square', hand: 'laptop' } },
  { id: 'wizard', name: 'Wizard', look: { top: 'kimono', topPattern: 'dots', topColor: 8, patternColor: 6, bottom: 'longskirt', bottomColor: 8, shoes: 'slippers', shoesColor: 6, hat: 'wizard', extra: 'cape', glasses: 'round', hand: 'book' } },
  { id: 'chef', name: 'Chef', look: { top: 'labcoat', topPattern: 'plain', topColor: 4, patternColor: 4, bottom: 'trousers', bottomColor: 1, shoes: 'loafers', shoesColor: 11, hat: 'chef', extra: 'scarf', glasses: 'none', hand: 'coffee' } },
  { id: 'astronaut', name: 'Astronaut-ish', look: { top: 'overalls', topPattern: 'emblem', topColor: 4, patternColor: 5, bottom: 'cargo', bottomColor: 4, shoes: 'boots', shoesColor: 4, hat: 'none', extra: 'backpack', glasses: 'goggles', hand: 'none' } },
]);
