// Colours and styles of each town look other than the sunset coast (palette.js holds that one):
// overrides of the shared tones, each building's paint, the neon, the sea, the island's sides,
// the trees and the beach. All original; see core/looks.js for the list.

/** @typedef {import('../../core/looks.js').LookId} LookId */
/** @typedef {number[]} RGB  [r, g, b] */

/**
 * @typedef {object} LookStyle
 * @property {{ shallow: RGB, deep: RGB, streakA: RGB, streakB: RGB }} water  linear-ish shader colours
 * @property {number} seaSide         the sea's glass sides
 * @property {{ lip: RGB, soil: RGB, soilLight: RGB, rock: RGB, rockAlt: RGB, base: RGB }} strata
 * @property {'palm'|'round'|'cypress'} rimTree  the trees around the island's edge
 * @property {'umbrellas'|'snowmen'} beach
 * @property {boolean} snow           the town's rain falls as snow
 */

/** @type {LookStyle} */
export const COAST_STYLE = Object.freeze({
  water: { shallow: [0.2, 0.84, 0.8], deep: [0.02, 0.36, 0.6], streakA: [1.0, 0.5, 0.75], streakB: [0.4, 0.9, 1.0] },
  seaSide: 0x2fd0d6,
  strata: { lip: [0.34, 0.6, 0.2], soil: [0.55, 0.38, 0.27], soilLight: [0.66, 0.47, 0.32], rock: [0.94, 0.82, 0.7], rockAlt: [0.86, 0.71, 0.6], base: [0.62, 0.48, 0.42] },
  rimTree: 'palm',
  beach: 'umbrellas',
  snow: false,
});

/**
 * @typedef {object} LookPalette
 * @property {Record<string, number>} colors   overrides of palette.js's C
 * @property {Record<string, number>|null} neon  overrides of NEON
 * @property {Record<string, { wall: number, deep: number, trim: number, accent: number, neon: string }>|null} paint
 *   each building's paint (neon names a NEON key); null keeps the shared tones unpainted
 * @property {LookStyle} style
 */

/** Builds a paint table from rows of [key, wall, deep, trim, accent, neon]. @param {[string, number, number, number, number, string][]} rows */
function paints(rows) {
  return Object.fromEntries(rows.map(([key, wall, deep, trim, accent, neon]) => [key, { wall, deep, trim, accent, neon }]));
}

/** @type {Readonly<Record<Exclude<LookId, 'coast'>, LookPalette>>} */
export const LOOK_PALETTES = Object.freeze({
  snow: {
    colors: {
      stone: 0xe9e2d6, stoneWarm: 0xcdbba5, stonePale: 0xfdfeff, stoneTrim: 0xffffff, stoneDark: 0xb9a892, plaster: 0xefe9df,
      sand: 0xf2f5f8, gold: 0xd9a441, goldDeep: 0xb88a32, glass: 0x2a4258,
      asphalt: 0x6c7280, asphaltDark: 0x626875, marking: 0xffffff, sidewalk: 0xe4e9ee, curb: 0xd5dde4,
      paving: 0xe8edf2, pavingAlt: 0xdfe6ec, lawn: 0xeef3f7, lawnDark: 0xdbe4ec, gravel: 0xe2e7ec, seaFloor: 0xc9d6dd,
      leafTeal: 0x3d6f5b, leafOlive: 0x55785a, leafDeep: 0x2e5b45, cypress: 0x2e5b45, palm: 0x3d6f5b,
      flowerPink: 0xd8313a, flowerRed: 0xc0262e, flowerYellow: 0xffd27a, flowerPurple: 0xffffff, flowerWhite: 0xffffff,
    },
    neon: { pink: 0xffd27a, cyan: 0xfff0c2, violet: 0xffb347, orange: 0xff9f43, mint: 0xfff6d5 },
    paint: paints([
      ['hall', 0xb5413a, 0x8f2f2a, 0xffffff, 0xd9a441, 'pink'],
      ['library', 0x2f5d50, 0x244a40, 0xffffff, 0xd9a441, 'cyan'],
      ['academy', 0xe0b54a, 0xc89b35, 0xffffff, 0xb5413a, 'violet'],
      ['permits', 0x3b5a8c, 0x2e4870, 0xffffff, 0xd9a441, 'pink'],
      ['workshop', 0x9c5b3c, 0x7d472e, 0xffffff, 0x2f5d50, 'orange'],
      ['terminal', 0x7a2f2f, 0x5f2424, 0xffffff, 0xd9a441, 'cyan'],
      ['harbor', 0x2b6b7a, 0x225661, 0xffffff, 0xb5413a, 'mint'],
      ['detective', 0x5a6b8c, 0x475670, 0xffffff, 0xe0b54a, 'pink'],
      ['post', 0xc9473f, 0xa33a33, 0xffffff, 0x2f5d50, 'cyan'],
      ['web', 0xeae6dc, 0xcfc8ba, 0xffffff, 0x3b5a8c, 'violet'],
      ['spa', 0xd9c7b5, 0xc0ab96, 0xffffff, 0x2b6b7a, 'mint'],
      ['cafe', 0x8c5a3c, 0x70472f, 0xffffff, 0xb5413a, 'pink'],
      ['station', 0xeee3cf, 0xd8cab0, 0xffffff, 0x2f5d50, 'orange'],
      ['board', 0xeee3cf, 0xd8cab0, 0xffffff, 0xb5413a, 'cyan'],
      ['grove', 0xe9e2d6, 0xcdbba5, 0xffffff, 0x2f5d50, 'mint'],
    ]),
    style: {
      water: { shallow: [0.5, 0.74, 0.82], deep: [0.1, 0.27, 0.42], streakA: [1.0, 0.82, 0.5], streakB: [1.0, 0.92, 0.75] },
      seaSide: 0x9cc7d6,
      strata: { lip: [0.95, 0.97, 1.0], soil: [0.42, 0.34, 0.3], soilLight: [0.5, 0.41, 0.36], rock: [0.72, 0.74, 0.77], rockAlt: [0.62, 0.64, 0.68], base: [0.45, 0.46, 0.5] },
      rimTree: 'cypress',
      beach: 'snowmen',
      snow: true,
    },
  },
  neon: {
    colors: {
      stone: 0x2b2840, stoneWarm: 0x221f33, stonePale: 0x3a3654, stoneTrim: 0x4a4570, stoneDark: 0x1b1928, plaster: 0x2f2b46,
      sand: 0x3a3550, brick: 0x3a2840, brickDark: 0x2a1d30, gold: 0xff3fa4, goldDeep: 0xd02a86, glass: 0x1a2a4a, screen: 0x05070d,
      asphalt: 0x1c1b26, asphaltDark: 0x17161f, marking: 0x6ef3ff, sidewalk: 0x2a2836, curb: 0x353244,
      paving: 0x2b2938, pavingAlt: 0x34313f, lawn: 0x1f4a44, lawnDark: 0x173a36, gravel: 0x2a2836, seaFloor: 0x1a1a2e,
      leafTeal: 0x22d3b0, leafOlive: 0x1fae8f, leafDeep: 0x168a73, cypress: 0x168a73, palm: 0x2fbf9f, trunk: 0x3a3048, palmTrunk: 0x4a3f5a,
      bulb: 0xff8ad8, lampGlow: 0x6ef3ff,
    },
    neon: { pink: 0xff2ea6, cyan: 0x16f4ff, violet: 0xa64dff, orange: 0xff7a2e, mint: 0x2effb2 },
    paint: paints([
      ['hall', 0x2d2a48, 0x232038, 0x4a4570, 0x16f4ff, 'pink'],
      ['library', 0x23304a, 0x1b263b, 0x3b4c70, 0xff2ea6, 'cyan'],
      ['academy', 0x3a2848, 0x2d1f39, 0x5a4270, 0x2effb2, 'violet'],
      ['permits', 0x2a2448, 0x211c3a, 0x463e70, 0xff7a2e, 'pink'],
      ['workshop', 0x3a2a33, 0x2c1f27, 0x5a4250, 0x16f4ff, 'orange'],
      ['terminal', 0x1f2a33, 0x172028, 0x384a58, 0xff2ea6, 'cyan'],
      ['harbor', 0x1d3038, 0x16252c, 0x34505c, 0xa64dff, 'mint'],
      ['detective', 0x262640, 0x1d1d33, 0x404066, 0x2effb2, 'pink'],
      ['post', 0x382438, 0x2b1b2b, 0x58405a, 0x16f4ff, 'cyan'],
      ['web', 0x2a2d48, 0x212339, 0x474b70, 0xff2ea6, 'violet'],
      ['spa', 0x34243f, 0x281b31, 0x524068, 0x16f4ff, 'mint'],
      ['cafe', 0x22333a, 0x1a272d, 0x3b5560, 0xff7a2e, 'pink'],
      ['station', 0x2b2840, 0x221f33, 0x4a4570, 0x2effb2, 'orange'],
      ['board', 0x2b2840, 0x221f33, 0x4a4570, 0xff2ea6, 'cyan'],
      ['grove', 0x2b2840, 0x221f33, 0x4a4570, 0x2effb2, 'mint'],
    ]),
    style: {
      water: { shallow: [0.06, 0.2, 0.32], deep: [0.02, 0.04, 0.12], streakA: [1.0, 0.25, 0.7], streakB: [0.1, 0.95, 1.0] },
      seaSide: 0x123a5a,
      strata: { lip: [0.1, 0.55, 0.6], soil: [0.16, 0.15, 0.22], soilLight: [0.2, 0.19, 0.27], rock: [0.26, 0.25, 0.34], rockAlt: [0.2, 0.19, 0.28], base: [0.12, 0.11, 0.17] },
      rimTree: 'round',
      beach: 'umbrellas',
      snow: false,
    },
  },
  desert: {
    colors: {
      stone: 0xe8c9a0, stoneWarm: 0xd9a877, stonePale: 0xf3dfbf, stoneTrim: 0xf6e7cf, stoneDark: 0xc28e5c, plaster: 0xeccda6,
      sand: 0xf0d39a, brick: 0xc0704a, brickDark: 0xa35a38, gold: 0x2a9d8f, goldDeep: 0x21867a, glass: 0x264a5a,
      asphalt: 0x8a7a6a, asphaltDark: 0x7f705f, marking: 0xfff6e6, sidewalk: 0xe3c79c, curb: 0xd4b384,
      paving: 0xe9cfa4, pavingAlt: 0xdcbb88, lawn: 0xe2c084, lawnDark: 0xd6ae6c, gravel: 0xdcc49a, seaFloor: 0xe3c387,
      leafTeal: 0x5b9e3c, leafOlive: 0x7d9a3a, leafDeep: 0x467e2e, cypress: 0x466e34, palm: 0x5b9e3c,
      flowerPink: 0xe8578a, flowerRed: 0xd4453a, flowerYellow: 0xf2c84b, flowerPurple: 0x8f5fd0,
    },
    neon: { pink: 0xffb44a, cyan: 0x3fe0d0, violet: 0xff8a3c, orange: 0xffcf6b, mint: 0x5ff0c0 },
    paint: paints([
      ['hall', 0xf1dcbc, 0xe2c299, 0xfbf1e1, 0x2a9d8f, 'pink'],
      ['library', 0xd98a5a, 0xc47547, 0xf6e3cc, 0x2a6f9d, 'cyan'],
      ['academy', 0xe9b768, 0xd9a252, 0xfbf0dc, 0x2a9d8f, 'violet'],
      ['permits', 0xcf7f6a, 0xb96b57, 0xf7e5dc, 0x2a6f9d, 'pink'],
      ['workshop', 0xc4864f, 0xad723f, 0xf4e0c8, 0x2a9d8f, 'orange'],
      ['terminal', 0xb85c45, 0x9f4c38, 0xf5ddd2, 0x3fe0d0, 'cyan'],
      ['harbor', 0xe6c48f, 0xd6ad74, 0xfbf0dd, 0x2a6f9d, 'mint'],
      ['detective', 0xd9a877, 0xc79262, 0xf8e7d1, 0x2a6f9d, 'pink'],
      ['post', 0xe39a73, 0xcd845f, 0xfaeadf, 0x2a9d8f, 'cyan'],
      ['web', 0xf3e2c6, 0xe3cba5, 0xfffaf0, 0x2a6f9d, 'violet'],
      ['spa', 0xe7b9a0, 0xd5a185, 0xfbece3, 0x2a9d8f, 'mint'],
      ['cafe', 0xc97b54, 0xb26843, 0xf6e1d2, 0x2a6f9d, 'pink'],
      ['station', 0xf0d8b0, 0xe1c193, 0xfdf3e3, 0x2a9d8f, 'orange'],
      ['board', 0xf0d8b0, 0xe1c193, 0xfdf3e3, 0x2a6f9d, 'cyan'],
      ['grove', 0xe8c9a0, 0xd9a877, 0xf6e7cf, 0x2a9d8f, 'mint'],
    ]),
    style: {
      water: { shallow: [0.15, 0.75, 0.7], deep: [0.03, 0.38, 0.5], streakA: [1.0, 0.7, 0.35], streakB: [0.35, 0.95, 0.85] },
      seaSide: 0x34c3b6,
      strata: { lip: [0.78, 0.6, 0.38], soil: [0.72, 0.4, 0.26], soilLight: [0.82, 0.52, 0.34], rock: [0.86, 0.58, 0.4], rockAlt: [0.74, 0.45, 0.3], base: [0.55, 0.32, 0.22] },
      rimTree: 'palm',
      beach: 'umbrellas',
      snow: false,
    },
  },
  amman: {
    colors: {
      stone: 0xeee5d3, stoneWarm: 0xe7d9bf, stonePale: 0xf6f1e7, stoneTrim: 0xd8c9ab, stoneDark: 0xc9b896, plaster: 0xf3eee4,
      sand: 0xe2cfa8, gold: 0xe0a83e, goldDeep: 0xc98d2a, terracotta: 0xc8673c, terracottaDark: 0xa9512e, roofTile: 0xb85a35,
      teal: 0x2f8f89, tealLight: 0x5bb3a8, tealDark: 0x1f6662, copper: 0x5fa59a, red: 0xc8433a, cream: 0xf6ead2, navy: 0x2c3e5c,
      wood: 0x9a6b43, woodLight: 0xc49a6c, steel: 0x9aa3ab, steelDark: 0x59616b, iron: 0x3b4148, glass: 0x324c5e,
      asphalt: 0x8b8781, asphaltDark: 0x7d7973, marking: 0xf5f1e6, sidewalk: 0xddd4c4, curb: 0xcfc5b3,
      paving: 0xe8dfcd, pavingAlt: 0xddd0b8, lawn: 0xa3be6e, lawnDark: 0x8fae5c, soil: 0x8a6a48, gravel: 0xd9cdb5, seaFloor: 0xd8c08d,
      leafTeal: 0x4ea596, leafOlive: 0x86a84f, leafDeep: 0x2f7f6f, cypress: 0x3d6f4c, palm: 0x6aa54a, palmTrunk: 0xa88a62, bulb: 0xffd9a0,
      flowerPink: 0xe86a9a, flowerRed: 0xd8453c, flowerYellow: 0xf2c84b, flowerPurple: 0x9b6ad8, flowerWhite: 0xf8f4ec,
    },
    // Floodlight strips rather than neon: warm white under the cornices.
    neon: { pink: 0xffe2b0, cyan: 0xfff0d0, violet: 0xffd79a, orange: 0xffc880, mint: 0xfff4dc },
    paint: null,
    style: {
      water: { shallow: [0.16, 0.62, 0.62], deep: [0.03, 0.23, 0.42], streakA: [1.0, 0.68, 0.32], streakB: [1.0, 0.68, 0.32] },
      seaSide: 0x3fb3c4,
      strata: { lip: [0.36, 0.48, 0.17], soil: [0.31, 0.22, 0.14], soilLight: [0.42, 0.29, 0.17], rock: [0.66, 0.57, 0.42], rockAlt: [0.55, 0.46, 0.34], base: [0.42, 0.36, 0.29] },
      rimTree: 'round',
      beach: 'umbrellas',
      snow: false,
    },
  },
});
