// The town's colours (sRGB hex) and surface kinds. One place to tune the look: warm limestone,
// golden domes, terracotta and teal accents, sage lawns and teal trees.

export const C = Object.freeze({
  // Limestone and plaster
  stone: 0xeee5d3,
  stoneWarm: 0xe7d9bf,
  stonePale: 0xf6f1e7,
  stoneTrim: 0xd8c9ab,
  stoneDark: 0xc9b896,
  stoneGrey: 0xd3ccbf,
  plaster: 0xf3eee4,
  sand: 0xe2cfa8,
  // Accents
  gold: 0xe0a83e,
  goldDeep: 0xc98d2a,
  terracotta: 0xc8673c,
  terracottaDark: 0xa9512e,
  roofTile: 0xb85a35,
  teal: 0x2f8f89,
  tealLight: 0x5bb3a8,
  tealDark: 0x1f6662,
  copper: 0x5fa59a,
  red: 0xc8433a,
  cream: 0xf6ead2,
  navy: 0x2c3e5c,
  wood: 0x9a6b43,
  woodDark: 0x6c4a30,
  woodLight: 0xc49a6c,
  cardboard: 0xc49a62,
  tape: 0xe6cf9a,
  // Metal and glass
  steel: 0x9aa3ab,
  steelDark: 0x59616b,
  iron: 0x3b4148,
  glass: 0x324c5e,
  screen: 0x101820,
  // Ground
  asphalt: 0x8b8781,
  asphaltDark: 0x7d7973,
  marking: 0xf5f1e6,
  sidewalk: 0xddd4c4,
  curb: 0xcfc5b3,
  paving: 0xe8dfcd,
  pavingAlt: 0xddd0b8,
  lawn: 0xa3be6e,
  lawnDark: 0x8fae5c,
  soil: 0x8a6a48,
  gravel: 0xd9cdb5,
  seaFloor: 0xd8c08d,
  // Plants
  leafTeal: 0x4ea596,
  leafOlive: 0x86a84f,
  leafDeep: 0x2f7f6f,
  cypress: 0x3d6f4c,
  palm: 0x6aa54a,
  trunk: 0x8a6847,
  palmTrunk: 0xa88a62,
  // Lights
  bulb: 0xffd9a0,
  lampGlow: 0xffc070,
  portal: 0x7fe7ff,
  forge: 0xff8a3a,
  beacon: 0xff3b30,
  // Flowers
  flowerPink: 0xe86a9a,
  flowerRed: 0xd8453c,
  flowerYellow: 0xf2c84b,
  flowerPurple: 0x9b6ad8,
  flowerWhite: 0xf8f4ec,
});

/**
 * Surface kinds, read by the town shader (town-material.js) to pick roughness, metalness and
 * procedural detail per vertex. Keep in sync with TT_ROUGH / TT_METAL in that shader.
 */
export const S = Object.freeze({
  matte: 0,
  stone: 1, // limestone ashlar courses on walls
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
