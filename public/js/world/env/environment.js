// The 3D environment of Andary (CONTRACTS.md §6.1): terrain, sea, buildings, props, vehicles,
// sky and day/night, post-processing, the camera rig and the building signs. The world facade owns
// the renderer and the frame loop and calls update() then render() every frame.
import * as THREE from 'three';
import { BUILDING_KEYS } from '../../core/catalog.js';
import { createAmbient } from './ambient.js';
import { createAtmosphere } from './atmosphere.js';
import { createTownWeatherFx } from './town-weather-fx.js';
import { createLandmarks } from './landmarks.js';
import { GeometryBatch } from './batch.js';
import { createBoard } from './board.js';
import { createBuildingFx } from './building-fx.js';
import { buildBuildings } from './buildings/index.js';
import { createHomes } from './buildings/homes.js';
import { createClockHands } from './buildings/civic.js';
import { createCameraRig } from './camera-rig.js';
import { createGrove } from './grove.js';
import { Kit } from './kit.js';
import { createLighting } from './lighting.js';
import { createParkLife } from './park-life.js';
import { createPile } from './node-modules.js';
import { createPost } from './post.js';
import { buildProps } from './props.js';
import { createSigns } from './signs.js';
import { createBackdrop, createSkyEnvironment } from './sky.js';
import { buildTerrain } from './terrain.js';
import { createTownMaterial, createTownUniforms } from './town-material.js';
import { createTrees } from './trees.js';
import { createVehicles } from './vehicles.js';
import { LOOK } from '../../page.js';
import { createSea } from './water.js';

/** @typedef {import('../../core/catalog.js').BuildingKey} BuildingKey */

/**
 * @typedef {object} EnvOptions
 * @property {THREE.WebGLRenderer} renderer
 * @property {HTMLElement} container
 * @property {'auto'|'high'|'low'} [quality]
 * @property {boolean} [reducedMotion]
 * @property {number|'auto'} [timeOfDay]  not in §6.1's signature, but handy: the initial hour
 * @property {(key: BuildingKey) => void} [onSelectBuilding]
 */

/**
 * @param {EnvOptions} options
 */
export function createEnvironment(options) {
  const core = createCore(options);
  const features = createFeatures(core, options);
  core.applyQuality(resolveQuality(options.quality));
  const env = createApi(core, features);
  if (options.reducedMotion) env.setReducedMotion(true);
  return env;
}

/**
 * Scene, materials, static town, camera, lights, sky and post-processing.
 * @param {EnvOptions} options
 */
function createCore(options) {
  const { renderer, container } = options;
  const scene = new THREE.Scene();
  scene.name = 'andary';
  const town = createTownUniforms();
  const materials = {
    static: createTownMaterial(town, { bounce: true, name: 'static' }),
    dynamic: createTownMaterial(town, { name: 'dynamic' }),
    foliage: createTownMaterial(town, { sway: true, name: 'foliage' }),
  };
  /** @type {Array<(dt: number, t: number) => void>} */
  const animators = [];
  const world = buildWorld(scene, town, materials, animators);
  const rig = createCameraRig({ container, reducedMotion: !!options.reducedMotion });
  const post = createPost(renderer, scene, rig.camera);
  const lighting = createLighting(scene);
  const backdrop = createBackdrop();
  scene.add(backdrop);
  const clockHands = createClockHands(world.records.academy.lot, materials.dynamic);
  scene.add(clockHands.mesh);
  /** @type {Array<(state: import('./daynight.js').SkyState) => void>} */
  const skyListeners = [(state) => clockHands.set(state.hour), (state) => world.props.setNight(state.night)];
  const atmosphere = createAtmosphere(
    { renderer, scene, lighting, backdrop, skyEnv: createSkyEnvironment(renderer), town, post, onChange: (state) => skyListeners.forEach((fn) => fn(state)) },
    options.timeOfDay ?? 'auto',
  );
  const view = { width: 1, height: 1, quality: /** @type {'high'|'low'} */ ('high'), reduced: !!options.reducedMotion };
  renderer.info.autoReset = false;

  /** @param {'high'|'low'} q */
  function applyQuality(q) {
    view.quality = q;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const shadows = q === 'high';
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      // Shadow support is compiled into the shaders, so every material must rebuild.
      scene.traverse((obj) => {
        const mat = /** @type {any} */ (obj).material;
        if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) m.needsUpdate = true;
      });
    }
    lighting.setShadows(shadows);
    const ratio = q === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    post.setQuality(q);
    post.resize(view.width, view.height);
  }

  return { renderer, container, scene, town, materials, animators, world, rig, post, lighting, atmosphere, skyListeners, view, applyQuality };
}

/**
 * Interactive features layered on the town: signs, highlights and pulses, the goal board, the
 * node_modules pile, the worktree grove, vehicles and ambient life.
 * @param {ReturnType<typeof createCore>} core
 * @param {EnvOptions} options
 */
function createFeatures(core, options) {
  const { scene, town, materials, world, container } = core;
  const reduced = core.view.reduced;
  const signs = createSigns({ container, records: world.records, onSelect: options.onSelectBuilding });
  for (const label of world.props.labels) signs.addLabel(label);
  const board = createBoard({ record: world.records.board, scene });
  core.skyListeners.push((state) => board.setNight(state.night));
  board.setNight(town.uTtNight.value);
  const flash = { level: 0 };
  const weather = createTownWeatherFx({ scene, camera: core.rig.camera, reducedMotion: reduced, flash: (strength) => (flash.level = Math.max(flash.level, strength)) });
  core.skyListeners.push((state) => weather.setNight(state.night));
  weather.setNight(town.uTtNight.value);
  return {
    weather,
    flash,
    landmarks: createLandmarks({ scene, material: materials.dynamic, records: world.records, reducedMotion: reduced }),
    signs,
    board,
    fx: createBuildingFx({ scene, town, records: world.records, reducedMotion: reduced }),
    pile: createPile({ scene, material: materials.dynamic, reducedMotion: reduced, signs }),
    grove: createGrove({ scene, material: materials.foliage, record: world.records.grove, signs, reducedMotion: reduced }),
    vehicles: createVehicles({ scene, material: materials.dynamic, records: world.records, reducedMotion: reduced }),
    ambient: createAmbient({ scene, town, material: materials.dynamic, records: world.records, reducedMotion: reduced }),
    parkLife: createParkLife({ scene, town, material: materials.dynamic, reducedMotion: reduced }),
    homes: createHomes({ scene, material: materials.static, signs, townLook: LOOK }),
  };
}

/**
 * The Env object handed to the facade.
 * @param {ReturnType<typeof createCore>} core
 * @param {ReturnType<typeof createFeatures>} f
 */
function createApi(core, f) {
  const { renderer, scene, town, world, rig, post, atmosphere, view } = core;
  /** @param {unknown} key */
  const record = (key) => (BUILDING_KEYS.includes(/** @type {BuildingKey} */ (key)) ? world.records[/** @type {BuildingKey} */ (key)] : null);
  const movers = [f.fx, f.pile, f.grove, f.vehicles, f.ambient, f.parkLife, f.signs, f.weather, f.landmarks];
  return {
    scene,
    camera: rig.camera,
    buildings: world.publicBuildings,
    /** @param {number} dt seconds since the last frame @param {number} elapsed seconds since start */
    update(dt, elapsed) {
      const step = Math.min(Math.max(dt || 0, 0), 0.1);
      // Shader time (water, sway, blinking) runs slower with reduced motion; accumulated so
      // toggling the setting never makes it jump.
      town.uTtTime.value += step * (view.reduced ? 0.4 : 1);
      atmosphere.update(step);
      rig.update(step);
      for (let i = 0; i < core.animators.length; i++) core.animators[i](step, elapsed);
      f.fx.update(step);
      f.pile.update(step, elapsed);
      f.grove.update(step);
      f.vehicles.update(step, elapsed);
      f.ambient.update(step, elapsed);
      f.parkLife.update(step, elapsed);
      f.board.update();
      f.signs.update(rig.camera, view.width, view.height, rig.zoom);
      f.weather.update(step);
      f.landmarks.update(step);
      // A lightning flash brightens the whole picture for a moment.
      f.flash.level = Math.max(0, f.flash.level - step * 7);
      renderer.toneMappingExposure = 1.1 + f.flash.level * 1.4;
    },
    /** Renders the scene; renderer.info then holds this frame's totals (shadow and post passes included). */
    render() {
      renderer.info.reset();
      post.render(1 / 60);
    },
    /** @param {number} width @param {number} height */
    resize(width, height) {
      view.width = Math.max(1, Math.floor(width));
      view.height = Math.max(1, Math.floor(height));
      renderer.setSize(view.width, view.height, false);
      rig.resize(view.width, view.height);
      post.resize(view.width, view.height);
    },
    /** @param {'auto'|'high'|'low'} q */
    setQuality: (q) => {
      core.applyQuality(resolveQuality(q));
      f.weather.setQuality(view.quality);
    },
    /**
     * Builds the landmarks the town has earned (core/growth.js); grow: new ones rise into place.
     * @param {string[]} ids @param {{ grow?: boolean }} [options]
     */
    setLandmarks: (ids, options) => f.landmarks.set(ids, options),
    /** @param {import('../../core/town-weather.js').TownWeather} w */
    setWeather(w) {
      atmosphere.setWeather(w);
      f.weather.set(w);
      f.parkLife.setWeather(w);
    },
    /** @param {boolean} on */
    setReducedMotion(on) {
      view.reduced = !!on;
      town.uTtSway.value = view.reduced ? 0.25 : 1;
      rig.setReducedMotion(view.reduced);
      for (const m of movers) m.setReducedMotion(view.reduced);
    },
    /** @param {number|'auto'} h */
    setTimeOfDay: (h) => atmosphere.set(h),
    getTimeOfDay: () => atmosphere.hour,
    focus: rig.focus,
    stopFollow: rig.stopFollow,
    resetCamera: rig.reset,
    rotateCamera: rig.rotate,
    zoomBy: rig.zoomBy,
    panBy: rig.panBy,
    /**
     * Named effect anchor of a building (a fresh vector, safe to keep). Unknown names fall back
     * to the door anchor.
     * @param {BuildingKey} key @param {string} [name]
     */
    anchor(key, name) {
      const r = record(key);
      if (!r) return new THREE.Vector3();
      return (r.anchors[name ?? 'door'] ?? r.anchors.door).clone();
    },
    /** @param {THREE.Raycaster} raycaster */
    pickBuilding: (raycaster) => pickBuilding(world.records, raycaster),
    /** The selected building: lit up, and its label shows its name. @param {BuildingKey|null} key */
    highlightBuilding(key) {
      const k = record(key) ? key : null;
      f.fx.highlight(k);
      f.signs.setSelected(k);
    },
    /** The building under the pointer in the 3D view: its label shows its name. @param {BuildingKey|null} key */
    hoverBuilding: (key) => f.signs.setHovered(record(key) ? key : null),
    /** How place labels show: 'auto' (names that fit), 'always' or 'off'. @param {'auto'|'always'|'off'} mode */
    setPlaceNames: (mode) => f.signs.setMode(mode),
    /** @param {BuildingKey} key @param {string|null} text */
    setBuildingStat(key, text) {
      if (record(key)) f.signs.setStat(key, text);
    },
    /** @param {BuildingKey} key @param {string} [color] */
    pulseBuilding(key, color) {
      if (record(key)) f.fx.pulse(key, color);
    },
    /** @param {{text: string, status: 'pending'|'in_progress'|'completed'}[]} items @param {string} [title] */
    setBoard: (items, title) => f.board.set(items, title),
    /** @param {number} level 0–5 */
    setNodeModules: (level) => f.pile.setLevel(level),
    /** @param {string} id @param {string} label */
    addWorktree: (id, label) => f.grove.add(id, label),
    /** @param {string} id */
    removeWorktree: (id) => f.grove.remove(id),
    /**
     * Who lives in a home of the residential quarter (buildings/homes.js); null: nobody.
     * @param {number} slot @param {import('./buildings/homes.js').Home|null} home
     */
    setHome: (slot, home) => f.homes.set(slot, home),
    /** @param {'mailtruck'|'boat'|'bus'} kind @param {'arrive'|'depart'|'trip'} [action] */
    vehicle: (kind, action) => f.vehicles.trigger(kind, action ?? 'trip'),
    /**
     * How vehicles see people: the facade passes the crowd's query in (env/ cannot import agents/).
     * @param {(x: number, z: number, reach: number) => boolean} occupied
     */
    setPedestrians: (occupied) => f.vehicles.setPedestrians(occupied),
    /**
     * Where the agents are on screen, so place labels make way for them; from the facade, like
     * setPedestrians.
     * @param {() => ReadonlyArray<{x: number, y: number, feet: number, half: number}>} figures
     */
    setFigures: (figures) => f.signs.setFigures(figures),
    dispose() {
      rig.dispose();
      for (const part of [f.signs, f.fx, f.board, f.pile, f.grove, f.vehicles, f.ambient, f.parkLife, f.homes, atmosphere, core.lighting]) part.dispose();
      post.dispose();
      disposeScene(scene);
      renderer.info.autoReset = true;
    },
  };
}

/**
 * Builds the static town (one merged mesh), trees, props and the sea.
 * @param {THREE.Scene} scene
 * @param {import('./town-material.js').TownUniforms} town
 * @param {Record<string, THREE.Material>} materials
 * @param {Array<(dt: number, t: number) => void>} animators
 */
function buildWorld(scene, town, materials, animators) {
  const batch = new GeometryBatch(65536);
  const kit = new Kit(batch);
  /** @type {import('./trees.js').TreePlacement[]} */
  const trees = [];
  buildTerrain(kit);
  const records = buildBuildings(kit, { scene, materials, town, trees, animators });
  const props = buildProps(kit, { scene, town, trees });
  const town3d = new THREE.Mesh(batch.build(), materials.static);
  town3d.name = 'town-static';
  town3d.castShadow = true;
  town3d.receiveShadow = true;
  scene.add(town3d);
  kit.dispose();
  scene.add(createTrees(trees, materials.foliage));
  scene.add(createSea(town, props.pierRect));
  /** @type {Record<string, {key: string, center: THREE.Vector3, height: number, root: THREE.Object3D, signAnchor: THREE.Vector3}>} */
  const publicBuildings = {};
  for (const [key, r] of Object.entries(records)) {
    publicBuildings[key] = { key, center: r.center, height: r.height, root: r.root, signAnchor: r.signAnchor };
  }
  return { records, props, publicBuildings };
}

const _hit = new THREE.Vector3();

/**
 * Nearest building whose pick box the ray hits.
 * @param {Record<string, import('./buildings/index.js').BuildingRecord>} records
 * @param {THREE.Raycaster} raycaster
 * @returns {BuildingKey|null}
 */
function pickBuilding(records, raycaster) {
  let best = null;
  let bestDistance = Infinity;
  for (const r of Object.values(records)) {
    if (!raycaster.ray.intersectBox(r.pickBox, _hit)) continue;
    const d = _hit.distanceTo(raycaster.ray.origin);
    if (d < bestDistance) {
      bestDistance = d;
      best = r.key;
    }
  }
  return best;
}

/** @param {'auto'|'high'|'low'|undefined} q @returns {'high'|'low'} */
function resolveQuality(q) {
  return q === 'low' ? 'low' : 'high';
}

/**
 * Frees every geometry, material and texture still in the scene.
 * @param {THREE.Object3D} root
 */
function disposeScene(root) {
  const seen = new Set();
  root.traverse((obj) => {
    const any = /** @type {any} */ (obj);
    if (any.geometry && !seen.has(any.geometry)) {
      seen.add(any.geometry);
      any.geometry.dispose();
    }
    const mats = any.material ? (Array.isArray(any.material) ? any.material : [any.material]) : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const value of Object.values(m)) if (value && /** @type {any} */ (value).isTexture) /** @type {any} */ (value).dispose();
      m.dispose();
    }
  });
}
