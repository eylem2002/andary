// Shared JSDoc types for building builders (no runtime code).

/**
 * @typedef {object} Lot
 * @property {import('../../../core/catalog.js').BuildingKey} key
 * @property {number} id     1-based building id used by the town shader
 * @property {number} w      lot width (x)
 * @property {number} d      lot depth (z)
 * @property {number} cx     lot centre (world x)
 * @property {number} cz     lot centre (world z)
 * @property {number} doorX  door tile centre relative to the lot centre
 * @property {number} doorZ
 */

/**
 * @typedef {object} BuildContext
 * @property {() => number} rng
 * @property {import('three').Group} root           world-positioned group for moving parts
 * @property {(build: (kit: import('../kit.js').Kit) => void) => import('three').Mesh} part  builds a moving part
 * @property {(kind: 'round'|'palm'|'cypress', x: number, z: number, scale?: number) => void} tree  local coords
 * @property {(fn: (dt: number, elapsed: number) => void) => void} animate
 * @property {import('../town-material.js').TownUniforms} town
 * @property {Record<string, import('three').Material>} materials
 */

/**
 * @typedef {object} BuildingSpec
 * @property {number} height
 * @property {[number, number, number]} [sign]    local sign anchor (defaults above the roof)
 * @property {Record<string, [number, number, number]>} [anchors]  local named anchors
 */

export {};
