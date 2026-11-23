// The six homes of the residential quarter (core/town-map.js HOMES), one per person of a team
// town. A home nobody owns is a plain cottage in the town's own look; an owned one takes its
// owner's house style (look-palettes.js HOUSE_PALETTES), a door and a flag in their colour, a name
// plate (a place label) and windows that are lit while they are online. All six are one mesh,
// rebuilt when a home changes (rare: a profile is saved at most every 10 s).
import * as THREE from 'three';
import { HOMES, HOME_COUNT, tileToWorld } from '../../layout.js';
import { GeometryBatch } from '../batch.js';
import { Kit } from '../kit.js';
import { HOUSE_PALETTES } from '../look-palettes.js';
import { C, S } from '../palette.js';
import { LOT_Y } from '../terrain.js';

/** @typedef {import('../../../core/looks.js').LookId} LookId */

/**
 * @typedef {object} Home
 * @property {string} name     the owner, on the name plate
 * @property {number} color    the owner's colour (sRGB hex)
 * @property {LookId} style    the owner's house style
 * @property {boolean} lights  windows lit (the owner is online)
 */

const STYLES = new Set(Object.keys(HOUSE_PALETTES));
const BODY = Object.freeze({ w: 3, h: 1.7, d: 2.4, z: -0.25 });
const FRONT = BODY.z + BODY.d / 2;
const LIT = 0xffdf9e;

/**
 * @param {{ scene: THREE.Scene, material: THREE.Material, signs: { addLabel: (label: any) => void, removeLabel: (id: string) => void }, townLook: LookId }} deps
 */
export function createHomes({ scene, material, signs, townLook }) {
  /** @type {(Home|null)[]} */
  const homes = Array.from({ length: HOME_COUNT }, () => null);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = 'homes';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  rebuild();

  function rebuild() {
    const batch = new GeometryBatch(8192);
    const kit = new Kit(batch);
    kit.building = 0;
    for (const plot of HOMES) buildHouse(kit, plot, homes[plot.slot], townLook);
    kit.dispose();
    mesh.geometry.dispose();
    mesh.geometry = batch.build();
  }

  return {
    mesh,
    /**
     * @param {number} slot  0 to 5
     * @param {Home|null} home  null: nobody lives there
     */
    set(slot, home) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= HOME_COUNT) return;
      const next = home && STYLES.has(home.style) ? home : null;
      if (sameHome(homes[slot], next)) return;
      homes[slot] = next;
      const id = `home-${slot}`;
      if (next) signs.addLabel({ id, text: next.name, icon: '🏠', position: plateAt(HOMES[slot]) });
      else signs.removeLabel(id);
      rebuild();
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    },
  };
}

/** @param {Home|null} a @param {Home|null} b */
function sameHome(a, b) {
  if (!a || !b) return a === b;
  return a.name === b.name && a.color === b.color && a.style === b.style && a.lights === b.lights;
}

/** The plot's centre on the ground. @param {import('../../../core/town-map.js').HomePlot} plot */
function plotCentre(plot) {
  const a = tileToWorld(plot.rect[0], plot.rect[1]);
  const b = tileToWorld(plot.rect[2], plot.rect[3]);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/** Where the name plate hangs: over the porch. @param {import('../../../core/town-map.js').HomePlot} plot */
function plateAt(plot) {
  const { x, z } = plotCentre(plot);
  return new THREE.Vector3(x, LOT_Y + 2.9, z + FRONT);
}

/**
 * @param {Kit} kit
 * @param {import('../../../core/town-map.js').HomePlot} plot
 * @param {Home|null} home
 * @param {LookId} townLook
 */
function buildHouse(kit, plot, home, townLook) {
  const style = HOUSE_PALETTES[home?.style ?? townLook] ?? HOUSE_PALETTES.coast;
  const { x, z } = plotCentre(plot);
  // The door lines up with the plot's door tile, the west half of the plot.
  const doorU = Math.max(-0.8, tileToWorld(plot.door[0], plot.door[1]).x - x);
  kit.push(x, LOT_Y, z);
  kit.box([0, 0, BODY.z], [BODY.w + 0.1, 0.16, BODY.d + 0.1], style.trim, { surface: S.stone });
  kit.box([0, 0.16, BODY.z], [BODY.w, BODY.h - 0.16, BODY.d], style.wall, { surface: S.stone });
  roof(kit, style);
  const door = home ? home.color : C.wood;
  kit.box([doorU, 0.16, FRONT], [0.66, 1.06, 0.06], style.trim, { surface: S.stone });
  kit.box([doorU, 0.16, FRONT + 0.02], [0.52, 0.98, 0.06], door, { surface: S.gloss });
  kit.box([doorU, 0, FRONT + 0.25], [0.9, 0.06, 0.5], style.trim, { surface: S.stone });
  kit.box([doorU, 0, FRONT + 1.05], [0.6, 0.03, 1.1], C.paving, { surface: S.stone });
  for (const u of [0.25, 1.0]) houseWindow(kit, u, 0.62, style, Boolean(home?.lights));
  if (home) flag(kit, home.color);
  kit.pop();
}

/** @param {Kit} kit @param {import('../look-palettes.js').HousePalette} style */
function roof(kit, style) {
  const top = BODY.h;
  if (style.shape === 'gable') {
    kit.prism([0, top, BODY.z], [BODY.w + 0.3, 1.05, BODY.d + 0.3], style.roof, { surface: S.gloss });
    kit.box([0.85, top + 0.2, BODY.z - 0.35], [0.3, 0.75, 0.3], style.trim, { surface: S.stone });
    return;
  }
  kit.box([0, top, BODY.z], [BODY.w + 0.12, 0.08, BODY.d + 0.12], style.roof, { surface: S.stone });
  kit.box([0, top + 0.08, BODY.z + BODY.d / 2], [BODY.w + 0.12, 0.2, 0.1], style.trim, { surface: S.stone });
  if (style.shape === 'dome') {
    kit.cyl([0.55, top + 0.08, BODY.z - 0.2], 0.5, 0.18, style.trim, { seg: 16, surface: S.stone });
    kit.dome([0.55, top + 0.26, BODY.z - 0.2], 0.48, style.accent, { surface: S.gold });
  } else {
    // Neon city: a glowing strip under the roof edge; desert: a band of blue tiles.
    const neon = style.accent === HOUSE_PALETTES.neon.accent;
    kit.box([0, top - 0.18, FRONT + 0.02], [BODY.w, 0.07, 0.04], style.accent, neon ? { surface: S.glow, glow: 1 } : { surface: S.gloss });
  }
}

/**
 * A window with a frame and a sill; lit warm while the owner is online.
 * @param {Kit} kit @param {number} u @param {number} y
 * @param {import('../look-palettes.js').HousePalette} style @param {boolean} lit
 */
function houseWindow(kit, u, y, style, lit) {
  kit.box([u, y - 0.06, FRONT + 0.04], [0.56, 0.06, 0.1], style.trim, { surface: S.stone });
  kit.box([u, y, FRONT], [0.5, 0.56, 0.05], style.trim);
  kit.box([u, y + 0.04, FRONT + 0.02], [0.4, 0.48, 0.05], lit ? LIT : C.glass, lit ? { surface: S.glow, glow: 0.9 } : { surface: S.glass, glow: 0 });
}

/** A flag on a pole at the porch's east corner, in the owner's colour. @param {Kit} kit @param {number} color */
function flag(kit, color) {
  kit.cyl([1.65, 0, 1.55], 0.035, 1.9, C.iron, { seg: 6, surface: S.steel });
  kit.box([1.95, 1.4, 1.55], [0.56, 0.36, 0.03], color, { surface: S.fabric });
  kit.sphere([1.65, 1.92, 1.55], 0.05, C.gold, { surface: S.gold });
}
