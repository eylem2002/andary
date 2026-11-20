// The HUD: builds every panel around the 3D town, keeps view state (selection, follow, mode…)
// beside the store, renders at most once per animation frame however many events arrive, and
// plays the side effects of fresh changes (toasts, sounds, announcements).
import { createActivityPanel } from './activity.js';
import { createAnnouncer } from './announcer.js';
import { applyMotion, applyTheme } from './appearance.js';
import { createApprovalsPanel, pendingCount } from './approvals.js';
import { createBoard } from './board.js';
import { createBuildingCard } from './building-card.js';
import { createCrewsPanel } from './crews.js';
import { createHelpDialog, createSettingsDialog, createSetupDialog } from './dialogs.js';
import { handleShortcut, openDialog, runAction, select, setFollow } from './hud-actions.js';
import { FRESH_MS, createEffectQueue, playEffects } from './hud-effects.js';
import { createInspector } from './inspector.js';
import { createMasthead } from './masthead.js';
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
  /** @type {{ world: World|null, frame: number }} */
  const shell = { world: null, frame: 0 };
  const announcer = createAnnouncer();
  announcer.setActivityEnabled(prefs.announce);

  /** @type {HudContext} */
  const ctx = {
    store,
    prefs,
    view,
    controls,
    sound: createSound({ enabled: prefs.sound, volume: prefs.volume }),
    announcer,
    toasts: createToasts(),
    world: () => shell.world,
    refresh: () => {
      if (!shell.frame) shell.frame = requestAnimationFrame(() => flush(hud, shell, effects));
    },
    setPrefs: (patch) => updatePrefs(ctx, patch),
    select: (sel, options) => select(hud, sel, options),
    setFollow: (on) => setFollow(hud, on),
    showTab: (tab, options) => ui.board.select(tab, { focus: options?.focus, open: true }),
    openDialog: (name) => openDialog(hud, name),
    run: (action) => runAction(hud, action),
  };
  const ui = createParts(ctx);
  const hud = { ctx, ui };
  const effects = createEffectQueue();

  mount(ctx, ui);
  // Phones open on the Crews tab: it is the overview, and the rest is one tap away.
  if (view.mobile) view.tab = 'crews';
  ui.board.setMobile(view.mobile);
  ui.board.select(view.tab);
  applyTheme(prefs, null);
  applyMotion(prefs, null);

  store.subscribe((change) => {
    if (change.type === 'reset') {
      ui.activity.reset();
      if (view.selection?.type === 'agent') select(hud, null, { camera: false });
    }
    effects.push(change);
    ctx.refresh();
  });
  const stopShortcuts = installShortcuts({ getMode: () => view.mode, handle: (action, event) => handleShortcut(hud, action, event) });
  const stopTicker = watchEnvironment(ctx, ui);
  trackSheets(ui.board.el, [ui.inspector.el, ui.place.el]);
  ctx.refresh();

  return {
    /** @param {World} world @param {{ failed?: boolean }} [options] */
    attachWorld(world, { failed = false } = {}) {
      shell.world = world;
      world.on?.('select', (sel) => select(hud, sel, { from: 'world', camera: false }));
      applyTheme(prefs, world);
      applyMotion(prefs, world);
      if (failed) ui.notices.showWorldFallback();
      ctx.refresh();
    },
    /** @param {'live'|'demo'} mode */
    setMode(mode) {
      view.mode = mode;
      if (mode === 'live') view.paused = false;
      ctx.refresh();
    },
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
    /** @param {boolean} available */
    setServerAvailable(available) {
      view.serverAvailable = available;
      ctx.refresh();
    },
    /** @param {boolean} forced the demo was asked for in the URL (?demo=1) */
    setDemoForced(forced) {
      view.demoForced = forced;
      ctx.refresh();
    },
    /** @param {'help'|'settings'|'setup'} name */
    openDialog: (name) => openDialog(hud, name),
    /** @param {import('./toasts.js').ToastOptions} options */
    notify: (options) => ctx.toasts.show(options),
    dispose() {
      stopShortcuts();
      stopTicker();
    },
  };
}

/** @param {Prefs} prefs @returns {ViewState} */
function initialView(prefs) {
  return {
    mode: 'demo',
    connection: 'connecting',
    serverAvailable: false,
    demoForced: false,
    serverSettings: {},
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
    dialogs: { help: createHelpDialog(ctx), settings: createSettingsDialog(ctx), setup: createSetupDialog(ctx) },
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
  main.append(ui.notices.el, ui.place.el, ui.toolbar.el, ...ctx.announcer.elements);
  main.after(ui.board.el, ctx.toasts.el, ...Object.values(ui.dialogs).map((dialog) => dialog.el));
}

/**
 * One render of everything from the current state.
 * @param {{ ctx: HudContext, ui: Parts }} hud
 * @param {{ frame: number }} shell
 * @param {ReturnType<typeof createEffectQueue>} effects
 */
function flush({ ctx, ui }, shell, effects) {
  shell.frame = 0;
  const state = ctx.store.getState();
  ui.masthead.render(state);
  ui.crews.render(state);
  ui.tasks.render(state);
  const added = ui.activity.render(state);
  ctx.announcer.activity(added.filter((entry) => Date.now() - entry.ts < FRESH_MS));
  ui.approvals.render(state);
  ui.board.setPendingApprovals(pendingCount(state));
  ui.inspector.render(state);
  ui.place.render(state);
  ui.toolbar.render();
  ui.notices.show(noticeKind(ctx.view, state));
  ui.dialogs.settings.sync();
  playEffects(ctx, effects.take(), state);
  ui.activity.settle();
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
  ctx.refresh();
}

/**
 * On phones the board, the inspector and the building card are bottom sheets. The toolbar rides on
 * top of whichever is tallest (--sheet-h), so it is never hidden behind one; the 3D view ends at
 * the board (--board-h) so the town is framed in the part of the screen you can see. The
 * inspector does not shrink the view: it comes and goes, and the camera should not jump with it.
 * @param {HTMLElement} board
 * @param {HTMLElement[]} others
 */
function trackSheets(board, others) {
  const root = document.documentElement.style;
  const heightOf = (/** @type {HTMLElement} */ sheet) => (sheet.hidden ? 0 : Math.round(sheet.getBoundingClientRect().height));
  const observer = new ResizeObserver(() => {
    root.setProperty('--board-h', `${heightOf(board)}px`);
    root.setProperty('--sheet-h', `${Math.max(heightOf(board), ...others.map(heightOf))}px`);
  });
  for (const sheet of [board, ...others]) observer.observe(sheet);
}

/**
 * Layout, motion and visibility changes, the once-a-second ticker for elapsed times and
 * countdowns (stopped while the tab is hidden), and the first-gesture sound unlock.
 * @param {HudContext} ctx
 * @param {Parts} ui
 * @returns {() => void} stops the ticker
 */
function watchEnvironment(ctx, ui) {
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
  };
  const sync = () => {
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
