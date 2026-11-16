// Small building blocks shared by the HUD panels: crew roundels, status chips, key caps, and the
// lookups that tie agents and approvals back to their crew.
import { h, setAttr, setCrewColor, setText } from './dom.js';
import { statusMark } from './icons.js';
import { statusLabel } from './format.js';

/**
 * @typedef {import('./types.js').StoreState} StoreState
 * @typedef {import('./types.js').Session} Session
 */

/**
 * The metro-style crew roundel: the crew's line colour with its number, which is also the crew's
 * keyboard shortcut (1–9).
 * @param {number} number
 * @param {string} [color]
 */
export function roundel(number, color) {
  const el = h('span', { class: 'hud-roundel', 'aria-hidden': 'true' });
  updateRoundel(el, number, color);
  return el;
}

/** @param {HTMLElement} el @param {number} number @param {string} [color] */
export function updateRoundel(el, number, color) {
  setText(el, number > 0 ? String(number) : '');
  setCrewColor(el, color);
}

/**
 * A status chip: shape + colour, with the status in words for screen readers (or on screen when
 * `labelled`).
 * @param {string} status
 * @param {{ labelled?: boolean }} [options]
 */
export function statusChip(status, { labelled = false } = {}) {
  const el = h('span', { class: labelled ? 'hud-chip hud-chip--labelled' : 'hud-chip' });
  updateStatusChip(el, status);
  return el;
}

/** @param {HTMLElement} el @param {string} status */
export function updateStatusChip(el, status) {
  if (el.dataset.status === status) return;
  el.dataset.status = status;
  el.replaceChildren(statusMark(status), h('span', { class: el.classList.contains('hud-chip--labelled') ? 'hud-chip__label' : 'hud-sr', text: statusLabel(status) }));
}

/** @param {string} text */
export function kbd(text) {
  return h('kbd', { class: 'hud-kbd', text });
}

/**
 * 1-based crew number in first-seen order (stable for the session's lifetime), or 0 if unknown.
 * @param {StoreState} state
 * @param {string} sessionId
 */
export function crewNumber(state, sessionId) {
  return state.sessions.findIndex((session) => session.id === sessionId) + 1;
}

/**
 * @param {StoreState} state
 * @param {string} sessionId
 * @returns {Session|undefined}
 */
export function findSession(state, sessionId) {
  return state.sessions.find((session) => session.id === sessionId);
}

/**
 * The agent an approval belongs to (agentKey = sessionId + ':' + (agentId ?? 'main')).
 * @param {{ sessionId: string, agentId?: string|null }} approval
 */
export function approvalAgentKey(approval) {
  return `${approval.sessionId}:${approval.agentId ?? 'main'}`;
}

/**
 * Marks the element as the current selection for assistive tech and styling.
 * @param {HTMLElement} el
 * @param {boolean} current
 */
export function setCurrent(el, current) {
  setAttr(el, 'aria-current', current ? 'true' : null);
}
