// What the viewer can do: select an agent or building, follow, switch tabs, open dialogs, and the
// toolbar / keyboard actions. Each function takes the HUD (its context and components).
import { timeOfDayFor } from './appearance.js';
import { directorActive } from './cinema.js';
import { nextPlaceNames } from '../core/place-names.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').Selection} Selection */
/** @typedef {import('./types.js').StoreState} StoreState */

/**
 * @typedef {object} HudParts
 * @property {ReturnType<typeof import('./crews.js').createCrewsPanel>} crews
 * @property {ReturnType<typeof import('./board.js').createBoard>} board
 * @property {ReturnType<typeof import('./inspector.js').createInspector>} inspector
 * @property {ReturnType<typeof import('./building-card.js').createBuildingCard>} place
 * @property {ReturnType<typeof import('./approvals.js').createApprovalsPanel>} approvals
 * @property {Record<'help'|'settings'|'setup'|'diff'|'usage'|'leaderboard', { open(): void, close(): void, isOpen: boolean }>} dialogs
 */

/** @typedef {{ ctx: HudContext, ui: HudParts }} Hud */

/** What N switches to next: the local clock, day, sunset, night, and round again. */
export const NEXT_TIME = Object.freeze({ auto: 'day', day: 'sunset', sunset: 'night', night: 'auto' });
const NEXT_SPEED = { 1: 2, 2: 4, 4: 1 };
const TIME_SPOKEN = { auto: 'Time of day follows your clock.', day: 'Daytime.', sunset: 'Sunset.', night: 'Night-time.' };

/** @param {Selection|null} a @param {Selection|null} b */
export function sameSelection(a, b) {
  if (!a || !b) return a === b;
  if (a.type === 'agent' && b.type === 'agent') return a.id === b.id;
  if (a.type === 'building' && b.type === 'building') return a.key === b.key;
  return false;
}

/**
 * The agent most worth watching: the most recently active one that is working, else the most
 * recently active one still around.
 * @param {StoreState} state
 * @returns {string|null}
 */
export function busiestAgent(state) {
  const agents = Object.values(state.agents).filter((agent) => agent.status !== 'done');
  const latest = (/** @type {typeof agents} */ list) => list.sort((a, b) => b.lastActivity - a.lastActivity)[0]?.key ?? null;
  return latest(agents.filter((agent) => agent.status === 'working')) ?? latest(agents);
}

/**
 * Selects an agent or building (or nothing): opens the matching panel, tells the world, and
 * points the camera unless the selection came from a click in the world itself.
 * @param {Hud} hud
 * @param {Selection|null} sel
 * @param {{ camera?: boolean, from?: 'hud'|'world', focus?: boolean }} [options]
 */
export function select({ ctx, ui }, sel, { camera = true, from = 'hud', focus = false } = {}) {
  if (from === 'world' && sameSelection(sel, ctx.view.selection)) return;
  const world = ctx.world();
  ctx.view.selection = sel;
  if (from !== 'world') world?.select(sel);
  if (sel?.type === 'agent') {
    ui.place.hide();
    if (camera) world?.focusAgent(sel.id, { follow: ctx.view.follow });
    ui.inspector.open(sel.id, { focus });
  } else if (sel?.type === 'building') {
    ui.inspector.hide({ restoreFocus: false });
    if (camera) world?.focusBuilding(sel.key);
    ui.place.open(sel.key, { focus });
  } else {
    ui.inspector.hide();
    ui.place.hide();
    if (ctx.view.follow) setFollow({ ctx, ui }, false);
  }
  ctx.refresh();
}

/**
 * Follows the selected agent with the camera (or the busiest one when nobody is selected).
 * @param {Hud} hud
 * @param {boolean} [on]
 */
export function setFollow(hud, on = !hud.ctx.view.follow) {
  const { ctx } = hud;
  if (!on) {
    ctx.view.follow = false;
    ctx.world()?.stopFollow();
    ctx.refresh();
    return;
  }
  const state = ctx.store.getState();
  const id = ctx.view.selection?.type === 'agent' ? ctx.view.selection.id : busiestAgent(state);
  if (!id) {
    ctx.toasts.show({ title: 'Nobody to follow yet', body: 'Agents appear as soon as a crew starts working.' });
    return;
  }
  ctx.view.follow = true;
  if (!sameSelection(ctx.view.selection, { type: 'agent', id })) select(hud, { type: 'agent', id }, { camera: false });
  ctx.world()?.focusAgent(id, { follow: true });
  ctx.announcer.polite(`Following ${state.agents[id]?.name ?? 'the agent'}.`);
  ctx.refresh();
}

/**
 * @param {Hud} hud
 * @param {'help'|'settings'|'setup'|'diff'|'usage'|'leaderboard'} name
 */
export function openDialog({ ui }, name) {
  for (const [key, dialog] of Object.entries(ui.dialogs)) if (key !== name && dialog.isOpen) dialog.close();
  ui.dialogs[name].open();
}

/**
 * The side panels are hidden when the viewer asked for it, and by default in a hosted demo,
 * where the town itself is the point. Without a 3D view the panels are all there is to see.
 * @param {HudContext} ctx
 */
export function panelsHidden(ctx) {
  if (ctx.view.worldFailed) return false;
  return ctx.prefs.panels === 'hidden' || (ctx.prefs.panels === 'auto' && ctx.view.hosted);
}

/**
 * Runs a toolbar action by name (also used by the keyboard shortcuts).
 * @param {Hud} hud
 * @param {string} action
 */
export function runAction(hud, action) {
  const { ctx } = hud;
  const world = ctx.world();
  // Moving the camera by hand tells the director camera to stand back for a while.
  const byHand = (/** @type {() => void} */ move) => () => {
    ctx.cinema.viewerTookCamera();
    move();
  };
  /** @type {Record<string, () => void>} */
  const actions = {
    director: () => toggleDirector(hud),
    'toggle-panels': () => togglePanels(ctx),
    follow: () => setFollow(hud),
    'rotate-left': byHand(() => world?.rotateCamera(-1)),
    'rotate-right': byHand(() => world?.rotateCamera(1)),
    'zoom-in': byHand(() => world?.zoomBy(1.25)),
    'zoom-out': byHand(() => world?.zoomBy(0.8)),
    'reset-view': byHand(() => {
      if (ctx.view.follow) setFollow(hud, false);
      world?.resetCamera();
    }),
    'cycle-time': () => cycleTime(ctx),
    'place-names': () => cyclePlaceNames(ctx),
    'toggle-quality': () => ctx.setPrefs({ quality: ctx.prefs.quality === 'low' ? 'high' : 'low' }),
    'toggle-sound': () => toggleSound(ctx),
    pause: () => togglePause(ctx),
    'cycle-speed': () => cycleSpeed(ctx),
    'needs-you': () => goToNextNeed(hud),
    help: () => openDialog(hud, 'help'),
    usage: () => openDialog(hud, 'usage'),
    leaderboard: () => openDialog(hud, 'leaderboard'),
  };
  actions[action]?.();
}

/**
 * Goes to what needs the viewer, most urgent first; again goes on to the next one. A request the
 * town can answer opens its card in Approvals (the full change is shown there); anything else is
 * answered in the terminal, so the agent is selected and the camera points at it.
 * @param {Hud} hud
 */
function goToNextNeed(hud) {
  const { ctx, ui } = hud;
  const item = ctx.needsYou.next(ctx.needsYou.items(ctx.store.getState()));
  if (!item) {
    ctx.announcer.polite('Nothing needs you right now.');
    return;
  }
  if (item.approvalId) {
    ctx.showTab('approvals');
    ui.approvals.focusApproval(item.approvalId);
  } else {
    select(hud, { type: 'agent', id: item.agentKey }, { camera: true, focus: true });
  }
}

/**
 * Turning the director camera on hands it the camera now: any selection and follow are dropped.
 * @param {Hud} hud
 */
function toggleDirector(hud) {
  const { ctx } = hud;
  const on = !directorActive(ctx);
  ctx.setPrefs({ directorCam: on ? 'on' : 'off' });
  if (on) {
    if (ctx.view.selection) select(hud, null, { camera: false });
    if (ctx.view.follow) setFollow(hud, false);
  }
  ctx.cinema.setEnabled(on);
  ctx.announcer.polite(on ? 'Director camera on: it follows the action by itself.' : 'Director camera off.');
  ctx.refresh();
}

/** @param {HudContext} ctx */
function togglePanels(ctx) {
  if (ctx.view.worldFailed) {
    ctx.announcer.polite('The 3D town could not start, so the side boards stay on screen.');
    return;
  }
  const hide = !panelsHidden(ctx);
  ctx.setPrefs({ panels: hide ? 'hidden' : 'shown' });
  ctx.announcer.polite(hide ? 'Full-screen town on: the side boards are put away.' : 'Full-screen town off: the side boards are back.');
  ctx.refresh();
}

/** @param {HudContext} ctx */
function cycleTime(ctx) {
  ctx.setPrefs({ timeMode: /** @type {any} */ (NEXT_TIME[ctx.prefs.timeMode]) });
  ctx.world()?.setTimeOfDay(timeOfDayFor(ctx.prefs.timeMode));
  ctx.announcer.polite(TIME_SPOKEN[ctx.prefs.timeMode]);
}

/** What screen readers hear after the "P" key. */
const PLACE_NAMES_SPOKEN = Object.freeze({
  auto: 'Place names on the buildings where they fit. Zoom in to see more.',
  always: 'Place names always shown.',
  off: 'Place names off. Point at a building to see its name.',
});

/** @param {HudContext} ctx */
function cyclePlaceNames(ctx) {
  ctx.setPrefs({ placeNames: nextPlaceNames(ctx.prefs.placeNames) });
  ctx.announcer.polite(PLACE_NAMES_SPOKEN[ctx.prefs.placeNames]);
}

/** Runs inside a click or key handler, which is what lets the browser start audio. @param {HudContext} ctx */
function toggleSound(ctx) {
  const on = !ctx.sound.enabled;
  ctx.sound.setEnabled(on);
  ctx.setPrefs({ sound: on });
  if (on) ctx.sound.play('pop');
  ctx.announcer.polite(on ? 'Sound on.' : 'Sound off.');
}

/** @param {HudContext} ctx */
function togglePause(ctx) {
  if (ctx.view.mode !== 'demo') return;
  ctx.view.paused = !ctx.view.paused;
  document.documentElement.dataset.paused = String(ctx.view.paused);
  ctx.controls.setPaused(ctx.view.paused);
  ctx.announcer.polite(ctx.view.paused ? 'Demo paused.' : 'Demo running.');
  ctx.refresh();
}

/** @param {HudContext} ctx */
function cycleSpeed(ctx) {
  ctx.setPrefs({ speed: /** @type {1|2|4} */ (NEXT_SPEED[ctx.prefs.speed]) });
  ctx.controls.setSpeed(ctx.prefs.speed);
  ctx.announcer.polite(`Demo speed ${ctx.prefs.speed} times.`);
}

/**
 * Handles a keyboard shortcut; returns true when the key was used.
 * @param {Hud} hud
 * @param {import('./shortcuts.js').ShortcutAction} action
 * @param {KeyboardEvent} event
 */
export function handleShortcut(hud, action, event) {
  const { ctx, ui } = hud;
  // With a dialog open only "?" (to close help) applies; Escape is the dialog's own.
  if (Object.values(ui.dialogs).some((dialog) => dialog.isOpen)) {
    if (action === 'help' && ui.dialogs.help.isOpen) ui.dialogs.help.close();
    return action === 'help';
  }
  // The 3D view zooms itself with +/- when it has focus.
  const inWorld = document.getElementById('world')?.contains(/** @type {Node} */ (event.target));
  if (inWorld && (action === 'zoom-in' || action === 'zoom-out')) return false;
  if (action === 'escape') return escape(hud);
  if (action === 'approvals') {
    ctx.showTab('approvals', { focus: true });
    return true;
  }
  if (action.startsWith('crew-')) return selectCrew(hud, Number(action.slice(5)));
  if (action === 'pause' && ctx.view.mode !== 'demo') return false;
  runAction(hud, action);
  return true;
}

/**
 * Escape closes the innermost open thing (building card or inspector), then stops following.
 * It also hides tooltips until the pointer or focus moves.
 * @param {Hud} hud
 */
function escape(hud) {
  const { ctx, ui } = hud;
  document.documentElement.classList.add('hud-tips-hidden');
  if (ui.place.buildingKey || ui.inspector.agentKey) {
    select(hud, null, { camera: false });
    return true;
  }
  if (ctx.view.follow) {
    setFollow(hud, false);
    return true;
  }
  return false;
}

/**
 * Keys 1–9: jump to that crew's lead agent.
 * @param {Hud} hud
 * @param {number} number  1-based crew number
 */
function selectCrew(hud, number) {
  const state = hud.ctx.store.getState();
  const session = state.sessions.find((s) => s.number === number);
  const lead = session?.agentKeys.find((key) => state.agents[key]?.role === 'lead') ?? session?.agentKeys[0];
  if (!lead) return false;
  hud.ui.crews.reveal(session.id);
  select(hud, { type: 'agent', id: lead }, { camera: true });
  return true;
}
