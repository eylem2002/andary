// The top of the screen: the town's street sign (brand + live counts) on the left; on the right,
// "waiting for you" when approvals wait (like a wanted level: it stays until you answer), the
// connection status and settings. The page title carries the same count for a background tab.
import { h, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { listJoin, plural } from './format.js';
import { pendingCount } from './approvals.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */

/** Text and icon of the status pill; the words are what tests and screen readers rely on. */
const STATUS = {
  live: { text: 'Live', icon: 'live' },
  demo: { text: 'Demo', icon: 'play' },
  connecting: { text: 'Connecting…', icon: 'connecting' },
  offline: { text: 'Offline', icon: 'offline' },
  signin: { text: 'Sign in', icon: 'key' },
};

/** @param {HudContext} ctx */
export function createMasthead(ctx) {
  const subtitle = h('p', { class: 'hud-sign__sub' });
  const sign = h('div', { class: 'hud-sign' }, h('div', { class: 'hud-sign__inner' }, h('h1', { class: 'hud-sign__title', text: 'Andary' }), subtitle));

  const statusText = h('span', { class: 'hud-status__text' });
  const statusIcon = h('span', { class: 'hud-status__icon', 'aria-hidden': 'true' });
  const status = h('div', { class: 'hud-status', 'data-testid': 'connection-status', role: 'status' }, statusIcon, statusText);

  const setupButton = h('button', { type: 'button', class: 'hud-btn hud-btn--board hud-setup-button', hidden: true, on: { click: () => ctx.openDialog('setup') } },
    icon('terminal', { size: 18 }), 'Use your own Claude Code');
  const settingsButton = h('button', { type: 'button', class: 'hud-iconbtn hud-iconbtn--board', 'aria-label': 'Settings', 'data-testid': 'settings-button', on: { click: () => ctx.openDialog('settings') } },
    icon('settings'));

  const waitingCount = h('span', { class: 'hud-waiting__count' });
  const waitingWords = h('span', { class: 'hud-waiting__words' });
  const waiting = h('button', { type: 'button', class: 'hud-btn hud-btn--board hud-waiting', hidden: true, 'data-testid': 'waiting-for-you', on: { click: () => ctx.showTab('approvals', { focus: true }) } },
    icon('hourglass', { size: 18 }), waitingCount, waitingWords);

  const el = h('header', { class: 'hud hud-masthead' }, sign, h('div', { class: 'hud-topright' }, waiting, setupButton, status, settingsButton));

  /** @param {StoreState} state */
  function render(state) {
    setText(subtitle, subtitleFor(state, ctx.view));
    const pending = pendingCount(state);
    // Answered elsewhere while the button had the keyboard: keep focus in the cluster.
    if (pending === 0 && document.activeElement === waiting) settingsButton.focus();
    setHidden(waiting, pending === 0);
    setText(waitingCount, String(pending));
    setText(waitingWords, pending === 1 ? 'approval waiting for you' : 'approvals waiting for you');
    setAttr(waiting, 'aria-label', waitingLabel(pending));
    const title = pageTitle(pending);
    if (document.title !== title) document.title = title;
    const key = ctx.view.connection;
    const info = STATUS[key] ?? STATUS.connecting;
    const text = key === 'demo' && ctx.view.paused ? 'Demo, paused' : info.text;
    setText(statusText, text);
    if (statusIcon.dataset.icon !== info.icon) {
      statusIcon.dataset.icon = info.icon;
      statusIcon.replaceChildren(statusGlyph(info.icon));
    }
    setAttr(status, 'data-state', key);
    setHidden(setupButton, ctx.view.mode !== 'demo' || ctx.view.serverAvailable);
  }

  return { el, render };
}

/** The button's words: what is waiting, and on whom. @param {number} pending */
export function waitingLabel(pending) {
  return pending === 1 ? '1 approval waiting for you' : `${pending} approvals waiting for you`;
}

/** "(2) Andary" while approvals wait, so a background tab shows it. @param {number} pending */
export function pageTitle(pending) {
  return pending > 0 ? `(${pending}) Andary` : 'Andary';
}

/**
 * "2 crews, 5 agents, 128 tool calls" while anything is in town; otherwise what the town waits for.
 * @param {StoreState} state
 * @param {import('./types.js').ViewState} view
 */
export function subtitleFor(state, view) {
  const crews = state.sessions.filter((session) => session.status !== 'ended');
  if (!crews.length) {
    if (view.mode === 'demo') return 'The demo crews are on their way';
    if (view.connection === 'signin') return 'Sign in to see your crews';
    return state.sessions.length ? 'Every crew has gone home' : 'Waiting for Claude Code';
  }
  const active = new Set(crews.map((session) => session.id));
  const agents = Object.values(state.agents).filter((agent) => active.has(agent.sessionId) && agent.status !== 'done').length;
  return listJoin([plural(crews.length, 'crew'), plural(agents, 'agent'), plural(state.stats.toolCalls, 'tool call')]);
}

/** @param {string} kind */
function statusGlyph(kind) {
  if (kind === 'play') return icon('play', { size: 14 });
  if (kind === 'key') return icon('key', { size: 14 });
  return h('span', { class: `hud-status__dot hud-status__dot--${kind}` });
}
