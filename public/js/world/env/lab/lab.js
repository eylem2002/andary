// Environment lab: renders the environment on its own with controls for every feature, plus URL
// parameters for screenshots, e.g. world-env-lab.html?t=21&q=low&panel=0&focus=hall&zoom=2.5
//   t      hour 0–24 or "auto"        q      high | low          rm     1 = reduced motion
//   panel  0 hides the controls       focus  building key        zoom   camera zoom (1 = town)
//   rot    quarter turns             board  1 = sample goals    nm     node_modules level 0–5
//   wt     number of sample worktrees stats 1 = sample sign stats  veh  bus | boat | mailtruck
//   warm   seconds to pre-simulate before the first frame (settles animations for screenshots)
//   hl     building key to highlight     pulse  building key to pulse
import * as THREE from 'three';
import { BUILDINGS, BUILDING_KEYS } from '../../../core/catalog.js';
import { createEnvironment } from '../environment.js';
import { buildPanel } from './panel.js';

/**
 * ?weather= presets for looking at the town's weather.
 * @type {Readonly<Record<string, import('../../../core/town-weather.js').TownWeather>>}
 */
const WEATHERS = Object.freeze({
  rain: { kind: 'rain', rain: 0.7, overcast: 0.7, fog: 0, rainbow: 0, storm: false },
  storm: { kind: 'storm', rain: 1, overcast: 1, fog: 0, rainbow: 0, storm: true },
  fog: { kind: 'fog', rain: 0, overcast: 0.4, fog: 0.8, rainbow: 0, storm: false },
  rainbow: { kind: 'rainbow', rain: 0, overcast: 0, fog: 0, rainbow: 1, storm: false },
});

const params = new URLSearchParams(location.search);
const container = /** @type {HTMLElement} */ (document.getElementById('world'));
const panelRoot = /** @type {HTMLElement} */ (document.getElementById('lab-panel'));

/** @type {import('../board-text.js').BoardItem[]} */
const SAMPLE_BOARD = [
  { text: 'Read the failing test output and find the root cause', status: 'completed' },
  { text: 'Fix token refresh in src/auth/session.ts', status: 'completed' },
  { text: 'Add a regression test for expired refresh tokens', status: 'in_progress' },
  { text: 'Run the full suite and lint', status: 'pending' },
  { text: 'Write the changelog entry', status: 'pending' },
];
const SAMPLE_STATS = { library: '42 reads', terminal: '17 runs', workshop: '9 edits', detective: '23 greps', web: '3 fetches', hall: '2 crews' };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.domElement.classList.add('env-lab__canvas');
container.append(renderer.domElement);

const status = document.createElement('p');
const hourParam = params.get('t');
const env = createEnvironment({
  renderer,
  container,
  quality: params.get('q') === 'low' ? 'low' : 'high',
  reducedMotion: params.get('rm') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches,
  timeOfDay: hourParam == null || hourParam === 'auto' ? 'auto' : Number(hourParam),
  onSelectBuilding: (key) => {
    status.textContent = `Selected ${BUILDINGS[key].name}`;
    env.focus(env.buildings[key].center, { zoom: 2.4 });
    env.pulseBuilding(key);
  },
});

const resize = () => env.resize(container.clientWidth, container.clientHeight);
new ResizeObserver(resize).observe(container);
resize();

applyUrlScenario();
// Screenshots: software rendering runs at a few frames per second, so pre-simulate N seconds to
// show animations (bus arrivals, growing trees, falling boxes) in their settled state.
const warm = Math.min(120, Number(params.get('warm') ?? 0));
for (let t = 0; t < warm; t += 0.1) env.update(0.1, t);
const readout = buildPanel(panelRoot, env, { samples: { board: SAMPLE_BOARD, stats: SAMPLE_STATS }, status });
if (params.get('panel') === '0') document.body.classList.add('env-lab--clean');

let last = performance.now();
let elapsed = 0;
let frames = 0;
let fpsClock = 0;
/** @param {number} now */
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  elapsed += dt;
  env.update(dt, elapsed);
  env.render();
  frames++;
  fpsClock += dt;
  if (fpsClock >= 0.5) {
    readout(Math.round(frames / fpsClock), renderer.info.render.calls, renderer.info.render.triangles);
    frames = 0;
    fpsClock = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function applyUrlScenario() {
  applyCameraParams();
  applyFeatureParams();
  applyEffectParams();
}

/** @param {string|null} value */
function isBuilding(value) {
  return value != null && BUILDING_KEYS.includes(/** @type {any} */ (value));
}

function applyCameraParams() {
  const rot = Number(params.get('rot') ?? 0);
  for (let i = 0; i < Math.abs(rot); i++) env.rotateCamera(rot > 0 ? 1 : -1);
  const focus = params.get('focus');
  const zoom = Number(params.get('zoom') ?? Number.NaN);
  if (isBuilding(focus)) {
    env.focus(env.buildings[/** @type {import('../../../core/catalog.js').BuildingKey} */ (focus)].center, { zoom: Number.isFinite(zoom) ? zoom : 2.5 });
  } else if (Number.isFinite(zoom)) {
    env.zoomBy(zoom);
  }
}


function applyFeatureParams() {
  if (params.get('board') === '1') env.setBoard(SAMPLE_BOARD, 'Fix the login bug');
  if (params.has('nm')) env.setNodeModules(Number(params.get('nm')));
  const worktrees = Number(params.get('wt') ?? 0);
  const names = ['main', 'feature/login', 'fix/flaky-test', 'docs/readme', 'perf/cache'];
  for (let i = 0; i < worktrees; i++) env.addWorktree(`wt-${i}`, names[i % names.length]);
  if (params.get('stats') === '1') for (const [key, text] of Object.entries(SAMPLE_STATS)) env.setBuildingStat(/** @type {any} */ (key), text);
  const name = params.get('weather') ?? '';
  const weather = Object.hasOwn(WEATHERS, name) ? WEATHERS[name] : null;
  if (weather) env.setWeather(weather);
}


function applyEffectParams() {
  const highlight = params.get('hl');
  if (isBuilding(highlight)) env.highlightBuilding(/** @type {any} */ (highlight));
  const pulse = params.get('pulse');
  if (isBuilding(pulse)) env.pulseBuilding(/** @type {any} */ (pulse), '#2457d6');
  const veh = params.get('veh');
  if (veh === 'bus' || veh === 'boat' || veh === 'mailtruck') env.vehicle(veh, veh === 'mailtruck' ? 'trip' : 'arrive');
}

Object.assign(window, { __envLab: { env, renderer } });
