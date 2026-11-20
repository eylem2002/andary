// The town's colours (sRGB hex) and surface kinds. One place to tune the look: a sunset coast of
// pastel stucco and white trims, turquoise water, palms, lush lawns and neon that comes on at dusk.
// Each building is repainted from the shared stucco tones (PAINT, applied by the kit), so the
// building code keeps naming materials ("stone", "gold") while every block gets its own colour.

export const C = Object.freeze({
  // Stucco and plaster (shared tones; buildings swap them for their own paint)
  stone: 0xf6efe6,
  stoneWarm: 0xf3dccd,
  stonePale: 0xfffaf4,
  stoneTrim: 0xfbf7f1,
  stoneDark: 0xd9c9bd,
  plaster: 0xfff4ea,
  sand: 0xfbe7bd,
  brick: 0xb9694a,
  brickDark: 0x9c5439,
  // Accents
  gold: 0xf2b134,
  goldDeep: 0xd9932a,
  terracotta: 0xe2704f,
  terracottaDark: 0xc4573a,
  roofTile: 0xd9653f,
  teal: 0x16b3a7,
  tealLight: 0x5fe0cf,
  tealDark: 0x0b7c76,
  copper: 0x4fc9b9,
  red: 0xff4d5e,
  cream: 0xfff1dc,
  navy: 0x2a2f6b,
  wood: 0xa8774c,
  woodDark: 0x6c4a30,
  woodLight: 0xd2a874,
  cardboard: 0xc49a62,
  tape: 0xe6cf9a,
  // Metal and glass
  steel: 0xa7b1ba,
  steelDark: 0x5b6470,
  iron: 0x343a44,
  glass: 0x2b5f7a,
  screen: 0x101820,
  // Ground
  asphalt: 0x6f7179,
  asphaltDark: 0x63656d,
  marking: 0xfdfbf5,
  sidewalk: 0xece6dd,
  curb: 0xded6cb,
  paving: 0xf3e6dc,
  pavingAlt: 0xead2c6,
  lawn: 0x8fd16a,
  lawnDark: 0x6fb64f,
  soil: 0x9a6e4c,
  gravel: 0xeadfca,
  seaFloor: 0xf0dcae,
  // Plants
  leafTeal: 0x2fae8f,
  leafOlive: 0x7cbc4a,
  leafDeep: 0x1e8a6a,
  cypress: 0x2f7a52,
  palm: 0x4cb84a,
  trunk: 0x8a6847,
  palmTrunk: 0xb79a6e,
  // Lights
  bulb: 0xffe1a8,
  lampGlow: 0xffc070,
  portal: 0x7fe7ff,
  forge: 0xff8a3a,
  beacon: 0xff3b30,
  // Flowers: bougainvillea, hibiscus and frangipani
  flowerPink: 0xff4fa0,
  flowerRed: 0xff4a3d,
  flowerYellow: 0xffd23f,
  flowerPurple: 0xb06bff,
  flowerWhite: 0xfff8f0,
});

/** Neon tube colours: they outline the buildings and light the plaza once the sun is down. */
export const NEON = Object.freeze({
  pink: 0xff3fa4,
  cyan: 0x2fe8ff,
  violet: 0xb066ff,
  orange: 0xff9a3c,
  mint: 0x4dffc3,
});

/**
 * @typedef {object} Paint
 * @property {number} wall    main walls (stands in for C.stone and C.plaster)
 * @property {number} deep    wings, lower storeys and brickwork (C.stoneWarm, C.brick)
 * @property {number} trim    cornices, sills, columns' caps (C.stoneTrim)
 * @property {number} accent  domes, finials and metalwork (C.gold)
 * @property {number} neon    the tube that outlines the roofline at night
 */

/** Every building's paint: pastel walls with white trims, one accent, one neon. */
export const PAINT = Object.freeze({
  hall: { wall: 0xfffaf5, deep: 0xffd6cf, trim: 0xffffff, accent: 0x29c7bd, neon: NEON.pink },
  library: { wall: 0xb5ecd4, deep: 0x8fdcbf, trim: 0xfcfffd, accent: 0xff8fa6, neon: NEON.cyan },
  academy: { wall: 0xffe39a, deep: 0xffcf73, trim: 0xfffdf6, accent: 0xff7b6b, neon: NEON.violet },
  permits: { wall: 0xd4c2f5, deep: 0xbba5ee, trim: 0xfdfbff, accent: 0x7a5cff, neon: NEON.pink },
  workshop: { wall: 0xffcfab, deep: 0xffb98a, trim: 0xfff8f1, accent: 0x18b6a8, neon: NEON.orange },
  terminal: { wall: 0xff9f97, deep: 0xf47c74, trim: 0xfff6f4, accent: 0x2fd3e0, neon: NEON.cyan },
  harbor: { wall: 0xa9ece6, deep: 0x7fdcd3, trim: 0xf7fffe, accent: 0xff7a59, neon: NEON.mint },
  detective: { wall: 0xa8d8fb, deep: 0x86c4f2, trim: 0xf8fcff, accent: 0xffb703, neon: NEON.pink },
  post: { wall: 0xffbfd3, deep: 0xffa1bd, trim: 0xfffafc, accent: 0x15aaa0, neon: NEON.cyan },
  web: { wall: 0xf3f5ff, deep: 0xcfd6ff, trim: 0xffffff, accent: 0xb066ff, neon: NEON.violet },
  spa: { wall: 0xf9c9e6, deep: 0xf1a8d6, trim: 0xfff9fd, accent: 0x2fc6d6, neon: NEON.mint },
  cafe: { wall: 0x9fe6ee, deep: 0x7dd5e1, trim: 0xf8feff, accent: 0xff5c8a, neon: NEON.pink },
  station: { wall: 0xfff1d8, deep: 0xffe0b5, trim: 0xffffff, accent: 0x16b3a7, neon: NEON.orange },
  board: { wall: 0xfff1d8, deep: 0xffe0b5, trim: 0xffffff, accent: 0xff5c8a, neon: NEON.cyan },
  grove: { wall: 0xf6efe6, deep: 0xf3dccd, trim: 0xfbf7f1, accent: 0x29c7bd, neon: NEON.mint },
});

/**
 * @param {number} hex @param {number} amount  -1 (black) … 0 … 1 (white)
 * @returns {number}
 */
export function shade(hex, amount) {
  const target = amount < 0 ? 0 : 255;
  const t = Math.min(1, Math.abs(amount));
  const channel = (/** @type {number} */ shift) => {
    const v = (hex >> shift) & 255;
    return Math.round(v + (target - v) * t);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * How the kit repaints a building: the shared stucco and gold tones become the building's own.
 * @param {Paint} paint
 * @returns {Map<number, number>}
 */
export function paintMap(paint) {
  return new Map([
    [C.stone, paint.wall],
    [C.plaster, paint.wall],
    [C.stoneWarm, paint.deep],
    [C.stonePale, shade(paint.wall, 0.45)],
    [C.stoneTrim, paint.trim],
    [C.stoneDark, shade(paint.deep, -0.12)],
    [C.gold, paint.accent],
    [C.goldDeep, shade(paint.accent, -0.15)],
    [C.brick, paint.deep],
    [C.brickDark, shade(paint.deep, -0.18)],
  ]);
}

/**
 * Surface kinds, read by the town shader (town-material.js) to pick roughness, metalness and
 * procedural detail per vertex. Keep in sync with TT_ROUGH / TT_METAL in that shader.
 */
export const S = Object.freeze({
  matte: 0,
  stone: 1, // trowelled stucco on walls
  ground: 2, // speckled lawn / gravel
  glass: 3, // windows: glossy by day, lit at night
  gold: 4,
  gloss: 5, // painted metal, vehicles, tiles
  bulb: 6, // lamp heads: glow at night
  steel: 7,
  water: 8, // resin-like water sides, pool tiles
  foliage: 9,
  glow: 10, // always glowing: portal, forge, screens
  strata: 11, // plinth sides: soil and stone layers
  beacon: 12, // blinking warning light
  fabric: 13, // awnings, umbrellas, flags
});
