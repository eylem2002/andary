// Street furniture and greenery: trees from the town plan, lamps (with warm light pools on the
// ground at night), benches, the plaza fountain and its string lights, the promenade, the park,
// the kids' sandbox and the node_modules lot. Static parts go into the town batch.
import * as THREE from 'three';
import { DECOR, MAP, tileToWorld } from '../layout.js';
import { PIER } from './buildings/industry.js';
import { buildBeach } from './beach.js';
import { bench, flowerBed, hedge } from './buildings/details.js';
import { C, S } from './palette.js';
import { createRng, range } from './rand.js';
import { createJetMaterial, createPoolMaterial } from './water.js';

/** @typedef {import('./trees.js').TreePlacement} TreePlacement */

const LAMP_HEIGHT = 1.75;

/**
 * @param {import('./kit.js').Kit} kit
 * @param {{scene: THREE.Scene, town: import('./town-material.js').TownUniforms, trees: TreePlacement[]}} ctx
 */
export function buildProps(kit, ctx) {
  const rng = createRng(5);
  kit.building = 0;
  placeMapTrees(ctx.trees, rng);
  const lamps = lampPositions();
  for (const p of lamps) streetLamp(kit, p.x, p.z, rng);
  promenade(kit, ctx.trees);
  buildBeach(kit, ctx.trees, rng);
  plaza(kit, rng);
  park(kit, ctx.trees, rng);
  sandbox(kit);
  nodeModulesLot(kit);
  const pools = createLampPools(lamps);
  ctx.scene.add(pools.mesh);
  const fountain = createFountainWater(ctx.town);
  ctx.scene.add(fountain);
  const sandboxCentre = decorCentre(DECOR.sandbox);
  return {
    pierRect: { minX: PIER.x - PIER.w / 2, maxX: PIER.x + PIER.w / 2, minZ: PIER.z1, maxZ: PIER.z0 },
    labels: [{ id: 'decor-sandbox', text: 'Sandbox', icon: '🪣', position: new THREE.Vector3(sandboxCentre.x, 1.3, sandboxCentre.z + 0.4) }],
    /** @param {number} night 0..1 */
    setNight(night) {
      pools.setNight(night);
    },
  };
}

/** @param {[number, number, number, number]} rect */
function decorCentre(rect) {
  const a = tileToWorld(rect[0], rect[1]);
  const b = tileToWorld(rect[2], rect[3]);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/**
 * Trees on every 't' tile of the plan, smaller and sparser at the front edge so they never hide
 * the buildings behind them, and the occasional bush on open ground.
 * @param {TreePlacement[]} trees
 * @param {() => number} rng
 */
function placeMapTrees(trees, rng) {
  MAP.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const { x, z } = tileToWorld(col, row);
      if (nearTunnel(col, row)) continue;
      if (ch === 't') {
        const front = row >= 24 || col === 25;
        if (front && (col + row) % 2 === 1) continue;
        // Mostly palms, with a few broad shade trees among them.
        const kind = (col * 7 + row * 3) % 5 === 0 ? 'round' : 'palm';
        trees.push({ kind, x: x + range(rng, -0.35, 0.35), z: z + range(rng, -0.35, 0.35), y: 0.1, scale: front ? range(rng, 0.62, 0.8) : range(rng, 0.8, 1.05) });
      } else if (ch === '.' && rng() < 0.3) {
        trees.push({ kind: 'round', x: x + range(rng, -0.5, 0.5), z: z + range(rng, -0.5, 0.5), y: 0.07, scale: range(rng, 0.32, 0.45) });
      }
    }
  });
}

/** @param {number} col @param {number} row */
function nearTunnel(col, row) {
  return row >= 22 && row <= 24 && (col <= 1 || col >= 24);
}

/** Lamp spots: along the outer side of the ring road, the promenade, the plaza and the park. */
function lampPositions() {
  /** @type {{x: number, z: number}[]} */
  const out = [];
  for (let z = -15; z <= 19; z += 6) {
    out.push({ x: -22.25, z }, { x: 22.25, z });
  }
  for (let x = -18; x <= 18; x += 6) out.push({ x, z: 22.25 });
  for (let x = -21; x <= 21; x += 6) if (Math.abs(x - PIER.x) > 1.5) out.push({ x, z: -21.55 });
  out.push({ x: -4.6, z: 2.6 }, { x: 4.6, z: 2.6 }, { x: -4.6, z: 5.6 }, { x: 4.6, z: 5.6 });
  out.push({ x: 0.6, z: 9.0 }, { x: 5.4, z: 12.9 });
  return out;
}

/**
 * Lamp post with a lantern head; the bulb glows at night.
 * @param {import('./kit.js').Kit} kit
 * @param {number} x @param {number} z
 * @param {() => number} rng
 */
function streetLamp(kit, x, z, rng) {
  kit.cyl([x, 0, z], 0.09, 0.14, C.iron, { seg: 8, surface: S.steel });
  kit.cyl([x, 0.14, z], 0.045, LAMP_HEIGHT - 0.14, 0x2f4a46, { seg: 8, top: 0.035, surface: S.gloss });
  const y = LAMP_HEIGHT;
  kit.cyl([x, y, z], 0.07, 0.05, C.iron, { seg: 8, surface: S.steel });
  kit.cyl([x, y + 0.05, z], 0.09, 0.22, C.bulb, { seg: 8, top: 0.11, surface: S.bulb, glow: 1, seed: range(rng, 0, 0.25) });
  kit.cone([x, y + 0.27, z], 0.15, 0.13, 0x2f4a46, { seg: 8, surface: S.gloss });
  kit.sphere([x, y + 0.42, z], 0.025, C.gold, { surface: S.gold });
}

/**
 * Promenade along the seawall: palms, benches facing the sea and planters.
 * @param {import('./kit.js').Kit} kit
 * @param {TreePlacement[]} trees
 */
function promenade(kit, trees) {
  const z = -20.9;
  for (let x = -24; x <= 24; x += 6) {
    if (Math.abs(x - PIER.x) < 2) continue;
    trees.push({ kind: 'palm', x, z: z + 0.15, y: 0.04, scale: 0.85 });
    kit.cyl([x, 0.04, z + 0.15], 0.4, 0.18, C.stoneTrim, { seg: 12, surface: S.stone });
    kit.cyl([x, 0.22, z + 0.15], 0.36, 0.02, C.soil, { seg: 12, surface: S.ground });
    if (x < 21) bench(kit, x + 3, -21.35, Math.PI);
  }
}

/**
 * The plaza: fountain basin and tiers, planters and the string lights over the open square.
 * @param {import('./kit.js').Kit} kit
 * @param {() => number} rng
 */
function plaza(kit, rng) {
  const fx = 0;
  const fz = 5;
  const torus = kit.cached('basin-rim', () => new THREE.TorusGeometry(1, 0.11, 8, 40));
  kit.cyl([fx, 0, fz], 1.92, 0.22, C.stoneTrim, { sz: 0.47, seg: 40, surface: S.stone });
  kit.place(torus, [fx, 0.36, fz], [1.92, 0.9, 1.4], C.stonePale, { rotX: Math.PI / 2, surface: S.stone });
  kit.lathe([fx, 0.36, fz], [[0.32, 0], [0.22, 0.2], [0.16, 0.65], [0.62, 0.78], [0.66, 0.86], [0.12, 0.84], [0.1, 1.15], [0.34, 1.24], [0.36, 1.3], [0.06, 1.3]], C.stonePale, { seg: 20, surface: S.stone, cacheId: 'fountain-tiers' });
  kit.sphere([fx, 1.72, fz], 0.07, C.gold, { surface: S.gold });
  for (const side of [-1, 1]) {
    flowerBed(kit, [side * 3.3, 5.45], [1.5, 0.6], rng);
    bench(kit, side * 3.3, 4.55, Math.PI);
  }
  stringLights(kit, rng);
}

/**
 * Festoon lights strung between four poles over the square in front of the Town Hall.
 * @param {import('./kit.js').Kit} kit
 * @param {() => number} rng
 */
function stringLights(kit, rng) {
  const poles = [[-5.65, 2.25], [5.65, 2.25], [-5.65, 5.75], [5.65, 5.75]];
  for (const [x, z] of poles) {
    kit.cyl([x, 0, z], 0.05, 3.0, C.iron, { seg: 8, surface: S.steel });
    kit.sphere([x, 3.02, z], 0.06, C.gold, { surface: S.gold });
  }
  const strings = [[0, 3], [2, 1], [0, 1], [2, 3]];
  const bulbColors = [0xff5fae, 0x52eaff, 0xffd36b, 0xb987ff];
  for (const [a, b] of strings) {
    const [x0, z0] = poles[a];
    const [x1, z1] = poles[b];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / 0.42);
    let px = x0;
    let pz = z0;
    let py = 2.95;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const y = 2.95 - Math.sin(Math.PI * t) * 0.65;
      const seg = Math.hypot(x - px, y - py, z - pz);
      const yaw = Math.atan2(x - px, z - pz);
      const pitch = Math.atan2(y - py, Math.hypot(x - px, z - pz));
      kit.box([(x + px) / 2, (y + py) / 2 - 0.006, (z + pz) / 2], [0.012, 0.012, seg], 0x30302e, { rotY: yaw, rotX: -pitch });
      if (i < n) kit.sphere([x, y - 0.07, z], 0.045, bulbColors[i % 4], { seg: 8, surface: S.bulb, glow: 0.9, seed: range(rng, 0, 0.2) });
      px = x;
      pz = z;
      py = y;
    }
  }
}

/**
 * Small park north of the bus stop: benches, a drinking fountain and hedges.
 * @param {import('./kit.js').Kit} kit
 * @param {TreePlacement[]} trees
 * @param {() => number} rng
 */
function park(kit, trees, rng) {
  bench(kit, 1.6, 12.6, Math.PI * 0.25);
  bench(kit, 4.4, 9.3, Math.PI);
  hedge(kit, [3, 13.75], [5.6, 0.4], 0.38);
  kit.cyl([2.9, 0.1, 11.2], 0.16, 0.7, C.stoneTrim, { seg: 10, surface: S.stone });
  kit.cyl([2.9, 0.8, 11.2], 0.26, 0.08, C.steel, { seg: 12, surface: S.steel });
  flowerBed(kit, [1.2, 9.4], [1.2, 0.5], rng);
  trees.push({ kind: 'cypress', x: 5.4, z: 8.6, y: 0.1, scale: 0.85 });
}

/**
 * A literal kids' sandbox: wooden frame, sand, a castle, bucket and spade.
 * @param {import('./kit.js').Kit} kit
 */
function sandbox(kit) {
  const { x, z } = decorCentre(DECOR.sandbox);
  const s = 1.75;
  kit.box([x, 0.08, z], [s, 0.08, s], C.sand, { surface: S.ground });
  for (const [dx, dz, w, d] of [[0, -s / 2, s + 0.16, 0.16], [0, s / 2, s + 0.16, 0.16], [-s / 2, 0, 0.16, s], [s / 2, 0, 0.16, s]]) {
    kit.box([x + dx, 0.08, z + dz], [w, 0.2, d], C.woodLight, { surface: S.gloss });
  }
  // Sand castle with towers.
  kit.box([x - 0.2, 0.16, z - 0.1], [0.5, 0.22, 0.4], 0xd9bd85, { surface: S.ground });
  for (const [dx, dz] of [[-0.45, -0.3], [0.05, -0.3], [-0.45, 0.1], [0.05, 0.1]]) {
    kit.cyl([x + dx, 0.16, z + dz], 0.08, 0.36, 0xd9bd85, { seg: 8, surface: S.ground });
    kit.cone([x + dx, 0.52, z + dz], 0.09, 0.1, 0xd9bd85, { seg: 8, surface: S.ground });
  }
  kit.cyl([x + 0.5, 0.16, z + 0.45], 0.13, 0.22, C.red, { seg: 10, top: 0.16, surface: S.gloss });
  kit.box([x + 0.35, 0.18, z - 0.5], [0.06, 0.03, 0.45], C.flowerYellow, { rotY: 0.6, surface: S.gloss });
  kit.ball([x - 0.55, 0.22, z + 0.5], 0.12, C.teal, { surface: S.gloss, detail: 1 });
  // A low slide next to it for scale.
  kit.box([x, 0.08, z - 2.1], [0.5, 0.9, 0.5], C.terracotta, { surface: S.gloss });
  kit.box([x, 0.45, z - 1.45], [0.45, 0.06, 1.2], C.tealLight, { rotX: -0.55, surface: S.gloss });
  kit.ball([x + 0.4, 0.2, z + 2.2], 0.32, C.leafOlive, { surface: S.foliage, detail: 1 });
}

/**
 * Gravel lot with a little warning sign for the node_modules pile.
 * @param {import('./kit.js').Kit} kit
 */
function nodeModulesLot(kit) {
  const { x, z } = decorCentre(DECOR.nodeModules);
  kit.box([x, 0.08, z], [1.8, 0.03, 4.6], 0xcfc3a8, { surface: S.ground });
  kit.cyl([x + 0.75, 0.08, z + 2.4], 0.03, 0.9, C.steel, { seg: 6, surface: S.steel });
  kit.box([x + 0.75, 0.75, z + 2.42], [0.5, 0.36, 0.03], C.flowerYellow, { surface: S.gloss });
  kit.box([x + 0.75, 0.8, z + 2.44], [0.36, 0.06, 0.01], 0x222222);
}

/**
 * Warm pools of light on the ground under each lamp, faded in at night.
 * @param {{x: number, z: number}[]} lamps
 */
function createLampPools(lamps) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffb867,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  material.name = 'lamp-pools';
  const geometry = new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geometry, material, lamps.length);
  mesh.name = 'lamp-pools';
  const m = new THREE.Matrix4();
  lamps.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, 0.035, p.z)));
  mesh.renderOrder = 2;
  mesh.visible = false;
  return {
    mesh,
    /** @param {number} night */
    setNight(night) {
      const k = Math.max(0, (night - 0.25) / 0.75);
      material.opacity = 0.55 * k;
      mesh.visible = k > 0.01;
    },
  };
}

/**
 * Fountain water: the basin surface, the bowl's falling curtains and the top jet.
 * @param {import('./town-material.js').TownUniforms} town
 */
function createFountainWater(town) {
  const group = new THREE.Group();
  group.name = 'fountain-water';
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), createPoolMaterial(town, 0, 5));
  pool.scale.set(1.84, 1, 0.86);
  pool.position.set(0, 0.32, 5);
  pool.receiveShadow = true;
  const jet = createJetMaterial(town);
  const curtainLow = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.82, 0.55, 24, 1, true), jet);
  curtainLow.position.set(0, 0.9, 5);
  const curtainTop = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 0.42, 20, 1, true), jet);
  curtainTop.position.set(0, 1.45, 5);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.55, 8, 1, true), jet);
  spout.position.set(0, 1.92, 5);
  group.add(pool, curtainLow, curtainTop, spout);
  return group;
}
