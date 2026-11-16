// World lab (public/world-lab.html): drives the World facade by hand or by scenario, with a
// live fps / draw-call readout. URL parameters:
//   env=stub            use the stub environment instead of env/environment.js
//   scenario=<name>     lineup | activities | bubbles | effects | crowd | queue | weather | entrances
//   zoom=<factor>       zoom applied by the scenario's close-up
//   at=<n>              which of the scenario's agents the close-up centres on
//   face=back|north     line-ups turn away from the camera, or face north as agents at work do
//   panel=0             hide the control panel (clean screenshots)
//   quality=high|low    force a render quality
//   time=<hour>         fixed time of day (0–24) instead of the local clock
//   select=<n>          select the scenario's n-th agent (shows the selection ring)

import { createWorld } from '../world.js';
import { BUILDING_KEYS, CREW_COLORS } from '../../core/catalog.js';
import { ACTIVITY_NAMES } from '../agents/activities.js';
import { EFFECT_KINDS } from '../agents/effects.js';
import { HATS } from '../agents/looks.js';
import { createStubEnvironment } from '../agents/dev/stub-env.js';
import { SCENARIOS, TEMPLATES, chaos } from './scenarios.js';
import { button, checkbox, section, select, slider, textInput } from './panel.js';

const params = new URLSearchParams(location.search);

/** Uses the real environment when it loads, the stub otherwise (or when asked). */
async function environmentFactory() {
  if (params.get('env') === 'stub') return createStubEnvironment;
  try {
    await import('../env/environment.js');
    return undefined; // createWorld's default
  } catch (err) {
    console.warn('Real environment unavailable, using the stub:', err);
    return createStubEnvironment;
  }
}

/** @param {any} world */
function createLab(world) {
  /** @type {number[]} */
  const timers = [];
  let counter = 0;
  const zoom = Number(params.get('zoom'));
  const at = Number.parseInt(params.get('at') ?? '', 10);
  const lab = {
    world,
    /** @type {string[]} */
    ids: [],
    /** @type {string|null} */
    selected: null,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : null,
    at: Number.isInteger(at) && at >= 0 ? at : null,
    face: params.get('face'),
    /** @param {string} template @param {object} [overrides] */
    spawn(template, overrides = {}) {
      const id = `lab:${template}-${++counter}`;
      const base = TEMPLATES[template] ?? TEMPLATES.builder;
      world.addAgent({ id, color: CREW_COLORS[counter % CREW_COLORS.length], ...base, ...overrides, name: overrides.name ?? `${base.name}${template === 'foreman' ? '' : ` ${counter}`}` });
      lab.ids.push(id);
      return id;
    },
    /** @param {string} id @param {string} exit */
    remove(id, exit) {
      lab.ids = lab.ids.filter((x) => x !== id);
      if (lab.selected === id) lab.selected = null;
      return world.removeAgent(id, { exit });
    },
    /** @param {string} id @param {number} x @param {number} z @param {number} [yaw] */
    place: (id, x, z, yaw) => world.debugPlace(id, x, z, yaw),
    /** @param {number} ms @param {() => void} fn */
    every: (ms, fn) => void timers.push(window.setInterval(fn, ms)),
    /** @param {number} ms @param {() => void} fn */
    after: (ms, fn) => void timers.push(window.setTimeout(fn, ms)),
    /** The selected agent, or the newest one. */
    target: () => lab.selected ?? lab.ids.at(-1) ?? null,
  };
  world.on('select', (sel) => {
    lab.selected = sel?.type === 'agent' ? sel.id : null;
  });
  return lab;
}

/** @param {HTMLElement} panel @param {ReturnType<typeof createLab>} lab */
function spawnControls(panel, lab) {
  const row = section(panel, 'Spawn');
  const entrance = select(row, 'Entrance', ['pop', 'portal', 'bus', 'none']);
  const hat = select(row, 'Hat', ['auto', ...HATS]);
  for (const template of Object.keys(TEMPLATES)) {
    button(row, TEMPLATES[template].name, () => {
      lab.selected = lab.spawn(template, { entrance: entrance.value, ...(hat.value === 'auto' ? {} : { hat: hat.value }) });
    });
  }
  const chaosRow = section(panel, 'Crowd');
  button(chaosRow, 'Chaos: 20 wanderers', () => chaos(lab, 20), 'Spawns 20 agents that wander between buildings');
}

/** @param {HTMLElement} panel @param {ReturnType<typeof createLab>} lab */
function movementControls(panel, lab) {
  const row = section(panel, 'Go to (selected or newest)');
  const pace = select(row, 'Pace', ['walk', 'run', 'teleport']);
  for (const key of BUILDING_KEYS) button(row, key, () => lab.target() && lab.world.goTo(lab.target(), key, { pace: pace.value }));
  const acts = section(panel, 'Activity');
  for (const activity of ACTIVITY_NAMES) button(acts, activity, () => lab.world.setActivity(lab.target(), activity));
  const status = section(panel, 'Status');
  for (const s of ['working', 'waiting', 'idle', 'error', 'done']) button(status, s, () => lab.world.setStatus(lab.target(), s));
}

/** @param {HTMLElement} panel @param {ReturnType<typeof createLab>} lab */
function chatterControls(panel, lab) {
  const row = section(panel, 'Say');
  const text = textInput(row, 'Text', 'Reading src/auth/login.ts');
  for (const tone of ['speech', 'thought', 'shout', 'code']) button(row, tone, () => lab.world.say(lab.target(), text.value, { tone }));
  const emotes = section(panel, 'Emote and badge');
  for (const e of ['🎉', '💡', '😅', '🔥', '✅', '🤔']) button(emotes, e, () => lab.world.emote(lab.target(), e), `Emote ${e}`);
  button(emotes, 'Badge ×4', () => lab.world.setBadge(lab.target(), '×4'));
  button(emotes, 'Clear badge', () => lab.world.setBadge(lab.target(), null));
}

/** @param {HTMLElement} panel @param {ReturnType<typeof createLab>} lab */
function effectControls(panel, lab) {
  const row = section(panel, 'Effects');
  const where = select(row, 'On', ['agent', ...BUILDING_KEYS]);
  for (const kind of EFFECT_KINDS) {
    button(row, kind, () => lab.world.effect(kind, where.value === 'agent' ? { agent: lab.target() } : { building: where.value }));
  }
  const weather = section(panel, 'Weather and mail');
  button(weather, 'Rain', () => lab.world.weather(lab.target(), 'rain'));
  button(weather, 'Storm', () => lab.world.weather(lab.target(), 'storm'));
  button(weather, 'Clear sky', () => lab.world.weather(lab.target(), null));
  button(weather, 'Plane to an agent', () => {
    const others = lab.ids.filter((id) => id !== lab.target());
    if (others.length) lab.world.sendMessage(lab.target(), { agent: others[Math.floor(Math.random() * others.length)] });
  });
  button(weather, 'Plane to Post Office', () => lab.world.sendMessage(lab.target(), { building: 'post' }));
  const exits = section(panel, 'Remove');
  for (const exit of ['poof', 'portal', 'bus']) button(exits, `Exit by ${exit}`, () => lab.target() && lab.remove(lab.target(), exit));
}

/** @param {HTMLElement} panel @param {ReturnType<typeof createLab>} lab */
function viewControls(panel, lab) {
  const w = lab.world;
  const row = section(panel, 'Camera');
  button(row, 'Rotate left', () => w.rotateCamera(-1));
  button(row, 'Rotate right', () => w.rotateCamera(1));
  button(row, 'Zoom in', () => w.zoomBy(1.25));
  button(row, 'Zoom out', () => w.zoomBy(0.8));
  button(row, 'Follow selected', () => lab.target() && w.focusAgent(lab.target(), { follow: true }));
  button(row, 'Reset', () => w.resetCamera());
  const render = section(panel, 'Rendering');
  button(render, 'High quality', () => w.setQuality('high'));
  button(render, 'Low quality', () => w.setQuality('low'));
  checkbox(render, 'Reduced motion', (on) => w.setReducedMotion(on));
  checkbox(render, 'Paused', (on) => w.setPaused(on));
  slider(render, 'Time of day', { min: 0, max: 24, step: 0.5, value: 12 }, (h) => w.setTimeOfDay(h));
}

/** @param {HTMLElement} panel @param {any} world */
function readout(panel, world) {
  const out = document.createElement('p');
  out.className = 'tt-lab__readout';
  out.setAttribute('aria-live', 'off');
  panel.prepend(out);
  window.setInterval(() => {
    const s = world.stats();
    out.textContent = `${s.fps} fps · ${s.drawCalls} draw calls · ${s.agents} agents`;
  }, 500);
}

async function main() {
  const container = /** @type {HTMLElement} */ (document.getElementById('world'));
  const panel = /** @type {HTMLElement} */ (document.getElementById('lab-panel'));
  if (params.get('panel') === '0') document.body.classList.add('tt-lab--bare');
  const quality = params.get('quality');
  const hour = Number.parseFloat(params.get('time') ?? '');
  let world;
  try {
    world = await createWorld(container, {
      quality: quality === 'high' || quality === 'low' ? quality : 'auto',
      timeOfDay: Number.isFinite(hour) ? hour : 'auto',
      envFactory: await environmentFactory(),
    });
  } catch (err) {
    const message = document.getElementById('lab-error');
    message.hidden = false;
    message.textContent = `The world could not start: ${err?.message ?? err}`;
    return;
  }
  const lab = createLab(world);
  readout(panel, world);
  spawnControls(panel, lab);
  movementControls(panel, lab);
  chatterControls(panel, lab);
  effectControls(panel, lab);
  viewControls(panel, lab);
  const scenario = SCENARIOS[params.get('scenario') ?? ''];
  if (scenario) scenario(lab);
  const selectIndex = Number.parseInt(params.get('select') ?? '', 10);
  if (Number.isInteger(selectIndex) && lab.ids[selectIndex]) {
    lab.selected = lab.ids[selectIndex];
    world.select({ type: 'agent', id: lab.selected });
  }
  // For debugging and screenshots (holds no secrets).
  Object.assign(window, { __lab: lab });
}

main();
