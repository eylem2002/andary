// The Approvals panel: permission requests from every crew. A held request (remote approvals on,
// or the demo) can be answered here with Allow / Deny — or A / D while the card has focus — before
// its countdown runs out, with an optional reason for a denial that goes back to the agent.
// Requests that are not held show "Answer in your terminal". Commands and paths are shown
// verbatim in the mono face, as text only, and a file change in full: a Write's content, an
// Edit's diff, with hidden characters revealed, so nothing is approved unseen.
import { h, renderList, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { approvalChange, describeApproval, formatCountdown } from './format.js';
import { diffView } from './diff-view.js';
import { diffStats } from './diff.js';
import { approvalAgentKey, crewNumber, findSession, kbd, roundel, updateRoundel } from './parts.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Approval} Approval */

const MAX_CARDS = 30;
/** The longest deny reason sent (the server keeps 500 characters). */
export const MAX_REASON_CHARS = 500;

/**
 * New requests are listed first, so a card can slide under the pointer just as the viewer clicks
 * the one they read (and a settled card above can move away). A click on Allow / Deny only counts
 * once its card has stayed in place this long, like the input delay of browser permission prompts.
 * Keyboard answers are not delayed: focus stays on the card the viewer chose.
 */
export const ANSWER_DELAY_MS = 1000;

/**
 * Whether a card that last appeared or moved at `armedAt` may take a pointer answer at `now`.
 * @param {number} armedAt
 * @param {number} now
 */
export function answerReady(armedAt, now) {
  return now - armedAt >= ANSWER_DELAY_MS;
}

/**
 * Restarts the answer delay when a card appears or changes place in the list: its buttons read as
 * unavailable (aria-disabled, not disabled, so focus is never lost) until the delay is over.
 * @param {any} p the card's parts
 * @param {number} index its place in the list now
 */
function armCard(p, index) {
  if (p.index === index) return;
  p.index = index;
  p.armedAt = performance.now();
  for (const button of [p.allow, p.deny]) setAttr(button, 'aria-disabled', 'true');
  clearTimeout(p.armTimer);
  p.armTimer = setTimeout(() => {
    for (const button of [p.allow, p.deny]) setAttr(button, 'aria-disabled', null);
  }, ANSWER_DELAY_MS);
}

/**
 * Whether a click on Allow / Deny counts. event.detail is 0 for Enter / Space: keyboard answers go
 * to the focused card, so only pointer clicks wait for the delay.
 * @param {MouseEvent} event
 * @param {any} p the card's parts
 */
function clickCounts(event, p) {
  return event.detail === 0 || answerReady(p.armedAt, performance.now());
}

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
      return approval.message ? `Denied ${where}: “${approval.message}”` : `Denied ${where}`;
    case 'expired':
      return mode === 'demo' ? 'No answer in time, so the demo carried on' : 'No answer in time, so the terminal asked instead';
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

/**
 * The DOM of one card; the panel wires its behaviour. The card takes focus (for A / D): its
 * heading names it and the command describes it.
 * @param {string} id prefix for the ids the card's aria attributes point at
 * @param {string} approvalId
 */
function buildCard(id, approvalId) {
  const mark = roundel(0);
  const who = h('h3', { class: 'hud-approval__who', id: `${id}-who` });
  const crew = h('span', { class: 'hud-approval__crew' });
  const tool = h('code', { class: 'hud-approval__tool hud-mono' });
  const detail = h('code', { class: 'hud-approval__detail hud-mono', id: `${id}-detail` });
  // What the request cannot say that allowing it grants (a Codex command may leave its sandbox).
  const grants = h('p', { class: 'hud-approval__grants', id: `${id}-grants`, 'data-testid': 'approval-grants' });
  const changeNote = h('p', { class: 'hud-approval__change-note' });
  const changeBody = h('div', { class: 'hud-approval__change-body' });
  const change = h('div', { class: 'hud-approval__change', 'data-testid': 'approval-change' }, changeNote, changeBody);
  const reason = /** @type {HTMLInputElement} */ (h('input', { type: 'text', class: 'hud-input hud-approval__reason-input', id: `${id}-reason`, maxlength: String(MAX_REASON_CHARS), autocomplete: 'off', spellcheck: 'true', 'data-testid': 'deny-reason' }));
  const reasonRow = h('div', { class: 'hud-approval__reason' }, h('label', { for: `${id}-reason`, text: 'Reason, if you deny (optional; the agent reads it)' }), reason);
  const bar = h('span', { class: 'hud-approval__bar' });
  const countdown = h('span', { class: 'hud-approval__left' });
  const timer = h('div', { class: 'hud-approval__timer' }, h('span', { class: 'hud-approval__track', 'aria-hidden': 'true' }, bar), countdown);
  const allow = h('button', { type: 'button', class: 'hud-btn hud-btn--allow', 'data-testid': 'approve' }, icon('check', { size: 18 }), 'Allow', kbd('A'));
  const deny = h('button', { type: 'button', class: 'hud-btn hud-btn--deny', 'data-testid': 'deny' }, icon('cross', { size: 18 }), 'Deny', kbd('D'));
  const actions = h('div', { class: 'hud-approval__actions' }, allow, deny);
  const terminal = h('p', { class: 'hud-approval__terminal' }, icon('terminal', { size: 16 }), h('span', { text: 'Answer in your terminal.' }));
  const result = h('p', { class: 'hud-approval__result' });
  const card = h('article', { class: 'hud-approval', 'data-testid': 'approval-card', 'data-approval-id': approvalId, 'aria-labelledby': `${id}-who`, 'aria-describedby': `${id}-detail ${id}-grants` },
    h('header', { class: 'hud-approval__head' }, mark, h('div', {}, who, h('p', { class: 'hud-approval__meta' }, crew, tool))),
    h('pre', { class: 'hud-approval__code' }, detail), grants, change, timer, reasonRow, actions, terminal, result);
  const item = h('li', { class: 'hud-approvals__item' }, card);
  return { item, parts: { mark, who, crew, tool, detail, grants, change, changeNote, changeBody, changeKey: '', reason, reasonRow, timer, bar, countdown, actions, allow, deny, terminal, result, card, index: -1, armedAt: 0, armTimer: 0 } };
}

/**
 * Who asks, in which crew, to run what.
 * @param {any} p the card's parts
 * @param {Approval} approval
 * @param {StoreState} state
 */
function describeRequest(p, approval, state) {
  const session = findSession(state, approval.sessionId);
  const agent = state.agents[approvalAgentKey(approval)];
  const { action, detail, note = '' } = describeApproval(approval, { exact: true });
  updateRoundel(p.mark, crewNumber(state, approval.sessionId), session?.color);
  setText(p.who, `${agent?.name ?? 'An agent'} wants to ${action}`);
  setText(p.crew, session ? `in ${session.project}` : '');
  setText(p.tool, approval.toolName || 'Tool');
  setText(p.detail, detail || approval.toolName);
  setText(p.grants, note);
  setHidden(p.grants, !note);
  showChange(p, approval);
}

/**
 * The full change a file tool would make, rebuilt only when the request is a different one.
 * @param {any} p the card's parts
 * @param {Approval} approval
 */
function showChange(p, approval) {
  if (p.changeKey === approval.id) return;
  p.changeKey = approval.id;
  const change = approvalChange(approval.toolName, approval.toolInput);
  setHidden(p.change, !change);
  if (!change) {
    p.changeBody.replaceChildren();
    return;
  }
  const { added, removed } = diffStats(change.hunks);
  setText(p.changeNote, `${change.note}: ${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed`);
  p.changeBody.replaceChildren(...change.hunks.map((hunk, index) => diffView(hunk, { index, count: change.hunks.length, exact: true, compact: true })));
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
   * @param {string} [reason] sent with a denial only
   */
  function decide(approval, decision, reason = '') {
    if (sending.has(approval.id) || approval.status !== 'pending' || !approval.held) return;
    const message = decision === 'deny' ? reason.trim().slice(0, MAX_REASON_CHARS) : '';
    if (!ctx.controls.decide(approval.id, decision, message || undefined)) {
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
    const { item, parts: p } = buildCard(`hud-approval-${++cards}`, first.id);
    parts.set(item, p);
    p.allow.addEventListener('click', (event) => clickCounts(event, p) && decide(p.approval, 'allow'));
    p.deny.addEventListener('click', (event) => clickCounts(event, p) && decide(p.approval, 'deny', p.reason.value));
    // Enter in the reason field denies with that reason; typing there never answers by itself.
    p.reason.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        decide(p.approval, 'deny', p.reason.value);
      }
    });
    p.card.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if ((key !== 'a' && key !== 'd') || event.ctrlKey || event.metaKey || event.altKey) return;
      // A / D answer from the card and its buttons, not while reading the change.
      if (p.change.contains(/** @type {Node} */ (event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      decide(p.approval, key === 'a' ? 'allow' : 'deny', p.reason.value);
    });
    return item;
  }

  /** @param {HTMLElement} item @param {Approval} approval @param {StoreState} state @param {number} index */
  function updateCard(item, approval, state, index) {
    const p = parts.get(item);
    p.approval = approval;
    armCard(p, index);
    if (approval.status !== 'pending') sending.delete(approval.id);
    describeRequest(p, approval, state);
    showAnswerState(p, approval);
    tickCard(item, Date.now());
  }

  /**
   * Which of the buttons, countdown, terminal hint and result line a card shows.
   * @param {any} p the card's parts
   * @param {Approval} approval
   */
  function showAnswerState(p, approval) {
    const pending = approval.status === 'pending';
    const answerable = pending && approval.held;
    const busy = sending.has(approval.id);
    setAttr(p.card, 'data-status', approval.status);
    setAttr(p.card, 'tabindex', answerable ? '0' : '-1');
    // The buttons are about to disappear: keep keyboard focus on the card instead of losing it.
    if (!answerable && (p.actions.contains(document.activeElement) || p.reasonRow.contains(document.activeElement))) p.card.focus();
    setAttr(p.card, 'aria-keyshortcuts', answerable ? 'A D' : null);
    setHidden(p.actions, !answerable);
    setHidden(p.reasonRow, !answerable);
    p.reason.disabled = busy;
    setHidden(p.timer, !answerable || !approval.expiresAt);
    setHidden(p.terminal, !pending || approval.held);
    // The server says why it left a request to the terminal (e.g. it could not be shown in full).
    setText(p.terminal.lastElementChild, pending && approval.message ? `Answer in your terminal. ${approval.message}.` : 'Answer in your terminal.');
    p.allow.disabled = busy;
    p.deny.disabled = busy;
    setText(p.result, busy ? 'Sending your answer…' : resultText(approval, ctx.view.mode));
    setHidden(p.result, pending && !busy);
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
    renderList(list, shown, (approval) => approval.id, createCard, (item, approval, index) => updateCard(item, approval, state, index));
    setHidden(empty, shown.some((approval) => approval.status === 'pending'));
    renderNote();
  }

  function renderNote() {
    const { mode, serverSettings } = ctx.view;
    const remoteOn = Boolean(serverSettings.remoteApprovals);
    let text = 'Demo requests wait for your answer for 25 seconds of story time, then the demo carries on.';
    if (mode === 'live') {
      text = remoteOn
        ? 'Remote approvals are on: your agents wait for your answer here before asking in the terminal.'
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
