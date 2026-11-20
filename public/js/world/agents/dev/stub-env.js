// A minimal stand-in for env/environment.js (CONTRACTS §6.1), for developing the characters
// before or without the real environment: flat ground, the road grid from layout.js, plain boxes
// on the building lots, an orthographic isometric camera, and DOM labels. Lab use only
// (world-lab.html?env=stub, or createWorld(container, { envFactory: createStubEnvironment })).

import * as THREE from 'three';
import { BUILDINGS, BUILDING_KEYS } from '../../../core/catalog.js';
import { COLS, LOTS, MAP, ROWS, TILE, lotBounds, tileToWorld } from '../../layout.js';

const TILE_COLORS = { '#': '#8F8A80', P: '#D9CDB4', '=': '#E6DAC0', '~': '#4FA3C7', F: '#7EC8E3', x: '#E9D9A6', n: '#B8A98A' };
const HEIGHTS = { hall: 4.2, harbor: 2.2, terminal: 3.4, web: 5.2, grove: 0.6, station: 1.6, board: 2.6 };
const ELEVATION = Math.atan(1 / Math.SQRT2); // true isometric
const VIEW_HEIGHT = 30; // world units visible vertically at zoom 1

function buildGround(scene) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * TILE + 8, ROWS * TILE + 8).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#C9D9A0', roughness: 1 }),
  );
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);
  const tile = new THREE.BoxGeometry(TILE, 0.04, TILE);
  for (const [letter, color] of Object.entries(TILE_COLORS)) {
    const cells = [];
    MAP.forEach((row, r) => [...row].forEach((ch, c) => ch === letter && cells.push([c, r])));
    const mesh = new THREE.InstancedMesh(tile, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }), cells.length);
    const m = new THREE.Matrix4();
    cells.forEach(([c, r], i) => {
      const p = tileToWorld(c, r);
      mesh.setMatrixAt(i, m.makeTranslation(p.x, letter === '~' ? -0.05 : 0, p.z));
    });
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function buildTrees(scene) {
  const cells = [];
  // Sparse trees, none along the south edge so the lab's line-up stage stays visible.
  MAP.forEach((row, r) => [...row].forEach((ch, c) => ch === 't' && r < 24 && (c + r) % 2 === 0 && cells.push([c, r])));
  const geo = new THREE.ConeGeometry(0.7, 1.8, 7).translate(0, 0.9, 0);
  const trees = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#5E9E54', flatShading: true }), cells.length);
  const m = new THREE.Matrix4();
  cells.forEach(([c, r], i) => trees.setMatrixAt(i, m.makeTranslation(tileToWorld(c, r).x, 0, tileToWorld(c, r).z)));
  trees.castShadow = true;
  scene.add(trees);
}

/** @param {THREE.Scene} scene */
function buildBuildings(scene) {
  /** @type {Record<string, any>} */
  const buildings = {};
  for (const key of BUILDING_KEYS) {
    const { center, width, depth } = lotBounds(key);
    const height = HEIGHTS[key] ?? 3;
    const material = new THREE.MeshStandardMaterial({ color: '#EADFC8', roughness: 0.85 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width - 0.6, height, depth - 0.6).translate(0, height / 2, 0), material);
    mesh.position.set(center.x, 0, center.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.key = key;
    scene.add(mesh);
    buildings[key] = {
      key,
      center: new THREE.Vector3(center.x, 0, center.z),
      height,
      root: mesh,
      signAnchor: new THREE.Vector3(center.x, height + 0.8, center.z + depth / 2 - 0.3),
      material,
      pulse: 0,
    };
  }
  return buildings;
}

function buildLabels(container, buildings) {
  const root = document.createElement('div');
  root.className = 'tt-stub-labels';
  root.setAttribute('aria-hidden', 'true');
  container.appendChild(root);
  const labels = {};
  for (const key of BUILDING_KEYS) {
    const label = document.createElement('div');
    label.className = 'tt-stub-label';
    label.textContent = `${BUILDINGS[key].icon} ${BUILDINGS[key].name}`;
    root.appendChild(label);
    labels[key] = { el: label, base: label.textContent, at: buildings[key].signAnchor };
  }
  return { root, labels };
}

/** Orthographic camera orbiting a target at a fixed elevation, with eased focus, zoom and 90° turns. */
function createRig() {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  const rig = {
    camera,
    target: new THREE.Vector3(0, 0, 2),
    goal: new THREE.Vector3(0, 0, 2),
    azimuth: Math.PI / 4,
    azimuthGoal: Math.PI / 4,
    zoom: 1,
    zoomGoal: 1,
    /** @type {(() => ({x: number, y: number, z: number}|null))|null} */
    follow: null,
    aspect: 1,
  };
  return rig;
}

/** @param {ReturnType<typeof createRig>} rig @param {number} dt */
function updateRig(rig, dt) {
  if (rig.follow) {
    const p = rig.follow();
    if (p) rig.goal.set(p.x, 0, p.z);
    else rig.follow = null;
  }
  const k = 1 - Math.exp(-6 * dt);
  rig.target.lerp(rig.goal, k);
  rig.azimuth += (rig.azimuthGoal - rig.azimuth) * k;
  rig.zoom += (rig.zoomGoal - rig.zoom) * k;
  const cam = rig.camera;
  const d = 80;
  cam.position.set(
    rig.target.x + Math.sin(rig.azimuth) * Math.cos(ELEVATION) * d,
    rig.target.y + Math.sin(ELEVATION) * d,
    rig.target.z + Math.cos(rig.azimuth) * Math.cos(ELEVATION) * d,
  );
  cam.lookAt(rig.target);
  const h = VIEW_HEIGHT / 2;
  cam.left = -h * rig.aspect;
  cam.right = h * rig.aspect;
  cam.top = h;
  cam.bottom = -h;
  cam.zoom = rig.zoom;
  cam.updateProjectionMatrix();
}

/** Drag to pan, wheel to zoom: just enough to look around while developing. */
function attachControls(canvas, rig) {
  let drag = null;
  const down = (e) => {
    if (e.button === 0) drag = { x: e.clientX, y: e.clientY };
  };
  const move = (e) => {
    if (!drag) return;
    const ppu = (canvas.clientHeight * rig.zoom) / VIEW_HEIGHT;
    const dx = (e.clientX - drag.x) / ppu;
    const dy = (e.clientY - drag.y) / ppu;
    drag = { x: e.clientX, y: e.clientY };
    const s = Math.sin(rig.azimuth);
    const c = Math.cos(rig.azimuth);
    // Screen right is (cos, -sin) on the ground; screen up is (-sin, -cos) scaled by the tilt.
    rig.goal.x += -dx * c - (dy * s) / Math.sin(ELEVATION);
    rig.goal.z += dx * s - (dy * c) / Math.sin(ELEVATION);
    rig.target.copy(rig.goal);
    rig.follow = null;
  };
  const up = () => (drag = null);
  const wheel = (e) => {
    e.preventDefault();
    rig.zoomGoal = THREE.MathUtils.clamp(rig.zoomGoal * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5, 8);
  };
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
  };
}

/** Camera methods of the Env interface, on the stub's rig. @param {ReturnType<typeof createRig>} rig */
function cameraApi(rig) {
  return {
    focus(point, opts = {}) {
      rig.goal.set(point.x, 0, point.z);
      rig.follow = opts.follow ?? null;
      if (Number.isFinite(opts.zoom)) rig.zoomGoal = opts.zoom;
    },
    stopFollow() {
      rig.follow = null;
    },
    resetCamera() {
      rig.goal.set(0, 0, 2);
      rig.azimuthGoal = Math.PI / 4;
      rig.zoomGoal = 1;
      rig.follow = null;
    },
    rotateCamera(dir) {
      rig.azimuthGoal += (dir * Math.PI) / 2;
    },
    zoomBy(f) {
      rig.zoomGoal = THREE.MathUtils.clamp(rig.zoomGoal * f, 0.5, 8);
    },
    /** Screen terms, like the real environment: dx to the right, dz towards the viewer. */
    panBy(dx, dz) {
      const s = Math.sin(rig.azimuth);
      const c = Math.cos(rig.azimuth);
      rig.goal.x += (dx * c + dz * s) / rig.zoomGoal;
      rig.goal.z += (-dx * s + dz * c) / rig.zoomGoal;
      rig.follow = null;
    },
  };
}

/** Named anchors: a portal on the plaza, a bus stop on the ring road, the roof ('top', 'chimney',
 * 'dish', …) or, like the real environment, the door for anything else. */
function anchorFor(buildings, key, name) {
  const b = buildings[key];
  if (!b) return new THREE.Vector3();
  if (name === 'portal') return new THREE.Vector3(tileToWorld(10, 12).x, 0.9, tileToWorld(10, 12).z);
  if (name === 'bus') return new THREE.Vector3(tileToWorld(16, 23).x, 0.9, tileToWorld(16, 23).z);
  if (['top', 'chimney', 'dish', 'steam', 'cup'].includes(name)) return new THREE.Vector3(b.center.x, b.height + 0.3, b.center.z);
  const door = tileToWorld(LOTS[key].door[0], LOTS[key].door[1]);
  return new THREE.Vector3(door.x, 1, door.z - 0.8);
}

/** Building methods of the Env interface (most are no-ops in the stub). */
function buildingApi(buildings, labels, state) {
  const targets = Object.values(buildings).map((b) => b.root);
  return {
    buildings,
    anchor: (key, name) => anchorFor(buildings, key, name),
    pickBuilding(raycaster) {
      const hit = raycaster.intersectObjects(targets, false)[0];
      return hit ? hit.object.userData.key : null;
    },
    highlightBuilding(key) {
      state.highlighted = key;
    },
    setBuildingStat(key, text) {
      const label = labels.labels[key];
      if (label) label.el.textContent = text ? `${label.base} · ${text}` : label.base;
    },
    pulseBuilding(key) {
      if (buildings[key]) buildings[key].pulse = 0.8;
    },
    setBoard() {},
    setNodeModules() {},
    addWorktree() {},
    removeWorktree() {},
    vehicle() {},
  };
}

function setupLights(scene, renderer, quality) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const hemi = new THREE.HemisphereLight('#ffffff', '#b9a98a', 1.6);
  const sun = new THREE.DirectionalLight('#fff1dc', 2.4);
  sun.position.set(14, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 });
  sun.shadow.bias = -0.0005;
  scene.add(hemi, sun);
}

/**
 * @param {{renderer: THREE.WebGLRenderer, container: HTMLElement, quality: 'high'|'low', reducedMotion: boolean,
 *   onSelectBuilding?: (key: string) => void}} args
 */
export function createStubEnvironment({ renderer, container, quality }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#BFE3F2');
  setupLights(scene, renderer, quality);
  buildGround(scene);
  buildTrees(scene);
  const buildings = buildBuildings(scene);
  const labels = buildLabels(container, buildings);
  const rig = createRig();
  const detach = attachControls(renderer.domElement, rig);
  const state = { highlighted: null, timeOfDay: 12, width: 1, height: 1 };
  const v = new THREE.Vector3();

  function placeLabels() {
    for (const key of BUILDING_KEYS) {
      const { el, at } = labels.labels[key];
      v.copy(at).project(rig.camera);
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * state.width}px, ${((1 - v.y) / 2) * state.height}px)`;
    }
  }

  return {
    scene,
    camera: rig.camera,
    ...cameraApi(rig),
    ...buildingApi(buildings, labels, state),
    update(dt) {
      updateRig(rig, dt);
      for (const b of Object.values(buildings)) {
        b.pulse = Math.max(0, b.pulse - dt);
        const lit = b.key === state.highlighted ? 0.25 : 0;
        b.material.emissive.setRGB(lit + b.pulse * 0.6, lit + b.pulse * 0.5, lit * 0.6);
      }
      placeLabels();
    },
    render() {
      renderer.render(scene, rig.camera);
    },
    resize(w, h) {
      state.width = w;
      state.height = h;
      rig.aspect = w / h;
    },
    setQuality(q) {
      renderer.shadowMap.enabled = q === 'high';
    },
    setReducedMotion() {},
    setTimeOfDay(h) {
      state.timeOfDay = h === 'auto' ? new Date().getHours() : h;
    },
    getTimeOfDay: () => state.timeOfDay,
    dispose() {
      detach();
      labels.root.remove();
      scene.traverse((o) => {
        const mesh = /** @type {THREE.Mesh} */ (o);
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      });
    },
  };
}
