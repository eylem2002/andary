// The Approvals panel: permission requests from every crew. A held request (remote approvals on,
// or the demo) can be answered here with Allow / Deny — or A / D while the card has focus — before
// its countdown runs out. Requests that are not held show "Answer in your terminal".
// Commands and paths are shown verbatim in the mono face, as text only.
import { h, renderList, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { describeApproval, formatCountdown } from './format.js';
import { approvalAgentKey, crewNumber, findSession, kbd, roundel, updateRoundel } from './parts.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Approval} Approval */

const MAX_CARDS = 30;

/**
 * Words for a decided approval.
 * @param {Approval} approval
 * @param {'live'|'demo'} mode
 */
export function resultText(approval, mode) {
  const where = approval.decidedBy === 'terminal' ? 'in the terminal' : 'from the town';
  switch (approval.status) {
    case 'allowed':
      return `Allowed ${where}`;
    case 'denied':
      return `Denied ${where}`;
    case 'expired':
      return mode === 'demo' ? 'No answer in time, so the demo carried on' : 'No answer in time, so Claude Code asked in the terminal';
    case 'resolved':
      return 'Answered in the terminal';
    default:
      return '';
  }
}

/** @param {StoreState} state */
export function pendingCount(state) {
  return state.approvals.filter((approval) => approval.status === 'pending').length;
}

/** @param {HudContext} ctx */
export function createApprovalsPanel(ctx) {
  const noteText = h('p', { class: 'hud-note__text' });
  const noteButton = h('button', { type: 'button', class: 'hud-btn hud-btn--small', on: { click: () => ctx.openDialog('settings') } }, 'Open settings');
  const note = h('div', { class: 'hud-note' }, icon('info', { size: 18, className: 'hud-note__icon' }), noteText, noteButton);
  const empty = h('p', { class: 'hud-empty', text: 'Nothing needs your approval right now.' });
  const list = h('ol', { class: 'hud-approvals__list' });
  const el = h('div', { class: 'hud-approvals', 'data-testid': 'approvals' }, h('h2', { class: 'hud-sr', text: 'Approvals' }), note, empty, list);

  /** Decisions sent but not yet confirmed by an approval update. @type {Map<string, string>} */
  const sending = new Map();
  /** @type {WeakMap<HTMLElement, any>} */
  const parts = new WeakMap();

  /**
   * @param {Approval} approval
   * @param {'allow'|'deny'} decision
   */
  function decide(approval, decision) {
    if (sending.has(approval.id) || approval.status !== 'pending' || !approval.held) return;
    if (!ctx.controls.decide(approval.id, decision)) {
      ctx.toasts.show({ tone: 'error', icon: 'warning', title: 'Not connected to Andary', body: 'Answer this request in your terminal.' });
      return;
    }
    sending.set(approval.id, decision);
    ctx.announcer.polite(decision === 'allow' ? 'Allowed.' : 'Denied.');
    ctx.refresh();
  }

  let cards = 0;

  /** @param {Approval} first */
  function createCard(first) {
    // The card takes focus (for A / D): its heading names it and the command describes it.
    const id = `hud-approval-${++cards}`;
    const mark = roundel(0);
    const who = h('h3', { class: 'hud-approval__who', id: `${id}-who` });
    const crew = h('span', { class: 'hud-approval__crew' });
    const tool = h('code', { class: 'hud-approval__tool hud-mono' });
    const detail = h('code', { class: 'hud-approval__detail hud-mono', id: `${id}-detail` });
    const bar = h('span', { class: 'hud-approval__bar' });
    const countdown = h('span', { class: 'hud-approval__left' });
    const timer = h('div', { class: 'hud-approval__timer' }, h('span', { class: 'hud-approval__track', 'aria-hidden': 'true' }, bar), countdown);
    const allow = h('button', { type: 'button', class: 'hud-btn hud-btn--allow', 'data-testid': 'approve' }, icon('check', { size: 18 }), 'Allow', kbd('A'));
    const deny = h('button', { type: 'button', class: 'hud-btn hud-btn--deny', 'data-testid': 'deny' }, icon('cross', { size: 18 }), 'Deny', kbd('D'));
    const actions = h('div', { class: 'hud-approval__actions' }, allow, deny);
    const terminal = h('p', { class: 'hud-approval__terminal' }, icon('terminal', { size: 16 }), 'Answer in your terminal.');
    const result = h('p', { class: 'hud-approval__result' });
    const card = h('article', { class: 'hud-approval', 'data-testid': 'approval-card', 'data-approval-id': first.id, 'aria-labelledby': `${id}-who`, 'aria-describedby': `${id}-detail` },
      h('header', { class: 'hud-approval__head' }, mark, h('div', {}, who, h('p', { class: 'hud-approval__meta' }, crew, tool))),
      h('pre', { class: 'hud-approval__code' }, detail), timer, actions, terminal, result);
    const item = h('li', { class: 'hud-approvals__item' }, card);
    parts.set(item, { mark, who, crew, tool, detail, timer, bar, countdown, actions, allow, deny, terminal, result, card });
    allow.addEventListener('click', () => decide(parts.get(item).approval, 'allow'));
    deny.addEventListener('click', () => decide(parts.get(item).approval, 'deny'));
    card.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if ((key !== 'a' && key !== 'd') || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      decide(parts.get(item).approval, key === 'a' ? 'allow' : 'deny');
    });
    return item;
  }

  /** @param {HTMLElement} item @param {Approval} approval @param {StoreState} state */
  function updateCard(item, approval, state) {
    const p = parts.get(item);
    p.approval = approval;
    if (approval.status !== 'pending') sending.delete(approval.id);
    const session = findSession(state, approval.sessionId);
    const agent = state.agents[approvalAgentKey(approval)];
    const { action, detail } = describeApproval(approval);
    updateRoundel(p.mark, crewNumber(state, approval.sessionId), session?.color);
    setText(p.who, `${agent?.name ?? 'An agent'} wants to ${action}`);
    setText(p.crew, session ? `in ${session.project}` : '');
    setText(p.tool, approval.toolName || 'Tool');
    setText(p.detail, detail || approval.toolName);
    const pending = approval.status === 'pending';
    const answerable = pending && approval.held;
    const busy = sending.has(approval.id);
    setAttr(p.card, 'data-status', approval.status);
    setAttr(p.card, 'tabindex', answerable ? '0' : '-1');
    // The buttons are about to disappear: keep keyboard focus on the card instead of losing it.
    if (!answerable && p.actions.contains(document.activeElement)) p.card.focus();
    setAttr(p.card, 'aria-keyshortcuts', answerable ? 'A D' : null);
    setHidden(p.actions, !answerable);
    setHidden(p.timer, !answerable || !approval.expiresAt);
    setHidden(p.terminal, !pending || approval.held);
    p.allow.disabled = busy;
    p.deny.disabled = busy;
    setText(p.result, busy ? 'Sending your answer…' : resultText(approval, ctx.view.mode));
    setHidden(p.result, pending && !busy);
    tickCard(item, Date.now());
  }

  /** @param {HTMLElement} item @param {number} now */
  function tickCard(item, now) {
    const p = parts.get(item);
    const approval = p?.approval;
    if (!approval?.expiresAt || approval.status !== 'pending') return;
    const left = approval.expiresAt - now;
    const total = Math.max(1, approval.expiresAt - approval.createdAt);
    setText(p.countdown, `${formatCountdown(left)} left`);
    const scale = `scaleX(${Math.max(0, Math.min(1, left / total)).toFixed(3)})`;
    if (p.bar.style.transform !== scale) p.bar.style.transform = scale;
    p.card.classList.toggle('is-urgent', left < 10_000);
  }

  /** @param {StoreState} state */
  function render(state) {
    const shown = state.approvals.slice(0, MAX_CARDS);
    renderList(list, shown, (approval) => approval.id, createCard, (item, approval) => updateCard(item, approval, state));
    setHidden(empty, shown.some((approval) => approval.status === 'pending'));
    renderNote();
  }

  function renderNote() {
    const { mode, serverSettings } = ctx.view;
    const remoteOn = Boolean(serverSettings.remoteApprovals);
    let text = 'Demo requests wait for your answer for 25 seconds of story time, then the demo carries on.';
    if (mode === 'live') {
      text = remoteOn
        ? 'Remote approvals are on: Claude Code waits for your answer here before asking in the terminal.'
        : 'Remote approvals are off, so answer requests in your terminal. Turn them on in Settings to answer here.';
    }
    setText(noteText, text);
    setHidden(noteButton, mode !== 'live' || remoteOn);
  }

  /** @param {number} now */
  function tick(now) {
    for (const item of list.children) tickCard(/** @type {HTMLElement} */ (item), now);
  }

  /** Focuses the first card waiting for an answer, if any. */
  function focusFirstPending() {
    const card = /** @type {HTMLElement|null} */ (list.querySelector('.hud-approval[data-status="pending"][tabindex="0"]'));
    card?.focus();
    return Boolean(card);
  }

  return { el, render, tick, focusFirstPending };
}
