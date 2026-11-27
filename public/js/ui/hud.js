// The HUD: builds every panel around the 3D town, keeps view state (selection, follow, mode…)
// beside the store, renders at most once per animation frame however many events arrive, and
// plays the side effects of fresh changes (toasts, sounds, announcements).
import { createActivityPanel } from './activity.js';
import { createAnnouncer } from './announcer.js';
import { applyMotion, applyTheme, applyWorldPrefs } from './appearance.js';
import { createApprovalsPanel, pendingCount } from './approvals.js';
import { createBoard } from './board.js';
import { createBuildingCard } from './building-card.js';
import { createCatchUp } from './catch-up.js';
import { createCinema } from './cinema.js';
import { createCrewsPanel } from './crews.js';
import { createHelpDialog, createSettingsDialog, createSetupDialog } from './dialogs.js';
import { createCharacterDialog, loadSavedProfile } from './character.js';
import { createTownPeople, mergePresence } from './town-people.js';
import { createWalk, showLookAsk } from './walk.js';
import { PERSON_COLOR_NAMES } from '../core/profile.js';
import { goToNeed, handleShortcut, openDialog, panelsHidden, runAction, select, setFollow } from './hud-actions.js';
import { FRESH_MS, createEffectQueue, playEffects } from './hud-effects.js';
import { createInspector } from './inspector.js';
import { createWeatherDriver } from '../core/town-weather.js';
import { MILESTONES, unlockedAt } from '../core/growth.js';
import { readAccounts } from '../core/limits.js';
import { LOOK } from '../page.js';
import { createDiffDialog } from './changes.js';
import { createUsageDialog } from './usage.js';
import { createLeaderboard } from './leaderboard.js';
import { installNotifications } from './notifications.js';
import { createMasthead } from './masthead.js';
import { createNeedsYou } from './needs-you.js';
import { createNotices } from './notices.js';
import { savePrefs } from './prefs.js';
import { installShortcuts } from './shortcuts.js';
import { createSound } from './sound.js';
import { createTasksPanel } from './tasks.js';
import { createToasts } from './toasts.js';
import { createToolbar } from './toolbar.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').ViewState} ViewState */
/** @typedef {import('./types.js').World} World */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./prefs.js').Prefs} Prefs */

const MOBILE_QUERY = '(max-width: 640px)';

/**
 * @param {{ store: import('./types.js').Store, prefs: Prefs, controls: import('./types.js').Controls }} options
 */
export function createHud({ store, prefs: initialPrefs, controls }) {
  const prefs = { ...initialPrefs };
  const view = initialView(prefs);
  /** @type {{ world: World|null, frame: number, measureSheets: () => void, weather: ReturnType<typeof createWeatherDriver>|null, cardInView: boolean }} */
  const shell = { world: null, frame: 0, measureSheets: () => {}, weather: null, cardInView: false };
  const townPeople = createTownPeople(() => shell.world);
  const announcer = createAnnouncer();
  announcer.setActivityEnabled(prefs.announce);

  /** @type {HudContext} */
  const ctx = {
    store,
    prefs,
    view,
    controls,
    sound: createSound({ enabled: prefs.sound, volume: prefs.volume, ambient: prefs.ambient }),
    announcer,
    toasts: createToasts(),
    world: () => shell.world,
    refresh: () => {
      if (!shell.frame) shell.frame = requestAnimationFrame(() => flush(hud, shell, effects));
    },
    setPrefs: (patch) => updatePrefs(ctx, patch),
    select: (sel, options) => select(hud, sel, options),
    setFollow: (on) => setFollow(hud, on),
    showTab: (tab, options) => showTab(hud, shell, tab, options),
    openDialog: (name) => openDialog(hud, name),
    run: (action) => runAction(hud, action),
    showDiff: (agentKey, changeId) => {
      for (const dialog of Object.values(ui.dialogs)) if (dialog.isOpen) dialog.close();
      ui.dialogs.diff.show(agentKey, changeId);
    },
    // Someone watching a team town (its view link, or a teammate's personal link) can answer nothing: nothing needs them.
    needsYou: createNeedsYou({ viewOnly: () => ['viewer', 'person'].includes(view.serverSettings.team?.role), onChange: () => ctx.refresh() }),
    goToNeed: (item) => goToNeed(hud, item),
    // The director camera and the catch-up need the finished context, so they are attached right below.
    cinema: /** @type {any} */ (null),
    catchUp: /** @type {any} */ (null),
  };
  ctx.cinema = createCinema(ctx);
  ctx.catchUp = createCatchUp(ctx);
  const ui = createParts(ctx);
  const hud = { ctx, ui };
  const effects = createEffectQueue();

  mount(ctx, ui);
  openBoard(ui, view);
  applyTheme(prefs, null);
  applyMotion(prefs, null);

  followStore(hud, effects);
  const stopShortcuts = installShortcuts({ getMode: () => view.mode, handle: (action, event) => handleShortcut(hud, action, event) });
  const stopTicker = watchEnvironment(ctx, ui, shell);
  installNotifications(ctx);
  shell.measureSheets = trackSheets(ui.board.el, [ui.inspector.el, ui.place.el], ui.toolbar.el);
  ctx.refresh();

  return {
    /** @param {World} world @param {{ failed?: boolean }} [options] */
    attachWorld(world, { failed = false } = {}) {
      shell.world = world;
      if (view.progress) world.setLandmarks?.(unlockedAt(view.progress.points));
      listenToWorld(hud, world);
      applyWorldPrefs(prefs, world);
      townPeople.redraw(view.people, view.clockOffset);
      if (failed) {
        view.worldFailed = true;
        ui.notices.showWorldFallback();
      } else {
        ctx.cinema.start(/** @type {HTMLElement} */ (document.getElementById('world')));
        shell.weather = createWeatherDriver({ store, world: () => shell.world, enabled: () => ctx.prefs.weather, onChange: (w) => sayWeather(ctx, w) });
      }
      ctx.refresh();
      // Panel slides animate from now on; two frames later, so a layout settled at boot never does.
      requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('hud-ready')));
    },
    /** @param {'live'|'demo'} mode */
    setMode(mode) {
      // Progress belongs to one town: the demo's must not be compared with the live one's.
      if (view.mode !== mode) view.progress = null;
      view.mode = mode;
      if (mode === 'live') view.paused = false;
      ctx.refresh();
    },
    /**
     * The latest time you were away, from the server (Catch me up), and how far the server's clock
     * is ahead of this browser's.
     * @param {unknown} away @param {number} [offset]
     */
    setAway: (away, offset) => ctx.catchUp.setAway(away, offset),
    /**
     * What each crew did in the period Catch me up asked about, from the server or the demo.
     * @param {unknown} digest
     */
    setDigest: (digest) => ctx.catchUp.showDigest(digest),
    /**
     * The server's answer to a note sent from the agent's details (§4.15).
     * @param {{ ref: string|null, ok: boolean, error?: string }} reply
     */
    noteReply: (reply) => ui.inspector.noteReply(reply),
    /** @param {import('./types.js').ConnectionStatus} status */
    setConnection(status) {
      view.connection = status;
      ctx.refresh();
    },
    /** @param {{ remoteApprovals?: boolean, approvalTimeoutMs?: number }} settings */
    setServerSettings(settings) {
      view.serverSettings = { ...view.serverSettings, ...settings };
      ctx.refresh();
    },
    /**
     * The town's growth and busy days (§4.9), from the server or the demo.
     * @param {unknown} progress
     */
    setProgress(progress) {
      showProgress(hud, shell, progress);
    },
    /** Plan limits (§4.14), from the server or the demo: every account's, as a whole. @param {unknown} limits */
    setLimits: (limits) => showLimits(ctx, limits),
    ...modeFlags(ctx),
    ...peopleApi(hud, townPeople),
    /** @param {'help'|'settings'|'setup'|'diff'|'usage'|'leaderboard'|'character'} name */
    openDialog: (name) => openDialog(hud, name),
    /** Points a first-time visitor to the setup steps, unless they have seen them already. */
    offerSetup() {
      if (ctx.prefs.setupSeen || ui.dialogs.setup.isOpen) return;
      ctx.toasts.show({
        icon: 'terminal',
        title: 'This is a demo town',
        body: 'See your own agents here.',
        action: { label: 'How to connect', run: () => openDialog(hud, 'setup') },
      });
      // Toasts are not announced; this one matters, so it is said too, with where the steps live.
      ctx.announcer.polite('This is a demo town. To watch your own agents, open Settings and choose Use your own Claude Code.');
    },
    /** @param {import('./toasts.js').ToastOptions} options */
    notify: (options) => ctx.toasts.show(options),
    dispose() {
      stopShortcuts();
      stopTicker();
      ctx.cinema.dispose();
      shell.weather?.dispose();
      shell.weather = null;
    },
  };
}

/**
 * What the world tells the HUD: a click on an agent or a building, and in walk mode the ground
 * and the keys' steps.
 * @param {{ ctx: HudContext, ui: ReturnType<typeof createParts> }} hud @param {World} world
 */
function listenToWorld(hud, world) {
  world.on?.('select', (sel) => select(hud, sel, { from: 'world', camera: false }));
  hud.ui.walk.attachWorld(world);
}

/**
 * Facts about how the page runs, from main.js.
 * @param {HudContext} ctx
 */
function modeFlags(ctx) {
  const set = (/** @type {'serverAvailable'|'demoForced'|'hosted'} */ key, /** @type {boolean} */ on) => {
    ctx.view[key] = on;
    ctx.refresh();
  };
  return {
    /** @param {boolean} available an Andary server answered */
    setServerAvailable: (available) => set('serverAvailable', available),
    /** @param {boolean} forced the demo was asked for in the URL (?demo=1) */
    setDemoForced: (forced) => set('demoForced', forced),
    /** @param {boolean} hosted a demo on a static host: the town fills the screen by default */
    setHosted: (hosted) => set('hosted', hosted),
  };
}

/**
 * The HUD's side of a team town's people (§4.11), or the demo's.
 * @param {{ ctx: HudContext, ui: ReturnType<typeof createParts> }} hud
 * @param {ReturnType<typeof createTownPeople>} townPeople
 */
function peopleApi(hud, townPeople) {
  const { ctx } = hud;
  /** A profile this browser kept is offered to the host once per page, if the host forgot it (`team reset`). */
  let restored = false;
  return {
    /**
     * Who lives in town and who this browser plays: their homes and figures in the town, and the
     * "You" dialog.
     * @param {unknown[]} people @param {string|null} me
     * @param {number} [offset]  how far the server's clock is ahead of this browser's
     */
    setPeople(people, me, offset = 0) {
      ctx.view.people = /** @type {import('./town-people.js').PersonView[]} */ (people.filter((p) => p && typeof p === 'object'));
      ctx.view.me = typeof me === 'string' ? me : null;
      ctx.view.clockOffset = Number.isFinite(offset) ? offset : 0;
      townPeople.sync(ctx.view.people, ctx.view.clockOffset);
      hud.ui.dialogs.character.peopleChanged();
      const mine = ctx.view.people.find((p) => p.name === ctx.view.me);
      if (mine && !mine.profile && !restored) {
        restored = true;
        const saved = loadSavedProfile();
        if (saved) ctx.controls.saveProfile?.(saved);
      }
      ctx.refresh();
    },
    /** Where some people are now: walks, who came or went, lights (§4.11). @param {unknown[]} patches */
    setPresence(patches) {
      ctx.view.people = mergePresence(ctx.view.people, patches);
      townPeople.sync(ctx.view.people, ctx.view.clockOffset);
      ctx.refresh();
    },
    /** Someone's emote or set phrase. @param {{ kind: 'emote'|'phrase', name: string, id: number }} said */
    said: (said) => hud.ui.walk.said(said),
    /** A teammate asks this person to come look. @param {{ from: string, at: unknown }} ask */
    lookAsked: (ask) => showLookAsk(ctx, ask),
    /** An error from the server: in the "You" dialog when it waits for a save, else a toast. @param {string} message */
    serverError(message) {
      if (hud.ui.dialogs.character.pending) hud.ui.dialogs.character.refused(message);
      else ctx.toasts.show({ tone: 'error', icon: 'warning', title: message });
    },
    /**
     * The host saved this person's profile; another person may hold the colour they asked for.
     * @param {{ color: number, asked: number }} saved
     */
    profileSaved({ color, asked }) {
      hud.ui.dialogs.character.saved();
      if (color === asked) return;
      ctx.toasts.show({ icon: 'info', title: `${PERSON_COLOR_NAMES[asked] ?? 'That colour'} is taken`, body: `You are ${PERSON_COLOR_NAMES[color] ?? 'another colour'} instead.` });
    },
  };
}

/**
 * Keeps the town's progress in the view and builds the landmarks it has earned. A landmark
 * unlocked while the viewer watches rises into place, with a toast; ones earned before are
 * simply there.
 * @param {{ ctx: HudContext, ui: Parts }} hud
 * @param {{ world: World|null }} shell
 * @param {unknown} raw
 */
function showProgress({ ctx }, shell, raw) {
  const value = /** @type {any} */ (raw);
  const points = Number.isInteger(value?.points) && value.points > 0 ? value.points : 0;
  const days = Array.isArray(value?.days) ? value.days.filter((/** @type {unknown} */ d) => typeof d === 'string') : [];
  const before = ctx.view.progress;
  ctx.view.progress = { points, days };
  const ids = unlockedAt(points);
  const fresh = before ? ids.filter((id) => !unlockedAt(before.points).includes(id)) : [];
  shell.world?.setLandmarks?.(ids, { grow: fresh.length > 0 });
  for (const id of fresh) {
    const milestone = MILESTONES.find((m) => m.id === id);
    if (!milestone) continue;
    ctx.toasts.show({ tone: 'achievement', icon: 'spark', title: 'The town grew', body: `${milestone.name} ${milestone.where}.`, group: 'achievement' });
    ctx.announcer.polite(`The town grew: ${milestone.name} ${milestone.where}.`);
  }
  ctx.refresh();
}

/**
 * Keeps the plan limits in the view; the toolbar and the Usage dialog read them from there.
 * @param {HudContext} ctx
 * @param {unknown} limits
 */
function showLimits(ctx, limits) {
  ctx.view.limits = readAccounts(limits);
  ctx.refresh();
}

/**
 * How the ambient sound should feel now: busier with more agents at work, night by the town's
 * clock, rain with the town's weather.
 * @param {HudContext} ctx
 * @param {number} rain
 * @returns {import('./ambient.js').AmbientMood}
 */
function ambientMood(ctx, rain) {
  const working = Object.values(ctx.store.getState().agents).filter((agent) => agent.status === 'working').length;
  const hour = ctx.world()?.getTimeOfDay?.() ?? new Date().getHours();
  // Snow falls silently: the snowy look's weather has no rain to hear.
  return { activity: Math.min(1, working / 6), night: hour < 6 || hour >= 19.5, rain: LOOK === 'snow' ? 0 : rain };
}

/** What screen readers hear when the town's weather turns. */
const WEATHER_WORDS = Object.freeze({
  storm: 'A storm over the town: something keeps failing.',
  rainbow: 'A rainbow over the town: the tests pass again.',
});

/** @param {HudContext} ctx @param {import('../core/town-weather.js').TownWeather} w */
function sayWeather(ctx, w) {
  const words = WEATHER_WORDS[/** @type {keyof typeof WEATHER_WORDS} */ (w.kind)];
  if (words && ctx.prefs.announce) ctx.announcer.polite(words);
}

/** @param {Prefs} prefs @returns {ViewState} */
function initialView(prefs) {
  return {
    mode: 'demo',
    connection: 'connecting',
    serverAvailable: false,
    demoForced: false,
    hosted: false,
    worldFailed: false,
    serverSettings: {},
    people: [],
    me: null,
    clockOffset: 0,
    walking: false,
    progress: null,
    limits: [],
    selection: null,
    follow: false,
    paused: false,
    mobile: matchMedia(MOBILE_QUERY).matches,
    sheetOpen: true,
    tab: prefs.tab,
  };
}

/** @param {HudContext} ctx */
function createParts(ctx) {
  const crews = createCrewsPanel(ctx);
  const tasks = createTasksPanel(ctx);
  const activity = createActivityPanel(ctx);
  const approvals = createApprovalsPanel(ctx);
  return {
    masthead: createMasthead(ctx),
    crews,
    tasks,
    activity,
    approvals,
    board: createBoard(ctx, { crews: crews.el, tasks: tasks.el, activity: activity.el, approvals: approvals.el }),
    inspector: createInspector(ctx),
    place: createBuildingCard(ctx),
    toolbar: createToolbar(ctx),
    notices: createNotices(ctx),
    walk: createWalk(ctx),
    dialogs: { help: createHelpDialog(ctx), settings: createSettingsDialog(ctx), setup: createSetupDialog(ctx), diff: createDiffDialog(ctx), usage: createUsageDialog(ctx), leaderboard: createLeaderboard(ctx), catchUp: ctx.catchUp, character: createCharacterDialog(ctx) },
  };
}

/** @typedef {ReturnType<typeof createParts>} Parts */

/**
 * Places the HUD around <main>: the sign, crews and inspector before it, the board, toasts and
 * dialogs after it, so the tab order follows the screen from left to right.
 * @param {HudContext} ctx
 * @param {Parts} ui
 */
function mount(ctx, ui) {
  const main = /** @type {HTMLElement} */ (document.getElementById('main'));
  main.before(ui.masthead.el, ui.board.leftDock, ui.inspector.el);
  main.append(ui.notices.el, ui.place.el, ctx.cinema.el, ui.walk.el, ui.toolbar.el, ...ctx.announcer.elements);
  main.after(ui.board.el, ctx.toasts.el, ...Object.values(ui.dialogs).map((dialog) => dialog.el));
}

/**
 * Every change of the store: its effects are queued and the next frame redraws; a reset (a
 * reconnect's hello) clears the log and an agent's selection.
 * @param {{ ctx: HudContext, ui: Parts }} hud
 * @param {ReturnType<typeof createEffectQueue>} effects
 */
function followStore(hud, effects) {
  const { ctx, ui } = hud;
  ctx.store.subscribe((change) => {
    if (change.type === 'reset') {
      ui.activity.reset();
      if (ctx.view.selection?.type === 'agent') select(hud, null, { camera: false });
    }
    effects.push(change);
    ctx.refresh();
  });
}

/**
 * The board's first tab. Phones open on Crews: it is the overview, and the rest is one tap away.
 * @param {Parts} ui
 * @param {import('./types.js').ViewState} view
 */
function openBoard(ui, view) {
  if (view.mobile) view.tab = 'crews';
  ui.board.setMobile(view.mobile);
  ui.board.select(view.tab);
}

/**
 * One render of everything from the current state.
 * @param {{ ctx: HudContext, ui: Parts }} hud
 * @param {{ frame: number, measureSheets: () => void, cardInView: boolean }} shell
 * @param {ReturnType<typeof createEffectQueue>} effects
 */
function flush(hud, shell, effects) {
  const { ctx, ui } = hud;
  shell.frame = 0;
  const state = ctx.store.getState();
  ui.masthead.render(state);
  ui.crews.render(state);
  ui.tasks.render(state);
  const added = ui.activity.render(state);
  ctx.announcer.activity(added.filter((entry) => Date.now() - entry.ts < FRESH_MS));
  ui.approvals.render(state);
  ui.board.setPendingApprovals(pendingCount(state));
  holdWhileShown(ctx, ui, shell);
  ui.inspector.render(state);
  ui.place.render(state);
  ui.toolbar.render();
  ui.walk.render();
  applyPanels(hud, shell.measureSheets);
  ui.notices.show(noticeKind(ctx.view, state));
  ui.dialogs.settings.sync();
  ui.dialogs.usage.render();
  ui.dialogs.leaderboard.render();
  ui.dialogs.catchUp.render();
  playEffects(ctx, effects.take(), state);
  ui.activity.settle();
}

/**
 * Tells the demo whether a card waiting for an answer is in view (the Approvals tab open, the
 * boards on screen, the page visible): its countdowns hold meanwhile, so a first-time visitor has
 * time to read one. Live requests keep the server's timeout.
 * @param {HudContext} ctx
 * @param {Parts} ui
 * @param {{ cardInView: boolean }} shell  what the demo was last told
 */
function holdWhileShown(ctx, ui, shell) {
  const sheetAway = ctx.view.mobile && !ctx.view.sheetOpen;
  const inView = ctx.view.mode === 'demo' && ctx.view.tab === 'approvals' && !panelsHidden(ctx) && !sheetAway && !document.hidden && ui.approvals.answerable();
  if (inView === shell.cardInView) return;
  shell.cardInView = inView;
  ctx.controls.holdApprovals?.(inView);
}

/**
 * Hidden panels slide away and become inert, so they cannot be reached by keyboard or read out.
 * Focus inside them moves to the button that brings them back, so the keyboard does not fall
 * to the top of the page. A slide does not resize the sheets, so phones are measured again.
 * Approval cards that come back on screen wait a moment for a click (CONTRACTS §4.5): requests
 * may have arrived while the panels were away.
 * @param {{ ctx: HudContext, ui: Parts }} hud
 * @param {() => void} measureSheets
 */
function applyPanels({ ctx, ui }, measureSheets) {
  const hidden = panelsHidden(ctx);
  if (ui.board.el.inert === hidden) return;
  const docks = [ui.board.el, ui.board.leftDock];
  if (hidden && docks.some((dock) => dock.contains(document.activeElement))) ui.toolbar.focusTool('toggle-panels');
  document.documentElement.classList.toggle('hud-panels-hidden', hidden);
  for (const dock of docks) dock.inert = hidden;
  if (!hidden) ui.approvals.shown();
  measureSheets();
}

/**
 * Opens a board tab. A tab the viewer asked for (an approval to review) must be reachable, so the
 * side boards come back first if they were put away.
 * @param {{ ctx: HudContext, ui: Parts }} hud
 * @param {{ measureSheets: () => void }} shell
 * @param {string} tab
 * @param {{ focus?: boolean }} [options]
 */
function showTab(hud, shell, tab, options) {
  const { ctx, ui } = hud;
  if (panelsHidden(ctx)) {
    ctx.setPrefs({ panels: 'shown' });
    applyPanels(hud, shell.measureSheets);
  }
  ui.board.select(tab, { focus: options?.focus, open: true });
}

/**
 * @param {ViewState} view
 * @param {StoreState} state
 * @returns {'waiting'|'signin'|null}
 */
export function noticeKind(view, state) {
  if (view.mode !== 'live') return null;
  if (view.connection === 'signin') return 'signin';
  return view.connection === 'live' && state.sessions.length === 0 ? 'waiting' : null;
}

/**
 * @param {HudContext} ctx
 * @param {Partial<Prefs>} patch
 */
function updatePrefs(ctx, patch) {
  Object.assign(ctx.prefs, patch);
  savePrefs(ctx.prefs);
  const world = ctx.world();
  if ('theme' in patch || 'timeMode' in patch) applyTheme(ctx.prefs, world);
  if ('motion' in patch) applyMotion(ctx.prefs, world);
  if (patch.quality === 'high' || patch.quality === 'low') world?.setQuality(patch.quality);
  if ('placeNames' in patch) world?.setPlaceNames?.(ctx.prefs.placeNames);
  ctx.refresh();
}

/**
 * On phones the board, the inspector and the building card are bottom sheets. The toolbar rides on
 * top of whichever is tallest (--sheet-h), so it is never hidden behind one; the 3D view ends at
 * the board (--board-h) so the town is framed in the part of the screen you can see. The
 * inspector does not shrink the view: it comes and goes, and the camera should not jump with it.
 * A sheet put away by the full-screen view (inert) counts as no height. The toolbar's own height
 * (--tools-h; two rows on a narrow phone) places the director's caption above it.
 * @param {HTMLElement} board
 * @param {HTMLElement[]} others
 * @param {HTMLElement} toolbar
 * @returns {() => void} measures again
 */
function trackSheets(board, others, toolbar) {
  const root = document.documentElement.style;
  const heightOf = (/** @type {HTMLElement} */ sheet) => (sheet.hidden || sheet.inert ? 0 : Math.round(sheet.getBoundingClientRect().height));
  const measure = () => {
    root.setProperty('--board-h', `${heightOf(board)}px`);
    root.setProperty('--sheet-h', `${Math.max(heightOf(board), ...others.map(heightOf))}px`);
    root.setProperty('--tools-h', `${heightOf(toolbar)}px`);
  };
  // Measured once right away, before the first paint: left to the observer, the first frame
  // showed the toolbar at the bottom of the screen and then moved it above the sheet, a layout
  // shift (CLS 0.13 on phones).
  measure();
  const observer = new ResizeObserver(measure);
  for (const sheet of [board, ...others, toolbar]) observer.observe(sheet);
  return measure;
}

/**
 * Layout, motion and visibility changes, the once-a-second ticker for elapsed times and
 * countdowns (stopped while the tab is hidden), and the first-gesture sound unlock.
 * @param {HudContext} ctx
 * @param {Parts} ui
 * @param {{ weather: { current: { rain: number } }|null }} shell
 * @returns {() => void} stops the ticker
 */
function watchEnvironment(ctx, ui, shell) {
  const mobileQuery = matchMedia(MOBILE_QUERY);
  mobileQuery.addEventListener('change', () => {
    ctx.view.mobile = mobileQuery.matches;
    ui.board.setMobile(ctx.view.mobile);
    ctx.refresh();
  });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyMotion(ctx.prefs, ctx.world()));
  // Tooltips hidden with Escape come back on the next pointer move or focus change (WCAG 1.4.13).
  const showTips = () => document.documentElement.classList.remove('hud-tips-hidden');
  document.addEventListener('pointermove', showTips, { passive: true });
  document.addEventListener('focusin', showTips);
  // Sound left on last time can only start after the viewer's first gesture on this page.
  if (ctx.prefs.sound) {
    document.addEventListener('pointerdown', () => ctx.sound.unlock(), { once: true });
    document.addEventListener('keydown', () => ctx.sound.unlock(), { once: true });
  }
  let ticks = 0;
  /** @type {ReturnType<typeof setInterval>|null} */
  let ticker = null;
  const tick = () => {
    const now = Date.now();
    ui.crews.tick(now);
    ui.approvals.tick(now);
    ui.inspector.tick(now);
    if (++ticks % 5 === 0) ui.activity.tick(now);
    if (ticks % 60 === 0) applyTheme(ctx.prefs, ctx.world());
    // "as of", the reset time and the pace move with the clock alone.
    if (ticks % 30 === 0) {
      ui.toolbar.render();
      ui.dialogs.usage.render();
    }
    if (ticks % 2 === 0) ctx.sound.setAmbient({ wanted: ctx.prefs.ambient, mood: ambientMood(ctx, shell.weather?.current.rain ?? 0) });
  };
  const sync = () => {
    ctx.sound.setAmbient({ hidden: document.hidden });
    if (document.hidden && ticker) {
      clearInterval(ticker);
      ticker = null;
    } else if (!document.hidden && !ticker) {
      ticker = setInterval(tick, 1000);
    }
  };
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    document.removeEventListener('visibilitychange', sync);
    if (ticker) clearInterval(ticker);
  };
}
