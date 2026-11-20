// Boot. Picks live mode (an Andary server answered /api/hello) or demo mode (the built-in
// simulation; forced with ?demo=1), then wires store → director → 3D world, and the HUD around it.
// The HUD is built first so the page is useful even while the world loads or if WebGL is missing.
//
// URL options:
//   demo=1        force the demo, even with a server running
//   speed=1|2|4   demo speed for this visit
//   seed=N        demo seed, for a reproducible story
//   world=fake    skip the 3D view (HUD work, tests); with log=1 its calls go to the console
import { createStore } from './core/store.js';
import { createDirector } from './core/director.js';
import { connectLive, fetchHello } from './core/connection.js';
import { createHud } from './ui/hud.js';
import { loadPrefs } from './ui/prefs.js';
import { createDemo } from './ui/demo-mode.js';
import { resolveReducedMotion, timeOfDayFor } from './ui/appearance.js';

const params = new URLSearchParams(location.search);

/** @typedef {import('./ui/types.js').World} World */

async function boot() {
  // ?speed= sets this visit's demo speed without changing the saved preference.
  const saved = loadPrefs();
  const prefs = { ...saved, speed: speedParam(saved.speed) };
  const store = createStore();
  /** @type {{ mode: 'live'|'demo', store: any, world: World|null }} */
  const app = { mode: 'demo', store, world: null };
  /** @type {any} */ (window).__andary = app;

  /** @type {ReturnType<typeof connectLive>|null} */
  let link = null;
  /** @type {ReturnType<typeof createDemo>|null} */
  let demo = null;

  const hud = createHud({
    store,
    prefs,
    controls: {
      decide: (id, decision) => (demo ? demo.decide(id, decision) : link?.decide(id, decision) ?? false),
      setRemoteApprovals: (on) => link?.setRemoteApprovals(on),
      startDemo: () => switchToDemo(),
      leaveDemo: () => location.assign(withoutParam('demo')),
      setPaused: (paused) => {
        demo?.setPaused(paused);
        app.world?.setPaused(paused);
      },
      setSpeed: (speed) => demo?.setSpeed(speed),
    },
  });

  // A forced demo skips the server check: on static hosting it would only log a 404.
  const forceDemo = params.get('demo') === '1';
  const worldReady = startWorld(prefs);
  const hello = forceDemo ? null : await fetchHello();
  const live = Boolean(hello) && !forceDemo;
  // Say which mode this is right away; the 3D view may still be loading.
  hud.setServerAvailable(Boolean(hello));
  // A forced demo usually comes from `andary demo`, so offer the way back to the live town
  // without probing the server (on static hosting the probe would only log a 404).
  hud.setDemoForced(forceDemo);
  hud.setMode(live ? 'live' : 'demo');
  hud.setConnection(live ? (hello.authenticated ? 'connecting' : 'signin') : 'demo');

  // Events start flowing only once the director is listening, so the town misses none of them.
  const world = await worldReady;
  app.world = world.world;
  hud.attachWorld(world.world, { failed: world.failed });
  try {
    createDirector({ world: world.world, store });
  } catch (error) {
    console.error('Andary: the director could not start; the HUD still works.', error);
  }
  if (live) startLive(hello);
  else await startDemo({ hosted: !hello && !forceDemo });

  /** @param {import('./core/connection.js').Hello} info */
  function startLive(info) {
    app.mode = 'live';
    hud.setServerSettings(info.settings ?? {});
    link = connectLive({
      store,
      authenticated: info.authenticated,
      onStatus: (status) => hud.setConnection(status),
      onSettings: (settings) => hud.setServerSettings(settings),
      onError: (message) => hud.notify({ tone: 'error', icon: 'warning', title: message }),
    });
  }

  /** @param {{ hosted: boolean }} options  hosted: no server at all, so offer the setup steps */
  async function startDemo({ hosted }) {
    const { createSimulation } = await import('./sim/simulation.js');
    demo = createDemo({ store, createSimulation, speed: prefs.speed, seed: seedParam() });
    app.mode = 'demo';
    hud.setMode('demo');
    hud.setConnection('demo');
    demo.start();
    if (hosted && !prefs.setupSeen) hud.openDialog('setup');
  }

  /** The "Watch the demo" button: leave live mode in place, without a reload. */
  async function switchToDemo() {
    link?.close();
    link = null;
    store.reset();
    history.replaceState(null, '', withParam('demo', '1'));
    await startDemo({ hosted: false });
  }
}

/**
 * Creates the 3D world, or the fake one (?world=fake, or when WebGL is unavailable).
 * @param {import('./ui/prefs.js').Prefs} prefs
 * @returns {Promise<{ world: World, failed: boolean }>}
 */
async function startWorld(prefs) {
  const container = /** @type {HTMLElement} */ (document.getElementById('world'));
  const options = {
    quality: prefs.quality,
    reducedMotion: resolveReducedMotion(prefs, matchMedia('(prefers-reduced-motion: reduce)').matches),
    timeOfDay: timeOfDayFor(prefs.timeMode),
  };
  if (params.get('world') !== 'fake') {
    try {
      const { createWorld } = await import('./world/world.js');
      return { world: await createWorld(container, options), failed: false };
    } catch (error) {
      console.warn('Andary: the 3D view could not start, continuing without it.', error);
      container.replaceChildren();
    }
  }
  const { createFakeWorld } = await import('./dev/fake-world.js');
  const fake = /** @type {World} */ (/** @type {unknown} */ (createFakeWorld(container, { ...options, log: params.get('log') === '1' })));
  return { world: fake, failed: params.get('world') !== 'fake' };
}

/** @param {1|2|4} fallback */
function speedParam(fallback) {
  const speed = Number(params.get('speed'));
  return speed === 1 || speed === 2 || speed === 4 ? speed : fallback;
}

function seedParam() {
  const seed = Number.parseInt(params.get('seed') ?? '', 10);
  return Number.isFinite(seed) ? seed : undefined;
}

/** @param {string} name @param {string} value */
function withParam(name, value) {
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  return url.pathname + url.search;
}

/** @param {string} name */
function withoutParam(name) {
  const url = new URL(location.href);
  url.searchParams.delete(name);
  return url.pathname + url.search;
}

boot().catch((error) => {
  console.error('Andary failed to start', error);
});
