// One-shot effects (EffectKind in CONTRACTS §6): sparks, smoke, confetti, fireworks, icons…
// Each kind is a recipe that spawns pooled particles into a handful of instanced fields, so a
// burst costs nothing to allocate and every field is a single draw call while it has particles.

import * as THREE from 'three';
import { CURVE, ParticleField, spawnSpec } from './particles.js';
import { createBeamGeometry, createEffectShapes } from './effect-shapes.js';
import { parseHex } from './color.js';

export const EFFECT_KINDS = Object.freeze([
  'sparks', 'smoke', 'confetti', 'fireworks', 'books', 'magnify', 'signal', 'portal', 'poof', 'steam',
  'check', 'cross', 'hearts', 'zzz', 'bulb', 'boxes',
]);

/** @param {...string} hexes @returns {THREE.Color[]} linear colours, parsed once */
const palette = (...hexes) => hexes.map((h) => new THREE.Color(h));
const SPARKS = palette('#FFE27A', '#FFB347', '#FFFFFF', '#FF8A3D');
const CONFETTI = palette('#FF5C8A', '#FFC93C', '#4ADE80', '#60A5FA', '#A78BFA', '#FB923C', '#F472B6');
const BOOKS = palette('#C0392B', '#2E86DE', '#27AE60', '#F39C12', '#8E44AD', '#16A085');
const FIREWORKS = palette('#FF5C8A', '#FFD54A', '#4ADE80', '#60A5FA', '#C084FC');
const SMOKE = palette('#C9CED4', '#DDE1E5', '#B3B9C0');
const PUFF = palette('#FFFFFF', '#EEF2F6');
const PORTAL = palette('#7DD3FC', '#C4B5FD', '#FFFFFF');
const HEARTS = palette('#FF5C8A', '#FF7AA2');
const CARDBOARD = palette('#C8965A', '#B9864C', '#D4A66A');
const C = Object.fromEntries(
  Object.entries({
    rocket: '#FFF4D6', lens: '#FFFFFF', scan: '#7FD3FF', signal: '#5EEAD4', ring: '#A78BFA', steam: '#F4F7FA',
    check: '#22C55E', checkSpark: '#86EFAC', cross: '#EF4444', zee: '#DCEBFF', bulb: '#FFFFFF', bulbSpark: '#FFF3B0',
  }).map(([k, v]) => [k, new THREE.Color(v)]),
);
const BEAM_SECONDS = 1.6;
const BEAM_COLOR = new THREE.Color('#B7A6FF');

/** @param {number} a @param {number} b */
const rnd = (a, b) => a + Math.random() * (b - a);
/** @template T @param {readonly T[]} list @returns {T} */
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * @typedef {object} EmitOptions
 * @property {string} [color]  tint (#hex) for kinds that take one
 * @property {number} [scale]  1 = normal size/amount
 * @property {number} [ground] y of the ground below the effect (bounces, ground rings)
 */

/** Per-emit settings handed to recipes; one shared object so emitting allocates nothing. */
const O = { scale: 1, ground: 0, /** @type {THREE.Color|null} */ color: null };
const _custom = new THREE.Color();

/** @typedef {import('./particles.js').SpawnSpec} SpawnSpec */
/** @typedef {{x: number, y: number, z: number}} Point */

/** @param {SpawnSpec} s @param {THREE.Color} c */
function tint(s, c) {
  s.r = c.r;
  s.g = c.g;
  s.b = c.b;
  return s;
}

/** A fresh spec at a point. @param {Point} p @param {number} [dy] */
function at(p, dy = 0) {
  const s = spawnSpec();
  s.x = p.x;
  s.y = p.y + dy;
  s.z = p.z;
  return s;
}

/** Random direction in the upper hemisphere, scaled. @param {SpawnSpec} s @param {number} speed @param {number} [spread] */
function burst(s, speed, spread = 1.2) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * spread;
  s.vx = Math.cos(theta) * Math.sin(phi) * speed;
  s.vy = Math.cos(phi) * speed;
  s.vz = Math.sin(theta) * Math.sin(phi) * speed;
  return s;
}

/** Random direction on the whole sphere. @param {SpawnSpec} s @param {number} speed */
function sphere(s, speed) {
  const theta = Math.random() * Math.PI * 2;
  const u = Math.random() * 2 - 1;
  const r = Math.sqrt(1 - u * u);
  s.vx = Math.cos(theta) * r * speed;
  s.vy = u * speed;
  s.vz = Math.sin(theta) * r * speed;
  return s;
}

/** Sets how a particle moves and fades. @param {SpawnSpec} s @param {number} life @param {number} size @param {number} curve @param {number} [spin] */
function shape(s, life, size, curve, spin = 0) {
  s.life = life;
  s.size = size;
  s.curve = curve;
  s.spin = spin;
  return s;
}

/**
 * @typedef {object} Fx
 * @property {Record<string, ParticleField>} fields
 * @property {(n: number) => number} count  scales a particle count by quality and motion settings
 * @property {(p: Point, ground: number, color: THREE.Color|null) => void} beam
 */

/** Hot, gravity-bound sparks. @param {Fx} fx @param {Point} p @param {number} scale @param {THREE.Color|null} color */
function sparkBurst(fx, p, scale, color) {
  for (let i = fx.count(16 * scale); i > 0; i--) {
    const s = burst(at(p), rnd(1.5, 3.2) * Math.sqrt(scale));
    s.gravity = -9;
    s.drag = 0.6;
    fx.fields.spark.spawn(tint(shape(s, rnd(0.35, 0.7), rnd(0.05, 0.085), CURVE.FLASH, 8), color ?? pick(SPARKS)));
  }
}

/** One icon popping up and floating. @param {ParticleField} field @param {Point} p @param {THREE.Color} color @param {number} size */
function icon(field, p, color, size) {
  const s = at(p, 0.15);
  s.vy = 0.22;
  field.spawn(tint(shape(s, 1.6, size * O.scale, CURVE.POP, 5), color));
}

/** Expanding rings on the ground under an effect. @param {Fx} fx @param {Point} p @param {THREE.Color} color @param {number} n */
function groundRings(fx, p, color, n) {
  for (let i = 0; i < n; i++) {
    const s = spawnSpec();
    s.x = p.x;
    s.y = O.ground + 0.03;
    s.z = p.z;
    s.delay = i * 0.35;
    fx.fields.ring.spawn(tint(shape(s, 1.0, 1.0 * O.scale, CURVE.GROW), color));
  }
}

/** @type {Record<string, (fx: Fx, p: Point) => void>} */
const RECIPES = {
  sparks(fx, p) {
    sparkBurst(fx, p, O.scale, O.color);
  },
  smoke(fx, p) {
    for (let i = 0; i < fx.count(7 * O.scale); i++) {
      const s = at(p);
      s.vx = rnd(-0.1, 0.25);
      s.vy = rnd(0.5, 0.9);
      s.vz = rnd(-0.15, 0.15);
      s.delay = i * 0.12;
      fx.fields.puff.spawn(tint(shape(s, rnd(1.8, 2.6), rnd(0.24, 0.4) * O.scale, CURVE.PUFF, 0.6), O.color ?? pick(SMOKE)));
    }
  },
  confetti(fx, p) {
    for (let i = fx.count(70 * O.scale); i > 0; i--) {
      const s = burst(at(p, 0.3), rnd(3, 5.2), 0.55);
      s.gravity = -6;
      s.drag = 1.8;
      fx.fields.flake.spawn(tint(shape(s, rnd(1.8, 2.8), rnd(0.1, 0.15), CURVE.POP, 10), pick(CONFETTI)));
    }
  },
  fireworks(fx, p) {
    const flight = 0.85;
    const apex = p.y + 6 * flight - 3.5 * flight * flight; // where vy = 6 under gravity -7 peaks
    for (let r = Math.max(1, fx.count(3)) - 1; r >= 0; r--) {
      const color = r === 0 && O.color ? O.color : pick(FIREWORKS);
      const ox = p.x + rnd(-0.7, 0.7);
      const oz = p.z + rnd(-0.7, 0.7);
      const rocket = spawnSpec();
      rocket.x = ox;
      rocket.y = p.y;
      rocket.z = oz;
      rocket.vy = 6;
      rocket.gravity = -7;
      rocket.delay = r * 0.35;
      fx.fields.spark.spawn(tint(shape(rocket, flight, 0.08, CURVE.SHRINK), C.rocket));
      for (let i = fx.count(34); i > 0; i--) {
        const s = sphere(spawnSpec(), rnd(2.2, 3.2));
        s.x = ox;
        s.y = apex;
        s.z = oz;
        s.gravity = -2.5;
        s.drag = 1.2;
        s.delay = r * 0.35 + flight;
        fx.fields.spark.spawn(tint(shape(s, rnd(0.9, 1.3), 0.06, CURVE.FLASH), color));
      }
    }
  },
  books(fx, p) {
    for (let i = 0; i < fx.count(6); i++) {
      const s = at(p, -0.2);
      s.orbit = 3.2;
      s.radius = 0.45 * O.scale;
      s.radiusRate = 0.25;
      s.vy = 1.1;
      s.gravity = -1.1;
      s.delay = i * 0.06;
      fx.fields.book.spawn(tint(shape(s, 1.8, 0.28 * O.scale, CURVE.POP, 3), BOOKS[i % BOOKS.length]));
    }
  },
  magnify(fx, p) {
    const s = at(p, 0.25);
    s.vy = 0.15;
    fx.fields.lens.spawn(tint(shape(s, 1.8, 0.6 * O.scale, CURVE.POP, 3), C.lens));
    groundRings(fx, p, C.scan, 2);
  },
  signal(fx, p) {
    for (let i = 0; i < 3; i++) {
      const s = at(p);
      s.delay = i * 0.3;
      fx.fields.ring.spawn(tint(shape(s, 1.1, 1.05 * O.scale, CURVE.GROW), O.color ?? C.signal));
    }
  },
  portal(fx, p) {
    fx.beam(p, O.ground, O.color);
    for (let i = fx.count(26); i > 0; i--) {
      const s = spawnSpec();
      s.x = p.x;
      s.y = O.ground + rnd(0, 0.3);
      s.z = p.z;
      s.orbit = Math.random() < 0.5 ? 5 : -5;
      s.radius = 0.55;
      s.radiusRate = -0.25;
      s.vy = rnd(0.4, 1.4);
      s.delay = Math.random() * 0.4;
      fx.fields.spark.spawn(tint(shape(s, 1.4, 0.05, CURVE.FLASH), O.color ?? pick(PORTAL)));
    }
    groundRings(fx, p, O.color ?? C.ring, 1);
  },
  poof(fx, p) {
    for (let i = fx.count(11 * O.scale); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(1.0, 1.8) * O.scale;
      const s = at(p);
      s.vx = Math.cos(a) * v;
      s.vy = rnd(0.2, 0.8);
      s.vz = Math.sin(a) * v;
      s.drag = 4;
      fx.fields.puff.spawn(tint(shape(s, rnd(0.45, 0.7), rnd(0.14, 0.24) * O.scale, CURVE.PUFF, 2), pick(PUFF)));
    }
  },
  steam(fx, p) {
    for (let i = 0; i < 3; i++) {
      const s = at(p);
      s.vx = rnd(-0.08, 0.08);
      s.vy = rnd(0.35, 0.6);
      s.delay = i * 0.25;
      fx.fields.puff.spawn(tint(shape(s, rnd(1.2, 1.7), rnd(0.07, 0.11) * O.scale, CURVE.GROW, 0.5), C.steam));
    }
  },
  check(fx, p) {
    icon(fx.fields.check, p, O.color ?? C.check, 0.6);
    sparkBurst(fx, p, 0.4, C.checkSpark);
  },
  cross(fx, p) {
    icon(fx.fields.cross, p, O.color ?? C.cross, 0.56);
  },
  hearts(fx, p) {
    for (let i = 0; i < 6; i++) {
      const s = at(p);
      s.vx = rnd(-0.25, 0.25);
      s.vy = rnd(0.5, 0.8);
      s.vz = rnd(-0.1, 0.1);
      s.delay = i * 0.16;
      fx.fields.heart.spawn(tint(shape(s, rnd(1.4, 1.9), rnd(0.22, 0.32) * O.scale, CURVE.POP, 4), O.color ?? pick(HEARTS)));
    }
  },
  zzz(fx, p) {
    for (let i = 0; i < 3; i++) {
      const s = at(p);
      s.x += 0.1;
      s.vx = 0.18;
      s.vy = 0.35;
      s.delay = i * 0.45;
      fx.fields.zee.spawn(tint(shape(s, 1.8, (0.16 + i * 0.06) * O.scale, CURVE.POP, 3), O.color ?? C.zee));
    }
  },
  bulb(fx, p) {
    icon(fx.fields.bulb, p, C.bulb, 0.62);
    _lift.set(p.x, p.y + 0.35, p.z);
    sparkBurst(fx, _lift, 0.5, C.bulbSpark);
  },
  boxes(fx, p) {
    for (let i = fx.count(6 * O.scale); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const v = rnd(0.6, 1.4);
      const s = at(p);
      s.vx = Math.cos(a) * v;
      s.vy = rnd(2.2, 3.4);
      s.vz = Math.sin(a) * v;
      s.gravity = -9;
      s.floor = O.ground;
      fx.fields.crate.spawn(tint(shape(s, rnd(1.8, 2.4), rnd(0.18, 0.28), CURVE.POP, 5), pick(CARDBOARD)));
    }
  },
};
const _lift = new THREE.Vector3();

function createFields(scene) {
  const shapes = createEffectShapes();
  const lit = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ toneMapped: false });
  const puff = new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.92, depthWrite: false });
  const paper = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
  const colored = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
  const coloredGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const rain = new THREE.MeshBasicMaterial({ color: '#5B9BE0', transparent: true, opacity: 0.85 });
  /** @type {[string, THREE.BufferGeometry, THREE.Material, number, ('tumble'|'billboard'|'upright')?][]} */
  const defs = [
    ['spark', shapes.spark, glow, 480],
    ['puff', shapes.puff, puff, 240],
    ['flake', shapes.flake, paper, 320],
    ['book', shapes.book, lit, 48],
    ['crate', shapes.crate, lit, 48],
    ['drop', shapes.drop, rain, 600, 'upright'],
    ['ring', shapes.ring, glow, 40, 'upright'],
    ['heart', shapes.heart, lit, 48, 'billboard'],
    ['zee', shapes.zee, glow, 36, 'billboard'],
    ['check', shapes.check, lit, 16, 'billboard'],
    ['cross', shapes.cross, lit, 16, 'billboard'],
    ['bulb', shapes.bulb, coloredGlow, 12, 'billboard'],
    ['lens', shapes.lens, colored, 12, 'billboard'],
  ];
  /** @type {Record<string, ParticleField>} */
  const fields = {};
  for (const [name, geometry, material, capacity, orient] of defs) {
    fields[name] = new ParticleField({ geometry, material, capacity, orient });
    fields[name].mesh.name = `fx-${name}`;
    scene.add(fields[name].mesh);
  }
  const materials = [lit, glow, puff, paper, colored, coloredGlow, rain];
  return { fields, materials };
}

/** Pooled portal beams (each needs its own material to fade independently). */
function createBeams(scene, size = 4) {
  const geometry = createBeamGeometry();
  const pool = Array.from({ length: size }, () => {
    // Normal (not additive) blending: additive light washes out to white on the pale town.
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.name = 'fx-beam';
    scene.add(mesh);
    return { mesh, material, t: BEAM_SECONDS };
  });
  return {
    /** @param {{x: number, z: number}} p @param {number} ground @param {THREE.Color|null} color */
    start(p, ground, color) {
      const beam = pool.reduce((a, b) => (b.t > a.t ? b : a)); // the oldest (or idle) one
      beam.t = 0;
      beam.mesh.position.set(p.x, ground, p.z);
      beam.material.color.copy(color ?? BEAM_COLOR);
      beam.mesh.visible = true;
    },
    /** @param {number} dt */
    update(dt) {
      for (let i = 0; i < pool.length; i++) {
        const beam = pool[i];
        if (!beam.mesh.visible) continue;
        beam.t += dt;
        const u = beam.t / BEAM_SECONDS;
        if (u >= 1) {
          beam.mesh.visible = false;
          continue;
        }
        beam.material.opacity = Math.min(1, u / 0.15) * Math.min(1, (1 - u) / 0.35);
        const w = 0.7 + 0.3 * Math.sin(beam.t * 9);
        beam.mesh.scale.set(w, 0.6 + 0.4 * Math.min(1, u / 0.2), w);
        beam.mesh.rotation.y += dt * 3;
      }
    },
    dispose() {
      for (const beam of pool) {
        beam.mesh.removeFromParent();
        beam.material.dispose();
      }
      geometry.dispose();
    },
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {{reducedMotion?: boolean, quality?: 'high'|'low'}} [options]
 */
export function createEffects(scene, options = {}) {
  const { fields, materials } = createFields(scene);
  const fieldList = Object.values(fields);
  const beams = createBeams(scene);
  let reducedMotion = Boolean(options.reducedMotion);
  let quality = options.quality ?? 'high';
  /** @type {Fx} */
  const fx = {
    fields,
    count: (n) => Math.max(1, Math.round(n * (quality === 'low' ? 0.6 : 1) * (reducedMotion ? 0.4 : 1))),
    beam: (p, ground, color) => beams.start(p, ground, color),
  };
  return {
    fields,
    /**
     * Plays an effect at a point. Unknown kinds are ignored.
     * @param {string} kind
     * @param {{x: number, y: number, z: number}} p
     * @param {EmitOptions} [opts]
     */
    emit(kind, p, opts) {
      const recipe = Object.prototype.hasOwnProperty.call(RECIPES, kind) ? RECIPES[kind] : null;
      if (!recipe || !Number.isFinite(p?.x) || !Number.isFinite(p?.y) || !Number.isFinite(p?.z)) return;
      O.scale = opts?.scale ?? 1;
      O.ground = opts?.ground ?? 0;
      O.color = opts?.color && parseHex(opts.color) ? _custom.set(opts.color) : null;
      recipe(fx, p);
    },
    /** @param {number} dt @param {number} faceYaw camera yaw, for icons */
    update(dt, faceYaw) {
      for (let i = 0; i < fieldList.length; i++) fieldList[i].update(dt, faceYaw);
      beams.update(dt);
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      reducedMotion = on;
    },
    /** @param {'high'|'low'} q */
    setQuality(q) {
      quality = q;
    },
    clear() {
      for (const name in fields) fields[name].clear();
    },
    dispose() {
      for (const name in fields) {
        fields[name].dispose();
        fields[name].mesh.geometry.dispose();
      }
      for (const m of materials) m.dispose();
      beams.dispose();
    },
  };
}
