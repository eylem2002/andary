// The top of the screen: the town's street sign (brand + live counts) on the left; on the right,
// "3 need you" while agents wait for you (like a wanted level: it stays until you act, and a click
// goes to the most urgent, the next click to the next one), "Catch me up" beside it when you come
// back from time away (ui/catch-up.js), the connection status, the command palette (Ctrl-K)
// and settings. The page title
// carries the same count for a background tab.
import { h, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { listJoin, plural } from './format.js';
import { countedItems } from '../core/attention.js';
import { needsYouLabel } from './needs-you.js';
import { onMac } from './shortcuts.js';

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
  const findButton = h('button', { type: 'button', class: 'hud-iconbtn hud-iconbtn--board', 'aria-label': 'Find a crew, an agent or an action', 'aria-keyshortcuts': onMac() ? 'Meta+K' : 'Control+K', title: onMac() ? 'Find (⌘ K)' : 'Find (Ctrl K)', 'data-testid': 'palette-button', on: { click: () => ctx.openDialog('palette') } },
    icon('search'));
  const settingsButton = h('button', { type: 'button', class: 'hud-iconbtn hud-iconbtn--board', 'aria-label': 'Settings', 'data-testid': 'settings-button', on: { click: () => ctx.openDialog('settings') } },
    icon('settings'));

  const waitingCount = h('span', { class: 'hud-waiting__count' });
  const waitingWords = h('span', { class: 'hud-waiting__words' });
  const waiting = h('button', { type: 'button', class: 'hud-btn hud-btn--board hud-waiting', hidden: true, 'data-testid': 'waiting-for-you', 'aria-keyshortcuts': 'I', on: { click: () => ctx.run('needs-you') } },
    icon('hourglass', { size: 18 }), waitingCount, waitingWords);
  // Its name starts with its visible words, which phones keep too (they leave out the icon).
  const catchUp = h('button', { type: 'button', class: 'hud-btn hud-btn--board hud-catchup-offer', hidden: true, 'data-testid': 'catch-up-button', 'aria-keyshortcuts': 'W', 'aria-label': 'Catch me up on what your crews did while you were away', on: { click: () => ctx.run('catch-up') } },
    icon('clock', { size: 18 }), h('span', { class: 'hud-catchup-offer__words', text: 'Catch me up' }));

  const el = h('header', { class: 'hud hud-masthead' }, sign, h('div', { class: 'hud-topright' }, waiting, catchUp, setupButton, status, findButton, settingsButton));

  /** @param {StoreState} state */
  function render(state) {
    setText(subtitle, subtitleFor(state, ctx.view));
    const items = ctx.needsYou.items(state);
    const counted = countedItems(items);
    const n = counted.length;
    // Answered elsewhere while the button had the keyboard: keep focus in the cluster.
    if (n === 0 && document.activeElement === waiting) settingsButton.focus();
    setHidden(waiting, n === 0);
    setText(waitingCount, String(n));
    setText(waitingWords, n === 1 ? 'needs you' : 'need you');
    setAttr(waiting, 'aria-label', needsYouLabel(counted, ctx.needsYou.peek(items)));
    // Yellow while an agent is blocked or stopped; quieter when crews only finished their turns.
    setAttr(waiting, 'data-level', counted[0]?.level ?? null);
    updateTitle(n);
    const offered = ctx.catchUp.offered();
    // Gone once you have looked (after the dialog closed): focus moves on to what is still there.
    if (!offered && document.activeElement === catchUp) (focusFallback(waiting) ?? settingsButton).focus();
    setHidden(catchUp, !offered);
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

/**
 * Where focus goes when the masthead button it was on goes away: the "need you" button while it
 * shows, else the toolbar's current button.
 * @param {HTMLElement|null} [waiting]  the "need you" button (found in the page when not given)
 * @returns {HTMLElement|null}
 */
export function focusFallback(waiting = document.querySelector('[data-testid="waiting-for-you"]')) {
  if (waiting && !waiting.hidden) return waiting;
  return document.querySelector('.hud-toolbar [tabindex="0"]');
}

/** "(2) Andary" while things need you, so a background tab shows it. @param {number} count */
export function pageTitle(count) {
  return count > 0 ? `(${count}) Andary` : 'Andary';
}

/** @param {number} count */
export function updateTitle(count) {
  const title = pageTitle(count);
  if (document.title !== title) document.title = title;
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
