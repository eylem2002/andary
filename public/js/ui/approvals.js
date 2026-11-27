// The Approvals panel: permission requests from every crew. A held request (remote approvals on,
// or the demo) can be answered here with Allow / Deny — or A / D while the card has focus — before
// its countdown runs out, with an optional reason for a denial that goes back to the agent.
// Requests that are not held show "Answer in your terminal". Commands and paths are shown
// verbatim in the mono face, as text only, and a file change in full: a Write's content, an
// Edit's diff, with hidden characters revealed, so nothing is approved unseen. When Claude Code
// suggested a rule this project or session may keep, "Allow always" also asks it to save the
// rule. The card names that rule first, literally and with what it allows, between Allow / Deny
// and the button, so a tap that misses Allow lands on words; the button has no key of its own.
// Beside Deny, "Deny and stop" also stops a Claude Code agent (`interrupt`); it has no key of its
// own either, and a card that cannot stop its agent (Codex, an older hook) says why instead.
// A risky request (core/risk.js) gets a red band naming why. Requests that ask exactly the same
// thing from several crews share one card with a checkbox per request (approval-groups.js), all
// ticked: Allow and Deny answer the ticked ones. Answered and expired cards fold into "Earlier".
import { h, renderList, setAttr, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { approvalChange, describeApproval, formatCountdown } from './format.js';
import { alwaysLine, approvalHint, offeredSuggestion, savedText } from './approval-rules.js';
import { diffView } from './diff-view.js';
import { diffStats } from './diff.js';
import { approvalAgentKey, crewNumber, findSession, kbd, roundel, updateRoundel } from './parts.js';
import { approvalSections, differentFolders, groupRisk } from './approval-groups.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Approval} Approval */
/** @typedef {import('./approval-groups.js').ApprovalEntry} ApprovalEntry */

const MAX_CARDS = 30;
/** The longest deny reason sent (the server keeps 500 characters). */
export const MAX_REASON_CHARS = 500;

/**
 * New requests are listed first, so a card can slide under the pointer just as the viewer clicks
 * the one they read (and a settled card above can move away, or shrink when it goes back to the
 * terminal). A click on Allow, Allow always or Deny only counts once its card has stayed in place
 * on the page this long, like the input delay of browser permission prompts. Keys wait too (A / D,
 * and Enter or Space on a button): a request that joins a card on screen changes what an answer
 * goes to, so the card waits a moment after any change, however it is answered.
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
 * Restarts the answer delay when a card appears or changes place in the list.
 * @param {any} p the card's parts
 * @param {number} index its place in the list now
 */
function armCard(p, index) {
  if (p.index === index) return;
  p.index = index;
  restartDelay(p);
}

/**
 * Starts a card's answer delay over: its buttons read as unavailable (aria-disabled, not
 * disabled, so focus is never lost) until the delay is over.
 * @param {any} p the card's parts
 */
function restartDelay(p) {
  p.armedAt = performance.now();
  for (const button of [p.allow, p.always, p.deny, p.stop]) setAttr(button, 'aria-disabled', 'true');
  clearTimeout(p.armTimer);
  p.armTimer = setTimeout(() => {
    for (const button of [p.allow, p.always, p.deny, p.stop]) setAttr(button, 'aria-disabled', null);
    setHidden(p.wait, true);
  }, ANSWER_DELAY_MS);
}

/**
 * An answer the card did not take, because it just appeared or changed: it says so, until it
 * takes answers again.
 * @param {any} p the card's parts
 */
function notYet(p) {
  setText(p.wait, 'Not yet: this card just appeared or changed. Read it, then answer again.');
  setHidden(p.wait, false);
}

/**
 * Restarts a card's answer delay whenever it moves on the page, whatever moved it: a card above
 * that was answered or went back to the terminal (its buttons and countdown hide), a hint, a card
 * added or removed, or the panel shown again after requests arrived while it was hidden. Its place
 * in the list stays the same in all of these. A ResizeObserver reports after layout and before
 * paint, so a card is armed before it shows in its new place. The side boards sliding back on
 * screen (they were put away, not hidden) move no card in its panel: `restartAll` is for that.
 * @param {HTMLElement} list
 * @param {WeakMap<HTMLElement, any>} parts
 */
function watchMoves(list, parts) {
  /** @type {Set<HTMLElement>} */
  const watched = new Set();
  // A hidden panel has no layout: its cards are nowhere, so showing it moves even the first one.
  const topOf = (/** @type {HTMLElement} */ item) => (item.offsetParent ? item.offsetTop : -1);
  const watcher = new ResizeObserver(() => {
    const items = /** @type {HTMLElement[]} */ ([...list.children]);
    // Every position is read before any card is armed again, so the page is laid out only once.
    const tops = items.map(topOf);
    items.forEach((item, i) => {
      const p = parts.get(item);
      if (!p || p.top === tops[i]) return;
      p.top = tops[i];
      restartDelay(p);
    });
  });
  return {
    /** @param {HTMLElement} item a new card */
    watch(item) {
      watched.add(item);
      watcher.observe(item);
    },
    /** Stops watching the cards that left the list. */
    sweep() {
      for (const item of watched) {
        if (item.isConnected) continue;
        watched.delete(item);
        watcher.unobserve(item);
      }
    },
    /** Starts every card's delay over: what the panel shows is new to the viewer. */
    restartAll() {
      for (const item of list.children) {
        const p = parts.get(/** @type {HTMLElement} */ (item));
        if (p) restartDelay(p);
      }
    },
  };
}

/**
 * Whether a click on Allow, Allow always or Deny counts, from the pointer or the keyboard alike:
 * only once the card has stayed as it is for the answer delay.
 * @param {MouseEvent} _event
 * @param {any} p the card's parts
 */
function clickCounts(_event, p) {
  if (answerReady(p.armedAt, performance.now())) return true;
  notYet(p);
  return false;
}

/**
 * Words for a decided approval.
 * @param {Approval} approval
 * @param {'live'|'demo'} mode
 */
export function resultText(approval, mode) {
  const where = approval.decidedBy === 'terminal' ? 'in the terminal' : 'from the town';
  switch (approval.status) {
    case 'allowed': {
      const saved = savedText(approval);
      return saved ? `Allowed; asked Claude Code to save ${saved}` : `Allowed ${where}`;
    }
    case 'denied': {
      const denied = approval.stopped === true ? `Denied ${where} and stopped the agent` : `Denied ${where}`;
      return approval.message ? `${denied}: “${approval.message}”` : denied;
    }
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
  // Why this one deserves a second look (core/risk.js), on a red band under the heading.
  const riskWords = h('span', { class: 'hud-approval__risk-words' });
  const riskLabel = h('strong', { text: 'Risky: ' });
  const risk = h('p', { class: 'hud-approval__risk', id: `${id}-risk`, 'data-testid': 'approval-risk', hidden: true },
    icon('warning', { size: 16 }), h('span', {}, riskLabel, riskWords));
  // The requests a card stands for when several crews ask the same thing: one checkbox each.
  const crewsLegend = h('legend', { class: 'hud-approval__crews-legend' });
  const crewsList = h('ul', { class: 'hud-approval__crews-list' });
  const crews = h('fieldset', { class: 'hud-approval__crews', 'data-testid': 'approval-crews', hidden: true }, crewsLegend, crewsList);
  // A request that left a shared card on its own (it ran out of time), said once on the card.
  const changed = h('p', { class: 'hud-approval__hint', 'data-testid': 'approval-changed', hidden: true });
  // An answer given too soon after the card changed: said where the answer was given.
  const wait = h('p', { class: 'hud-approval__hint', role: 'status', 'data-testid': 'approval-wait', hidden: true });
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
  // Labelled for what it does, with no key of its own: it ends the agent's turn, not only this request.
  const stop = h('button', { type: 'button', class: 'hud-btn hud-btn--deny hud-btn--stop', 'data-testid': 'deny-stop', 'aria-describedby': `${id}-stop` }, icon('stop', { size: 18 }), 'Deny and stop');
  const stopNote = h('p', { class: 'hud-approval__stop-note', id: `${id}-stop`, 'data-testid': 'deny-stop-note' });
  const { alwaysRow, always, alwaysNote } = buildAlways(id);
  // On a row of its own under Allow and Deny, its line first, as "Allow always": a tap that falls
  // short of Deny lands on words, not on a stop.
  const stopRow = h('div', { class: 'hud-approval__stop' }, stopNote, stop);
  const actions = h('div', { class: 'hud-approval__actions' }, allow, deny, stopRow, alwaysRow);
  const terminal = h('p', { class: 'hud-approval__terminal' }, icon('terminal', { size: 16 }), h('span', { text: 'Answer in your terminal.' }));
  const hint = h('p', { class: 'hud-approval__hint', 'data-testid': 'approval-hint' });
  const result = h('p', { class: 'hud-approval__result' });
  const card = h('article', { class: 'hud-approval', 'data-testid': 'approval-card', 'data-approval-id': approvalId, 'aria-labelledby': `${id}-who`, 'aria-describedby': `${id}-risk ${id}-detail ${id}-grants` },
    h('header', { class: 'hud-approval__head' }, mark, h('div', {}, who, h('p', { class: 'hud-approval__meta' }, crew, tool))),
    risk, h('pre', { class: 'hud-approval__code' }, detail), grants, change, crews, changed, timer, reasonRow, wait, actions, terminal, hint, result);
  const item = h('li', { class: 'hud-approvals__item' }, card);
  const parts = { mark, who, crew, tool, detail, grants, risk, riskLabel, riskWords, riskKey: '', crews, changed, wait, crewsLegend, crewsList, members: /** @type {Approval[]} */ ([]), change, changeNote, changeBody, changeKey: '', reason, reasonRow, timer, bar, countdown, actions, allow, deny, stop, stopNote, stopRow,
    always, alwaysRow, alwaysNote, offer: null, offerKey: '', terminal, hint, hintKey: '', result, card, index: -1, armedAt: 0, armTimer: 0 };
  return { item, parts };
}

/**
 * "Allow always", on a row of its own under Allow and Deny: first the line that names the rule it
 * saves, what that allows and where (the button's description), then, set apart, the button.
 * @param {string} id prefix for the ids the card's aria attributes point at
 */
function buildAlways(id) {
  const alwaysNote = h('p', { class: 'hud-approval__always-note', id: `${id}-always`, 'data-testid': 'approve-always-rule' });
  const always = h('button', { type: 'button', class: 'hud-btn hud-btn--always', 'data-testid': 'approve-always', 'aria-describedby': `${id}-always` }, icon('key', { size: 18 }), 'Allow always');
  return { alwaysRow: h('div', { class: 'hud-approval__always' }, alwaysNote, always), always, alwaysNote };
}

/**
 * The "Allow always" row on a card that can be answered here. The rule shown is the one a click
 * saves: both come from `p.offer`, set here. A card for several requests offers it only while one
 * of them is ticked: a rule is saved for one agent's project or session.
 * @param {any} p the card's parts
 * @param {Approval|null} approval  the one ticked request, or null
 * @param {boolean} busy an answer is being sent
 */
function showOffer(p, approval, busy) {
  p.offer = approval && approval.status === 'pending' && approval.held ? offeredSuggestion(approval) : null;
  p.offerFor = p.offer ? approval : null;
  // The row is about to disappear under keyboard focus: keep it on the card.
  if (!p.offer && p.alwaysRow.contains(document.activeElement)) p.card.focus();
  setHidden(p.alwaysRow, !p.offer);
  p.always.disabled = busy;
  // A request's offer never changes, so its line is written once.
  const key = p.offer && approval ? `${approval.id} ${p.offer.index}` : '';
  if (!p.offer || p.offerKey === key) return;
  p.offerKey = key;
  p.alwaysNote.replaceChildren(...alwaysLine(p.offer).map((part) => ('code' in part ? h('code', { class: 'hud-mono', text: part.code }) : part.text)));
}

/**
 * The card's hint, worked out when the request arrives and again only when it goes to the
 * terminal or is answered: a hint that came and went while the viewer reads would move the cards
 * below it under the pointer.
 * @param {any} p the card's parts
 * @param {Approval} approval
 * @param {StoreState} state
 */
function showHint(p, approval, state) {
  const key = `${approval.id} ${approval.status} ${approval.held}`;
  if (p.hintKey === key) return;
  p.hintKey = key;
  const hint = approvalHint(approval, state.approvals, Date.now());
  setText(p.hint, hint);
  setHidden(p.hint, !hint);
}

/**
 * "Deny and stop" on a card that can be answered here: the button when every ticked request's
 * agent can be stopped, otherwise the line that says why not (Codex, an older hook); its
 * description says what it does.
 * @param {any} p the card's parts
 * @param {Approval[]} ticked  the requests an answer goes to
 * @param {boolean} busy an answer is being sent
 */
function showStop(p, ticked, busy) {
  const canStop = ticked.length > 0 && ticked.every((one) => one.canStop === true);
  const stopNote = ticked.find((one) => one.canStop !== true)?.stopNote ?? '';
  if (!canStop && document.activeElement === p.stop) p.card.focus();
  setHidden(p.stopRow, !canStop && !stopNote);
  setHidden(p.stop, !canStop);
  p.stop.disabled = busy;
  setText(p.stopNote, canStop ? 'Deny and stop also ends the agent’s turn: it stops and waits for you in the terminal.' : (stopNote ? `${stopNote}.` : ''));
}

/**
 * The red band of a risky request: why, in a few words (core/risk.js), for every request the
 * card stands for. Written again only when the reasons change.
 * @param {any} p the card's parts
 * @param {Approval[]} members
 * @param {StoreState} state
 */
function showRisk(p, members, state) {
  const { reasons, quiet } = groupRisk(members, state);
  const key = `${quiet}\n${reasons.join('\n')}`;
  setAttr(p.card, 'data-risky', reasons.length ? (quiet ? 'quiet' : 'true') : null);
  if (p.riskKey === key) return;
  p.riskKey = key;
  // A rebuildable folder (node_modules, dist…) is a note, not a red band.
  p.risk.classList.toggle('hud-approval__risk--quiet', quiet);
  setText(p.riskLabel, quiet ? 'Note: ' : 'Risky: ');
  setText(p.riskWords, reasons.join('; '));
  setHidden(p.risk, !reasons.length);
}

/**
 * The checkbox per request on a card that stands for several (the same request from more than
 * one crew, or twice from one): who asks, in which crew and, when they differ, in which folder.
 * @param {any} p the card's parts
 * @param {Approval[]} members
 * @param {StoreState} state
 * @param {{ unticked: Set<string>, onToggle: () => void }} ticks
 */
function showMembers(p, members, state, ticks) {
  // One request left unticked keeps its checkbox: it is answered only once ticked again (and the
  // box stays while that request is the card's, so ticking it does not make it vanish).
  const shownFor = members.map((one) => one.id).join(' ');
  const choose = members.length > 1 || members.some((one) => ticks.unticked.has(one.id)) || p.crewsKey === shownFor;
  const many = choose && members.every((one) => one.status === 'pending' && one.held);
  setHidden(p.crews, !many);
  if (!many) {
    p.crewsList.replaceChildren();
    p.crewsKey = '';
    return;
  }
  const folders = differentFolders(members);
  const crews = new Set(members.map((one) => one.sessionId)).size;
  const legend = members.length === 1 ? 'Not ticked: tick it to answer this request:' : crews > 1 ? `${crews} crews ask for this. Your answer goes to the ticked ones:` : `Asked ${members.length} times. Your answer goes to the ticked ones:`;
  setText(p.crewsLegend, legend);
  const key = members.map((one) => one.id).join(' ');
  if (p.crewsKey !== key) {
    p.crewsKey = key;
    p.crewsList.replaceChildren(...members.map((one) => memberRow(one, state, folders, ticks)));
  }
  for (const box of p.crewsList.querySelectorAll('input')) box.checked = !ticks.unticked.has(box.value);
}

/**
 * @param {Approval} approval @param {StoreState} state @param {boolean} folders
 * @param {{ unticked: Set<string>, onToggle: () => void }} ticks
 */
function memberRow(approval, state, folders, ticks) {
  const session = findSession(state, approval.sessionId);
  const agent = state.agents[approvalAgentKey(approval)];
  const box = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', value: approval.id, 'data-testid': 'approval-crew-check' }));
  box.addEventListener('change', () => {
    if (box.checked) ticks.unticked.delete(approval.id);
    else ticks.unticked.add(approval.id);
    ticks.onToggle();
  });
  const crew = session ? `Crew ${crewNumber(state, approval.sessionId)}, ${session.project}` : 'A crew';
  const where = folders ? h('code', { class: 'hud-mono hud-approval__crew-folder', text: approval.cwd || '(folder unknown)' }) : null;
  return h('li', {}, h('label', { class: 'hud-approval__crew-row' }, box, h('span', { text: `${crew}: ${agent?.name ?? 'an agent'}` }), where));
}

/**
 * What the announcer says once an answer is on its way.
 * @param {'allow'|'deny'} decision
 * @param {number|undefined} always
 * @param {boolean} [stop]
 * @param {number} [count]  how many requests the answer went to
 */
function sentWords(decision, always, stop = false, count = 1) {
  const many = count > 1 ? ` ${count} requests.` : '';
  if (decision === 'deny') return stop ? `Denied, and asked the agent to stop.${many}` : `Denied.${many}`;
  return always === undefined ? `Allowed.${many}` : 'Allowed, and asked to save the rule.';
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
  const { added, removed } = diffStats(change.hunks, { exact: true });
  setText(p.changeNote, `${change.note}: ${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed`);
  p.changeBody.replaceChildren(...change.hunks.map((hunk, index) => diffView(hunk, { index, count: change.hunks.length, exact: true, compact: true })));
}

/**
 * Keeps the card under keyboard focus where it is once its request is settled (answered here,
 * say): its result shows, and focus stays on it until the viewer moves on. Only then does it
 * fold into "Earlier".
 * @param {HTMLElement} list
 * @param {WeakMap<HTMLElement, any>} parts
 * @param {{ live: ApprovalEntry[], earlier: Approval[] }} sections
 */
function keepFocused(list, parts, { live, earlier }) {
  const item = /** @type {HTMLElement|null} */ ([...list.children].find((child) => child.contains(document.activeElement)) ?? null);
  const key = item?.dataset.key;
  if (!item || !key || live.some((entry) => entry.key === key)) return { live, earlier };
  const members = /** @type {Approval[]} */ (parts.get(item)?.members ?? []);
  const ids = new Set(members.map((one) => one.id));
  const settled = earlier.filter((one) => ids.has(one.id));
  if (!settled.length) return { live, earlier };
  const index = Math.min([...list.children].indexOf(item), live.length);
  const kept = { key, lead: settled[0], members: settled };
  return { live: [...live.slice(0, index), kept, ...live.slice(index)], earlier: earlier.filter((one) => !ids.has(one.id)) };
}

/**
 * Requests that joined a card already on screen: the card takes no answer for a moment (its
 * buttons and A / D), says so, and a newcomer starts unticked once the card has been read, so
 * an answer meant for the crews in view never goes to one that just arrived.
 * A request that left it because it ran out of time is said on the card, so an answer that
 * comes a moment later is not taken for one that reached it.
 * @param {HudContext} ctx
 * @param {any} p the card's parts
 * @param {{ members: Approval[], state: StoreState, unticked: Set<string> }} card  its requests now; the town; the requests left unticked
 */
function joined(ctx, p, { members, state, unticked }) {
  const ids = members.map((one) => one.id);
  const before = /** @type {Set<string>|undefined} */ (p.memberIds);
  p.memberIds = new Set(ids);
  if (!before) return;
  const newcomers = ids.filter((id) => !before.has(id));
  if (!newcomers.length && ids.length === before.size) return;
  restartDelay(p);
  const gone = [...before].filter((id) => !p.memberIds.has(id));
  if (ids.length && gone.some((id) => state.approvals.find((one) => one.id === id)?.status === 'expired')) {
    const words = 'One request on this card just ran out of time: its terminal asks instead.';
    setText(p.changed, words);
    setHidden(p.changed, false);
    ctx.announcer.polite(words);
  }
  if (!newcomers.length) return;
  // The card was already on screen: what joins it waits for a tick of its own.
  for (const id of newcomers) unticked.add(id);
  const crews = new Set(members.map((one) => one.sessionId)).size;
  const words = crews > 1 ? `${crews} crews now ask for this.` : `This was asked ${members.length} times now.`;
  ctx.announcer.polite(`${words} The new request is not ticked.`);
}

/** "Earlier (n)": the settled requests, folded under the live ones. */
function buildEarlier() {
  const earlierList = h('ol', { class: 'hud-approvals__list hud-approvals__list--earlier' });
  const earlierCount = h('span', {});
  const earlier = h('details', { class: 'hud-approvals__earlier', 'data-testid': 'approvals-earlier', hidden: true },
    h('summary', { class: 'hud-approvals__earlier-title' }, earlierCount), earlierList);
  return { earlier, earlierList, earlierCount };
}

/**
 * How a card answers: the ticked requests of a card (its only one, for a card of one) each get
 * the decision; "Allow always" goes to the one request whose rule the card shows.
 * @param {HudContext} ctx
 * @param {Map<string, string>} sending  decisions sent but not yet confirmed
 * @param {(members: Approval[]) => Approval[]} tickedOf
 */
function createDecide(ctx, sending, tickedOf) {
  /**
   * @param {any} p the card's parts
   * @param {'allow'|'deny'} decision
   * @param {string} [reason] sent with a denial only
   * @param {number} [always] with an allow: the index of the suggestion to save (one request only)
   * @param {boolean} [stop] with a denial: stop the agent too
   */
  return function decide(p, decision, reason = '', always = undefined, stop = false) {
    const ticked = tickedOf(p.members);
    const targets = always === undefined ? ticked : ticked.filter((one) => one === p.offerFor);
    const open = targets.filter((one) => !sending.has(one.id) && one.status === 'pending' && one.held);
    if (!open.length || open.length < targets.length || (stop && open.some((one) => one.canStop !== true))) return;
    const message = decision === 'deny' ? reason.trim().slice(0, MAX_REASON_CHARS) : '';
    let sent = 0;
    for (const approval of open) {
      if (!ctx.controls.decide(approval.id, decision, message || undefined, always, stop || undefined)) break;
      sending.set(approval.id, decision);
      sent += 1;
    }
    if (sent < open.length) ctx.toasts.show({ tone: 'error', icon: 'warning', title: 'Not connected to Andary', body: 'Answer this request in your terminal.' });
    if (!sent) return;
    ctx.announcer.polite(sentWords(decision, always, stop, sent));
    ctx.refresh();
  };
}

/**
 * A card's answers: its buttons (after the answer delay), Enter in the reason field, and A / D.
 * @param {any} p the card's parts
 * @param {ReturnType<typeof createDecide>} decide
 */
function wireCard(p, decide) {
  p.allow.addEventListener('click', (event) => clickCounts(event, p) && decide(p, 'allow'));
  p.always.addEventListener('click', (event) => clickCounts(event, p) && p.offer && decide(p, 'allow', '', p.offer.index));
  p.deny.addEventListener('click', (event) => clickCounts(event, p) && decide(p, 'deny', p.reason.value));
  p.stop.addEventListener('click', (event) => clickCounts(event, p) && decide(p, 'deny', p.reason.value, undefined, true));
  // Enter in the reason field denies with that reason; typing there never answers by itself.
  p.reason.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (clickCounts(/** @type {any} */ (event), p)) decide(p, 'deny', p.reason.value);
    }
  });
  p.card.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if ((key !== 'a' && key !== 'd') || event.ctrlKey || event.metaKey || event.altKey) return;
    // A held key repeats: only the first press answers.
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    // A / D answer from the card and its buttons, not while reading the change.
    if (p.change.contains(/** @type {Node} */ (event.target))) return;
    event.preventDefault();
    event.stopPropagation();
    // A card that just appeared, moved or changed takes no key answer either.
    if (!clickCounts(/** @type {any} */ (event), p)) return;
    decide(p, key === 'a' ? 'allow' : 'deny', p.reason.value);
  });
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
  /** Requests the viewer unticked on a shared card: an answer leaves them waiting. @type {Set<string>} */
  const unticked = new Set();
  const ticks = { unticked, onToggle: () => ctx.refresh() };
  const { earlier, earlierList, earlierCount } = buildEarlier();
  el.append(earlier);
  /** @type {WeakMap<HTMLElement, any>} */
  const parts = new WeakMap();
  const moves = watchMoves(list, parts);

  /** The requests an answer goes to: those still ticked. @param {Approval[]} members */
  const tickedOf = (members) => members.filter((one) => !unticked.has(one.id));
  const decide = createDecide(ctx, sending, tickedOf);

  let cards = 0;

  /** @param {ApprovalEntry} first */
  function createCard(first) {
    const { item, parts: p } = buildCard(`hud-approval-${++cards}`, first.lead.id);
    parts.set(item, p);
    moves.watch(item);
    wireCard(p, decide);
    return item;
  }

  /**
   * @param {HTMLElement} item @param {ApprovalEntry} entry @param {StoreState} state @param {number} index
   */
  function updateCard(item, { lead: approval, members }, state, index) {
    const p = parts.get(item);
    p.approval = approval;
    p.members = members;
    setAttr(p.card, 'data-approval-id', approval.id);
    setAttr(p.card, 'data-approval-ids', members.map((one) => one.id).join(' '));
    armCard(p, index);
    joined(ctx, p, { members, state, unticked });
    for (const one of members) if (one.status !== 'pending') sending.delete(one.id);
    const ticked = tickedOf(members);
    const busy = ticked.some((one) => sending.has(one.id));
    describeRequest(p, approval, state);
    showRisk(p, members, state);
    showMembers(p, members, state, ticks);
    showAnswerState(p, approval, busy, ticked.length);
    showOffer(p, ticked.length === 1 ? ticked[0] : null, busy);
    showStop(p, ticked, busy);
    showHint(p, approval, state);
    tickCard(item, Date.now());
  }

  /**
   * Which of the buttons, countdown, terminal hint and result line a card shows.
   * @param {any} p the card's parts
   * @param {Approval} approval
   * @param {boolean} busy  an answer to a ticked request is being sent
   * @param {number} ticked  how many requests an answer goes to
   */
  function showAnswerState(p, approval, busy, ticked) {
    const pending = approval.status === 'pending';
    const answerable = pending && approval.held;
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
    // A button about to be disabled would drop keyboard focus: keep it on the card.
    if (busy && p.actions.contains(document.activeElement)) p.card.focus();
    p.allow.disabled = busy || ticked === 0;
    p.deny.disabled = busy || ticked === 0;
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
    const focused = list.contains(document.activeElement);
    const { live, earlier: settled } = keepFocused(list, parts, approvalSections(state.approvals));
    const shown = live.slice(0, MAX_CARDS);
    renderList(list, shown, (entry) => entry.key, createCard, (item, entry, index) => updateCard(item, entry, state, index));
    const old = settled.slice(0, Math.max(0, MAX_CARDS - shown.length)).map((approval) => ({ key: approval.id, lead: approval, members: [approval] }));
    renderList(earlierList, old, (entry) => entry.key, createCard, (item, entry, index) => updateCard(item, entry, state, index));
    setText(earlierCount, `Earlier (${settled.length})`);
    setHidden(earlier, !settled.length);
    // Ticks of requests no longer waiting are forgotten.
    const waiting = new Set(live.flatMap((entry) => entry.members.map((one) => one.id)));
    for (const id of unticked) if (!waiting.has(id)) unticked.delete(id);
    moves.sweep();
    setHidden(empty, shown.length > 0);
    renderNote();
    // A card that left under keyboard focus (it went to the terminal and was answered there):
    // focus goes on to the next one.
    if (focused && !list.contains(document.activeElement) && !focusCard(list, null)) earlier.querySelector('summary')?.focus();
  }
  // An answered card stays in place while it has focus; once focus leaves it, it folds away.
  list.addEventListener('focusout', (event) => {
    const card = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest?.('.hud-approval') ?? null);
    if (card && card.dataset.status !== 'pending' && !card.contains(/** @type {Node|null} */ (event.relatedTarget))) ctx.refresh();
  });

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

  /** Whether a card waits for an answer here (the demo holds its countdowns while one shows). */
  const answerable = () => Boolean(list.querySelector('.hud-approval[data-status="pending"][tabindex="0"]'));

  return {
    el,
    render,
    tick,
    /** Focuses the first card waiting for an answer, if any. */
    focusFirstPending: () => focusCard(list, null),
    /** One request's card (from "need you"); the first pending one if it is gone. @param {string} id */
    focusApproval: (id) => focusCard(list, id),
    /** The side boards came back on screen: no card takes a click at once. */
    shown: () => moves.restartAll(),
    answerable,
  };
}

/**
 * Focuses a request's card, or the first pending one.
 * @param {HTMLElement} list
 * @param {string|null} id
 * @returns {boolean} whether a card took the focus
 */
function focusCard(list, id) {
  // A request may share a card with others that ask the same thing.
  const wanted = id ? list.querySelector(`.hud-approval[data-approval-ids~="${CSS.escape(id)}"]`) : null;
  // A card asked for by name may be far down the list: bring it just into view, then focus it.
  wanted?.scrollIntoView({ block: 'nearest' });
  const card = /** @type {HTMLElement|null} */ (wanted ?? list.querySelector('.hud-approval[data-status="pending"][tabindex="0"]'));
  card?.focus();
  return Boolean(card);
}
