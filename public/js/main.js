// Boot. Picks live mode (an Andary server answered /api/hello) or demo mode (the built-in
// simulation; forced with ?demo=1), then wires store → director → 3D world, and the HUD around it.
// The HUD and the store start first, so the crews and the log show while the 3D modules load and
// even if WebGL is missing. The world is built once that first content has been drawn (building
// it blocks the page for a moment); the director then plays what the store recorded meanwhile.
//
// URL options:
//   demo=1        force the demo, even with a server running
//   speed=1|2|4   demo speed for this visit
//   seed=N        demo seed, for a reproducible story
//   world=fake    skip the 3D view (HUD work, tests); with log=1 its calls go to the console
import { createStore } from './core/store.js';
import { createDirector, recordChanges } from './core/director.js';
import { connectLive, fetchHello } from './sources/live.js';
import { readCredentials } from './sources/credentials.js';
import { createHud } from './ui/hud.js';
import { loadPrefs } from './ui/prefs.js';
import { createDemo } from './sources/demo.js';
import { createDemoPeople } from './sources/demo-people.js';
import { loadSavedProfile } from './ui/character.js';
import { demoLimits } from './sources/demo-limits.js';
import { resolveReducedMotion, timeOfDayFor } from './ui/appearance.js';

const params = new URLSearchParams(location.search);
/** How long a visitor on a static host watches the town before the setup steps are offered. */
const SETUP_HINT_MS = 8000;
/** After the source starts, the 3D world waits at most this long for the first crew or the live history. */
const FIRST_CONTENT_MS = 800;

/** @typedef {import('./ui/types.js').World} World */

async function boot() {
  // A sign-in link leaves the address bar first, in the demo too: the page keeps it for later.
  readCredentials();
  // ?speed= sets this visit's demo speed without changing the saved preference.
  const saved = loadPrefs();
  const prefs = { ...saved, speed: speedParam(saved.speed) };
  const store = createStore();
  /** @type {{ mode: 'live'|'demo', store: any, world: World|null, hud: any }} */
  const app = { mode: 'demo', store, world: null, hud: null };
  /** @type {any} */ (window).__andary = app;

  /** The one place events come from: live or demo (sources/types.js). @type {import('./sources/types.js').TownSource|null} */
  let source = null;
  let paused = false;

  const hud = createHud({
    store,
    prefs,
    controls: {
      decide: (id, decision, message, always, stop) => source?.decide(id, decision, message, always, stop) ?? false,
      sendNote: (sessionId, agentId, text, ref) => source?.sendNote?.(sessionId, agentId, text, ref) ?? false,
      setRemoteApprovals: (on) => source?.setRemoteApprovals?.(on),
      startDemo: () => switchToDemo(),
      leaveDemo: () => location.assign(withoutParam('demo')),
      setPaused: (on) => {
        paused = on;
        source?.setPaused?.(on);
        app.world?.setPaused(on);
      },
      setSpeed: (speed) => source?.setSpeed?.(speed),
      notifyTest: () => source?.notifyTest?.() ?? false,
      requestDigest: (since) => source?.requestDigest(since) ?? false,
      saveProfile: (profile) => source?.saveProfile?.(profile) ?? false,
      walk: (to) => source?.walk?.(to) ?? false,
      say: (kind, id) => source?.say?.(kind, id) ?? false,
      lookAsk: (to, at) => source?.lookAsk?.(to, at) ?? false,
    },
  });

  /**
   * A team town's people (or the demo's): their crews take their colours, and the HUD shows
   * their homes, their figures and the "You" dialog.
   * @param {unknown[]} people @param {string|null} me
   * @param {number} offset  how far the server's clock is ahead of this browser's
   */
  function setPeople(people, me, offset) {
    store.setPeople(people);
    hud.setPeople(people, me, offset);
  }

  app.hud = hud;
  // The director starts with the world; until then it gets a record of what the store did.
  const backlog = recordChanges(store);
  // The 3D modules load from now on; the world is built once the first content is drawn.
  /** @type {() => void} */
  let contentDrawn = () => {};
  const worldReady = startWorld(prefs, new Promise((resolve) => (contentDrawn = resolve)));
  // A forced demo skips the server check: on static hosting it would only log a 404.
  const forceDemo = params.get('demo') === '1';
  const hello = forceDemo ? null : await fetchHello();
  const live = Boolean(hello) && !forceDemo;
  // Say which mode this is right away; the 3D view may still be loading.
  hud.setServerAvailable(Boolean(hello));
  // A forced demo usually comes from `andary demo`, so the HUD offers the way back to the live town.
  hud.setDemoForced(forceDemo);
  hud.setMode(live ? 'live' : 'demo');
  hud.setConnection(live ? (hello.authenticated ? 'connecting' : 'signin') : 'demo');
  // On a static host (no server at all) the town is the show: it fills the screen from the start.
  const hosted = !hello && !forceDemo;
  hud.setHosted(hosted);

  // Events flow into the store and the HUD now; the town plays them once it is built.
  if (live) startLive(hello);
  else await startDemo({ hosted });
  firstContent(store).then(contentDrawn);

  const world = await worldReady;
  app.world = world.world;
  if (paused) world.world.setPaused(true);
  hud.attachWorld(world.world, { failed: world.failed });
  try {
    createDirector({ world: world.world, store, backlog: backlog.stop() });
  } catch (error) {
    console.error('Andary: the director could not start; the HUD still works.', error);
  }

  /** @param {import('./sources/live.js').Hello} info */
  function startLive(info) {
    app.mode = 'live';
    hud.setServerSettings(info.settings ?? {});
    source = connectLive({
      store,
      authenticated: info.authenticated,
      onStatus: (status) => hud.setConnection(status),
      onSettings: (settings) => hud.setServerSettings(settings),
      onError: (message) => hud.serverError(message),
      onProgress: (progress) => hud.setProgress(progress),
      onLimits: (limits) => hud.setLimits(limits),
      onNotifyTest: (ok) => hud.notify(ok ? { icon: 'bell', title: 'Test notification sent', body: 'Check the ntfy app on your phone.' } : { tone: 'error', icon: 'warning', title: 'The test notification was not sent', body: 'The server could not reach ntfy, or sent one a moment ago.' }),
      onDigest: (digest) => hud.setDigest(digest),
      onAway: (away, offset) => hud.setAway(away, offset),
      onPeople: setPeople,
      onProfile: (saved) => hud.profileSaved(saved),
      onPresence: (people) => hud.setPresence(people),
      onSaid: (said) => hud.said(said),
      onLookAsk: (ask) => hud.lookAsked(ask),
      onNoteReply: (reply) => hud.noteReply(reply),
    });
  }

  /** @param {{ hosted: boolean }} options  hosted: no server at all, so offer the setup steps */
  async function startDemo({ hosted }) {
    const { createSimulation, demoBranch } = await import('./sim/simulation.js');
    const demo = createDemo({ store, createSimulation, branchOf: demoBranch, speed: prefs.speed, seed: seedParam(), onProgress: (progress) => hud.setProgress(progress), onDigest: (digest) => hud.setDigest(digest) });
    // The demo is a small team town: you, and Lina with her crew. People first, so crews take their colours.
    const people = createDemoPeople({ onPeople: setPeople, onPresence: (moved) => hud.setPresence(moved), onSaid: (said) => hud.said(said), saved: loadSavedProfile() });
    people.start();
    source = {
      ...demo,
      saveProfile: (profile) => {
        const saved = people.save(profile);
        if ('error' in saved) hud.serverError(saved.error);
        else hud.profileSaved(saved);
        return true;
      },
      walk: (to) => {
        const walked = people.walk(to);
        if (!walked.ok) hud.serverError(walked.error ?? 'You cannot walk there');
        return true;
      },
      say: (kind, id) => people.say(kind, id),
      // Lina gets the note in the demo's story only; asking is fine.
      lookAsk: () => true,
    };
    hud.setLimits(demoLimits(Date.now()));
    app.mode = 'demo';
    hud.setMode('demo');
    hud.setConnection('demo');
    demo.start();
    // The setup steps are offered once the first crews have arrived, instead of a dialog over the
    // first view; the sign's "Use your own Claude Code" button has them all along.
    if (hosted) setTimeout(() => hud.offerSetup(), SETUP_HINT_MS);
  }

  /** The "Watch the demo" button: leave live mode in place, without a reload. */
  async function switchToDemo() {
    source?.close();
    source = null;
    store.reset();
    history.replaceState(null, '', withParam('demo', '1'));
    await startDemo({ hosted: false });
  }
}

/**
 * Creates the 3D world, or the fake one (?world=fake, or when WebGL is unavailable). The modules
 * load at once; the world is built only when `drawn` resolves.
 * @param {import('./ui/prefs.js').Prefs} prefs
 * @param {Promise<void>} drawn  the HUD's first content is on screen
 * @returns {Promise<{ world: World, failed: boolean }>}
 */
async function startWorld(prefs, drawn) {
  const container = /** @type {HTMLElement} */ (document.getElementById('world'));
  const options = {
    quality: prefs.quality,
    reducedMotion: resolveReducedMotion(prefs, matchMedia('(prefers-reduced-motion: reduce)').matches),
    timeOfDay: timeOfDayFor(prefs.timeMode),
    placeNames: prefs.placeNames,
  };
  if (params.get('world') !== 'fake') {
    try {
      const { createWorld } = await import('./world/world.js');
      await drawn;
      return { world: await createWorld(container, options), failed: false };
    } catch (error) {
      console.warn('Andary: the 3D view could not start, continuing without it.', error);
      container.replaceChildren();
    }
  }
  const { createFakeWorld } = await import('./dev/fake-world.js');
  await drawn;
  const fake = /** @type {World} */ (/** @type {unknown} */ (createFakeWorld(container, { ...options, log: params.get('log') === '1' })));
  return { world: fake, failed: params.get('world') !== 'fake' };
}

/**
 * Resolves once the HUD has drawn the town's first content: the frame after the store's next
 * change (the first crew, or the live history), or after FIRST_CONTENT_MS without one.
 * @param {{ subscribe: (listener: () => void) => () => void }} store
 * @returns {Promise<void>}
 */
function firstContent(store) {
  return new Promise((resolve) => {
    let waiting = true;
    const seen = () => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(timer);
      unsubscribe();
      // The HUD draws on the next animation frame; a hidden tab gets none, so it does not wait.
      requestAnimationFrame(() => setTimeout(resolve, 0));
      setTimeout(resolve, 250);
    };
    const timer = setTimeout(seen, FIRST_CONTENT_MS);
    const unsubscribe = store.subscribe(seen);
  });
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
