// Notifications on this computer while the town is in a background tab, following "needs you"
// (core/attention.js): an agent asks for your permission, asks a question, has a plan for you, a
// turn stopped, an agent seems stuck, or a finished turn waited with nobody answering. Off until
// the viewer turns them on (the browser then asks for permission); clicking one brings the town
// back. They name the crew (its title, or its project's folder) and never show a command or a
// file, a request's or a stuck step's: they can show on a locked screen. Phone notifications are
// the server's (server/notify.mjs).
//
// The same watcher keeps the page title's count current: the HUD renders on animation frames,
// which a background tab does not get, yet a background tab's title is the one you look at.
import { countedItems } from '../core/attention.js';
import { stuckWords } from '../core/loops.js';
import { updateTitle } from './masthead.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('../core/attention.js').AttentionItem} AttentionItem */

/**
 * Only an item that started to count this recently is news. Older ones arrived with a reconnect
 * or a page that opened in the background; the town shows them, they do not pop up. Long enough
 * for a background tab's slowed timers (a check a minute) to catch a Codex turn that starts to
 * count on a timer.
 */
export const NEWS_MS = 2 * 60_000;
/** Time-based changes (a Codex turn starting to count) are checked this often. */
const CHECK_MS = 15_000;
const MAX_SEEN = 500;

/**
 * The notification a "needs you" item deserves, or null.
 * @param {AttentionItem} item
 * @param {StoreState} state
 * @param {number} now
 * @returns {{ title: string, body: string, tag: string }|null}
 */
export function notificationFor(item, state, now) {
  if (!item.counted || now - item.countedSince > NEWS_MS) return null;
  const crew = crewName(state, item);
  const note = (/** @type {string} */ title, /** @type {string} */ body) => ({ title, body, tag: item.id });
  switch (item.kind) {
    case 'approval':
      return note('Permission needed', `${crew} needs your permission.`);
    case 'terminal':
      return note('Permission needed', `${crew} needs your permission in its terminal.`);
    case 'question':
      return note('Question for you', `${crew} asks you something in its terminal.`);
    case 'plan':
      return note('Plan to approve', `${crew} has a plan for you to approve in its terminal.`);
    case 'stopped':
      return item.crews > 1 ? note('Crews stopped', `${item.text}.`) : note('Turn stopped', `${crew}: ${item.text}.`);
    case 'stuck':
      // The item's own words name the command: these may show on a locked screen.
      return note('Seems stuck', `${crew} seems stuck: ${stuckWords(state.agents[item.agentKey]?.stuck?.rule ?? 1)}.`);
    case 'finished':
      // With one crew at work you are probably at its terminal already.
      return activeCrews(state) > 1 ? note('Turn finished', `${crew} is waiting for your next prompt.`) : null;
    default:
      return null;
  }
}

/** The crew an item is about, by its title or its project. @param {StoreState} state @param {AttentionItem} item */
function crewName(state, item) {
  const session = state.sessions.find((s) => s.id === item.sessionId);
  return session ? session.title || session.project : 'A crew';
}

/** Your crews still in town. @param {StoreState} state */
function activeCrews(state) {
  return state.sessions.filter((s) => s.status !== 'ended' && !s.member).length;
}

/** @param {Pick<HudContext, 'prefs'>} ctx */
function wanted(ctx) {
  return ctx.prefs.desktopNotify && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/** @param {{ title: string, body: string, tag: string }} note */
function show(note) {
  try {
    const n = new Notification(note.title, { body: note.body, tag: note.tag, icon: './favicon.svg' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // some browsers only allow notifications from a service worker
  }
}

/** A request reaches the town a moment after its hook: until then it may still be held there. */
const SETTLE_MS = 3000;
/**
 * New items a screen reader hears of (approvals are announced with their cards). A stuck agent's
 * storm is in the town only, and its row changes without a sound, so it is announced too.
 */
const ANNOUNCED = new Set(['question', 'plan', 'stopped', 'stuck']);

/**
 * Watches the store and the clock: keeps the title's count and the HUD current, notifies each new
 * item once, and tells screen readers of new questions, plans, stops and stuck agents. An item the
 * viewer could already see (the tab in front, or notifications off) never pops up later.
 * @param {Pick<HudContext, 'store'|'needsYou'|'prefs'|'refresh'|'announcer'>} ctx
 * @param {{ now?: () => number, every?: number }} [options]  the clock and how often it is read (tests)
 * @returns {() => void} stops watching
 */
export function installNotifications(ctx, { now: clock = Date.now, every = CHECK_MS } = {}) {
  /** @type {Set<string>} */
  const seen = new Set();
  let queued = false;
  let shownIds = '';
  const check = () => {
    queued = false;
    const state = ctx.store.getState();
    const now = clock();
    const counted = countedItems(ctx.needsYou.items(state, now));
    updateTitle(counted.length);
    // The clock alone can change the list (a Codex turn starts to count, a finished one stops):
    // the HUD then renders without a store change to wake it.
    const ids = counted.map((item) => item.id).join('\n');
    if (ids !== shownIds) ctx.refresh();
    shownIds = ids;
    const notify = wanted(ctx);
    for (const item of counted) {
      if (seen.has(item.id) || (!item.settled && now - item.since < SETTLE_MS)) continue;
      seen.add(item.id);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value ?? '');
      if (now - item.countedSince > NEWS_MS) continue;
      // Backticks mark a command on screen; read aloud they are noise.
      if (ANNOUNCED.has(item.kind)) ctx.announcer.polite(`${crewName(state, item)}: ${item.text.replaceAll('`', '')}`);
      const note = notify ? notificationFor(item, state, now) : null;
      if (note) show(note);
    }
  };
  // One check per batch of changes: a reconnect replays the history in one go, and what was
  // asked and answered within it is no news.
  const stop = ctx.store.subscribe(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(check);
  });
  const timer = setInterval(check, every);
  check();
  return () => {
    stop();
    clearInterval(timer);
  };
}

/**
 * Turns notifications on (asking the browser first) or off. Returns what happened, in words.
 * @param {HudContext} ctx
 * @param {boolean} on
 * @returns {Promise<string>}
 */
export async function setDesktopNotify(ctx, on) {
  if (!on) {
    ctx.setPrefs({ desktopNotify: false });
    return 'Notifications are off.';
  }
  if (typeof Notification === 'undefined') return 'This browser cannot show notifications.';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') {
    ctx.setPrefs({ desktopNotify: false });
    return 'The browser blocked notifications for this page. Allow them in the site settings, then try again.';
  }
  ctx.setPrefs({ desktopNotify: true });
  return 'Notifications are on while the town is in the background.';
}
