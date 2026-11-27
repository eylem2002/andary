// The Crews panel: every Claude Code session is a line on a metro map (its colour and number),
// and its agents are the stations along it. A station shows the agent's status, what it is doing
// and for how long; clicking it selects the agent and points the camera at it. An agent that waits
// for you or seems stuck ("needs you", core/attention.js) says what for and since when instead,
// and a finished turn, a stop, a stuck alert or two agents on the same files can be set aside from
// its row. A note (an edit of a file another agent changed) goes on a line of its own under what
// the agent does. The lead's row also shows the crew's context in use, under its time, where it
// takes no room from the crew's name.
//
// The board scales to many crews (core/crew-board.js): the one that needs you most comes first,
// then those at work, then the idle; a helper that finished a minute ago folds into its crew's
// "+n finished"; ended crews fold into "Ended (n)" at the bottom, without their numbers, which the
// next crews reuse. A crew's head stays in view while its stations scroll under it, and crews keep
// their places while the pointer or the keyboard is in the list.
import { nameWithRoster } from './town-people.js';
import { contextShort, crewUsage, liveContext, usageShort } from './usage.js';
import { h, renderList, setAttr, setCrewColor, setHidden, setText, srOnly } from './dom.js';
import { icon } from './icons.js';
import { modelLabel } from '../core/catalog.js';
import { agentKeyOf } from '../core/ids.js';
import { doingText, formatDuration, isCommandText, nameWithRole, plural, truncate } from './format.js';
import { approvalAgentKey, roundel, setCurrent, statusChip, updateRoundel, updateStatusChip } from './parts.js';
import { itemsByAgent, notesByAgent, waitedText } from './needs-you.js';
import { FOLD_FINISHED_MS, arrangeCrews, foldFinished, holdOrder, shownNumber } from '../core/crew-board.js';
import { countedItems } from '../core/attention.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Session} Session */
/** @typedef {import('./types.js').AgentState} AgentState */

/** @param {HudContext} ctx */
export function createCrewsPanel(ctx) {
  const count = h('span', { class: 'hud-panel__meta', 'data-testid': 'crew-count' });
  const collapse = h('button', {
    type: 'button',
    class: 'hud-iconbtn hud-collapse',
    'aria-expanded': 'true',
    'aria-controls': 'hud-crews-body',
    'aria-label': 'Crews list',
  }, icon('chevronUp', { size: 18 }));
  const empty = h('p', { class: 'hud-empty' });
  const lines = h('ol', { class: 'hud-lines', 'aria-label': 'Crews at work' });
  // Ended crews wait in a group of their own, folded, so the crews at work stay in view.
  const endedLines = h('ol', { class: 'hud-lines hud-lines--ended', id: 'hud-crews-ended', 'aria-label': 'Ended crews', hidden: true });
  const endedToggle = h('button', { type: 'button', class: 'hud-ended__toggle', 'aria-expanded': 'false', 'aria-controls': 'hud-crews-ended', 'data-testid': 'crews-ended-toggle', hidden: true });
  const body = h('div', { class: 'hud-panel__body hud-crews__body', id: 'hud-crews-body' }, empty, lines, endedToggle, endedLines);
  const el = h('section', { class: 'hud-panel hud-crews', 'data-testid': 'crew-list', 'aria-labelledby': 'hud-crews-title' },
    h('div', { class: 'hud-panel__head' }, h('h2', { class: 'hud-panel__title', id: 'hud-crews-title', text: 'Crews' }), count, collapse),
    body);

  /** Sessions whose finished helpers are unfolded. */
  const unfolded = new Set();
  /** @type {WeakMap<HTMLElement, any>} element → its part references */
  const parts = new WeakMap();
  let endedOpen = false;
  /** While the pointer or the keyboard is in the list, crews keep their places (see holdOrder). */
  const reading = { hover: false, focus: false };
  /** @type {string[]} the order on screen */
  let shownOrder = [];
  let scrolledTop = false;

  collapse.addEventListener('click', () => {
    ctx.setPrefs({ crewsCollapsed: !ctx.prefs.crewsCollapsed });
    applyCollapsed();
  });
  endedToggle.addEventListener('click', () => {
    endedOpen = !endedOpen;
    render(ctx.store.getState());
  });
  const settle = () => {
    if (!reading.hover && !reading.focus) ctx.refresh();
  };
  body.addEventListener('pointerenter', () => { reading.hover = true; });
  body.addEventListener('pointerleave', () => { reading.hover = false; settle(); });
  body.addEventListener('focusin', () => { reading.focus = true; });
  body.addEventListener('focusout', (event) => {
    if (body.contains(/** @type {Node|null} */ (event.relatedTarget))) return;
    reading.focus = false;
    settle();
  });

  /** @param {string} sessionId */
  function toggleFinished(sessionId) {
    if (unfolded.has(sessionId)) unfolded.delete(sessionId);
    else unfolded.add(sessionId);
    render(ctx.store.getState());
  }

  function applyCollapsed() {
    const collapsed = ctx.prefs.crewsCollapsed && !ctx.view.mobile;
    if (collapse.getAttribute('aria-expanded') === String(!collapsed)) return;
    setAttr(collapse, 'aria-expanded', String(!collapsed));
    collapse.replaceChildren(icon(collapsed ? 'chevronDown' : 'chevronUp', { size: 18 }));
    setHidden(body, collapsed);
    el.classList.toggle('is-collapsed', collapsed);
  }

  /** @param {StoreState} state */
  function render(state) {
    const now = Date.now();
    const items = ctx.needsYou.items(state);
    const { live, ended } = arrangeCrews(state.sessions, needLevels(state, items));
    const order = reading.hover || reading.focus ? holdOrder(live, shownOrder) : live;
    shownOrder = order.map((session) => session.id);
    setText(count, live.length ? `${live.length} active` : '');
    setText(empty, emptyText(ctx, ended.length));
    setHidden(empty, live.length > 0);
    /** @type {RowFacts} */
    const facts = { now, needs: itemsByAgent(state, ctx.needsYou, now), notes: notesByAgent(state, ctx.needsYou, now), asking: new Map(), contexts: new Map() };
    for (const approval of state.approvals) {
      if (approval.status === 'pending' && !facts.asking.has(approvalAgentKey(approval))) facts.asking.set(approvalAgentKey(approval), approval);
    }
    for (const session of live) {
      const lead = agentKeyOf(session.id, null);
      facts.contexts.set(lead, contextShort(liveContext(state, lead)));
    }
    const create = (/** @type {Session} */ session) => createLine(ctx, parts, session, () => toggleFinished(session.id));
    const update = (/** @type {HTMLElement} */ line, /** @type {Session} */ session) => updateLine({ ctx, parts }, line, session, state, { ...facts, unfolded });
    renderList(lines, order, (session) => session.id, create, update);
    setHidden(endedToggle, ended.length === 0);
    setText(endedToggle, `Ended (${ended.length})`);
    setAttr(endedToggle, 'aria-expanded', String(endedOpen));
    setHidden(endedLines, !endedOpen || ended.length === 0);
    renderList(endedLines, endedOpen ? ended : [], (session) => session.id, create, update);
    applyCollapsed();
    // The board opens at its top, on the first crew's name, not part-way down a crew.
    if (!scrolledTop && live.length) {
      body.scrollTop = 0;
      scrolledTop = true;
    }
  }

  /** @param {number} now */
  function tick(now) {
    let fold = false;
    for (const item of lines.querySelectorAll('.hud-stations__item')) {
      tickStation(parts, /** @type {HTMLElement} */ (item), now);
      const agent = parts.get(/** @type {HTMLElement} */ (item))?.agent;
      if (agent && agent.role !== 'lead' && agent.status === 'done' && now - agent.lastActivity >= FOLD_FINISHED_MS) fold = true;
    }
    // A helper finished a minute ago: it folds into its crew's "+n finished".
    if (fold) ctx.refresh();
  }

  /**
   * Scrolls a crew into view (the 1–9 keys, "need you", the palette): all of it when it fits,
   * otherwise from its head, never part-way down with its name out of view.
   * @param {string} sessionId
   */
  function reveal(sessionId) {
    const line = body.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`);
    if (!line) return;
    const box = line.getBoundingClientRect();
    const view = body.getBoundingClientRect();
    if (box.top >= view.top && box.bottom <= view.bottom) return;
    line.scrollIntoView({ block: box.height > view.height || box.top < view.top ? 'start' : 'end' });
  }

  return { el, render, tick, reveal };
}

/**
 * One crew's line: its head (roundel, name, badges, cost), goal, stations and "+n finished".
 * @param {HudContext} ctx
 * @param {WeakMap<HTMLElement, any>} parts
 * @param {Session} session
 * @param {() => void} toggleFinished
 */
function createLine(ctx, parts, session, toggleFinished) {
  const mark = roundel(0, session.color);
  const number = srOnly('');
  const title = h('span', { class: 'hud-line__title' });
  const name = h('h3', { class: 'hud-line__name' }, number, title);
  const model = h('span', { class: 'hud-line__model' });
  const memberName = h('span', {});
  const member = h('span', { class: 'hud-line__member', 'data-testid': 'crew-member' }, srOnly('Shared by '), memberName);
  // Codex crews say so; Claude Code is the town's default and carries no badge.
  const agent = h('span', { class: 'hud-line__member hud-line__member--agent', 'data-testid': 'crew-agent', text: 'Codex' });
  const cost = h('button', { type: 'button', class: 'hud-line__cost', 'data-testid': 'crew-cost', on: { click: () => ctx.openDialog('usage') } });
  const goal = h('p', { class: 'hud-line__goal', 'data-testid': 'crew-goal' });
  const stations = h('ol', { class: 'hud-stations' });
  const more = h('button', { type: 'button', class: 'hud-line__more', 'data-testid': 'crew-finished' });
  more.addEventListener('click', toggleFinished);
  // The head stays at the top of the list while the crew's stations scroll under it.
  const line = h('li', { class: 'hud-line', 'data-testid': 'crew', 'data-session-id': session.id },
    h('div', { class: 'hud-line__head' }, mark, name, h('span', { class: 'hud-line__meta' }, member, agent, model, cost)), goal, stations, more);
  parts.set(line, { mark, number, title, name, model, cost, member, memberName, agent, goal, stations, more });
  return line;
}

/**
 * @param {{ ctx: HudContext, parts: WeakMap<HTMLElement, any> }} board
 * @param {HTMLElement} line
 * @param {Session} session
 * @param {StoreState} state
 * @param {RowFacts & { unfolded: ReadonlySet<string> }} facts
 */
function updateLine({ ctx, parts }, line, session, state, facts) {
  const p = parts.get(line);
  const number = shownNumber(session);
  setCrewColor(line, session.color);
  updateRoundel(p.mark, number, session.color);
  const ended = session.status === 'ended';
  line.classList.toggle('is-ended', ended);
  setText(p.number, ended ? 'Ended crew: ' : `Crew ${number}: `);
  setText(p.title, session.title ? truncate(session.title, 60) : session.project);
  setAttr(p.name, 'title', session.cwd);
  const person = ctx.view.people.find((one) => one.name === session.member);
  setText(p.memberName, person ? nameWithRoster(person) : (session.member ?? ''));
  setHidden(p.member, !session.member);
  setHidden(p.agent, session.source !== 'codex');
  setText(p.model, ended ? 'Ended' : modelLabel(session.model));
  const spent = usageShort(crewUsage(state, session.id));
  setText(p.cost, spent);
  setAttr(p.cost, 'aria-label', spent ? `Estimated cost ${spent}. Show usage` : null);
  setHidden(p.cost, !spent);
  setText(p.goal, session.goal ? truncate(session.goal, 140) : '');
  setHidden(p.goal, !session.goal || ended);
  const showAll = facts.unfolded.has(session.id);
  const { shown, folded } = ended ? { shown: [], folded: [] } : foldFinished(crewAgents(session, state), facts.now);
  renderList(p.stations, showAll ? [...shown, ...folded] : shown, (agent) => agent.key, (agent) => createStation(ctx, parts, agent), (item, agent) => updateStation(ctx, parts, item, agent, facts));
  setHidden(p.more, folded.length === 0);
  setText(p.more, showAll ? 'Hide finished helpers' : `+${folded.length} finished`);
  setAttr(p.more, 'aria-label', showAll ? null : `Show ${plural(folded.length, 'finished helper')}`);
  setAttr(p.more, 'aria-expanded', folded.length ? String(showAll) : null);
}

/**
 * The most urgent counted "needs you" level of each crew (items come most urgent first); a
 * shared item (one rate limit over several crews) counts for each of them.
 * @param {StoreState} state
 * @param {import('../core/attention.js').AttentionItem[]} items
 * @returns {Map<string, import('../core/attention.js').AttentionLevel>}
 */
function needLevels(state, items) {
  const levels = new Map();
  for (const item of countedItems(items)) {
    const sessions = new Set([item.sessionId, ...item.agentKeys.map((key) => state.agents[key]?.sessionId).filter(Boolean)]);
    for (const id of sessions) if (!levels.has(id)) levels.set(id, item.level);
  }
  return levels;
}

/**
 * @typedef {object} RowFacts  what the rows show besides each agent's own state, by agent key
 * @property {number} now
 * @property {Map<string, import('../core/attention.js').AttentionItem>} needs  their "needs you" item
 * @property {Map<string, import('../core/attention.js').AttentionItem>} notes  their newest note (needs-you.js isNote)
 * @property {Map<string, import('./types.js').Approval>} asking  their pending approval
 * @property {Map<string, string>} contexts  a lead's context in use ("182k in context")
 */

/**
 * One agent's station on its crew's line.
 * @param {HudContext} ctx
 * @param {WeakMap<HTMLElement, any>} parts
 * @param {AgentState} agent
 */
function createStation(ctx, parts, agent) {
  const chip = statusChip(agent.status);
  const name = h('span', { class: 'hud-station__name' });
  const clock = h('span', {});
  const clockWords = srOnly('');
  // A lead's: on its own line under the time, so it widens the time a little, never the name.
  const context = h('span', { class: 'hud-station__context', 'data-testid': 'crew-context', hidden: true });
  const time = h('span', { class: 'hud-station__time' }, clock, clockWords, context);
  const doing = h('span', { class: 'hud-station__doing' });
  const note = h('span', { class: 'hud-station__note', 'data-testid': 'agent-note', hidden: true });
  const button = h('button', { type: 'button', class: 'hud-station', 'data-testid': 'agent-row', 'data-agent-key': agent.key },
    h('span', { class: 'hud-station__mark' }, chip), name, time, doing, note);
  // detail is 0 for keyboard activation: then focus follows into the inspector.
  button.addEventListener('click', (event) => ctx.select({ type: 'agent', id: agent.key }, { camera: true, focus: event.detail === 0 }));
  const dismiss = h('button', { type: 'button', class: 'hud-iconbtn hud-station__dismiss', hidden: true, 'data-testid': 'dismiss-need' }, icon('close', { size: 16 }));
  const item = h('li', { class: 'hud-stations__item' }, button, dismiss);
  dismiss.addEventListener('click', () => {
    const need = parts.get(item)?.need;
    if (!need) return;
    ctx.needsYou.dismiss(need.id);
    // The row stays; its button goes, so the keyboard moves to the station itself.
    button.focus();
    ctx.announcer.polite(`Set aside: ${need.text}`);
    ctx.refresh();
  });
  parts.set(item, { chip, name, clock, clockWords, context, doing, note, button, dismiss });
  return item;
}

/**
 * @param {HudContext} ctx
 * @param {WeakMap<HTMLElement, any>} parts
 * @param {HTMLElement} item
 * @param {AgentState} agent
 * @param {RowFacts} facts
 */
function updateStation(ctx, parts, item, agent, facts) {
  const p = parts.get(item);
  const need = facts.needs.get(agent.key) ?? null;
  updateStatusChip(p.chip, agent.status);
  setText(p.name, agent.name);
  setAttr(p.name, 'title', agent.roleName && agent.roleName !== agent.name ? nameWithRole(agent) : null);
  const doing = need ? truncate(need.text, 90) : doingText(agent, facts.asking.get(agent.key));
  setText(p.doing, doing);
  p.doing.classList.toggle('hud-mono', isCommandText(doing));
  const inContext = facts.contexts.get(agent.key) ?? '';
  setText(p.context, inContext);
  setHidden(p.context, !inContext);
  const note = facts.notes.get(agent.key);
  setText(p.note, note ? truncate(note.text, 90) : '');
  setHidden(p.note, !note);
  setAttr(p.button, 'data-status', agent.status);
  setAttr(p.button, 'data-need', need?.level ?? null);
  setCurrent(p.button, ctx.view.selection?.type === 'agent' && ctx.view.selection.id === agent.key);
  const dismissable = Boolean(need?.dismissable);
  // Its button is about to go: keep the keyboard on the row.
  if (!dismissable && document.activeElement === p.dismiss) p.button.focus();
  setHidden(p.dismiss, !dismissable);
  setAttr(p.dismiss, 'aria-label', dismissable ? `Set aside: ${agent.name}, ${need?.text}` : null);
  item.classList.toggle('has-dismiss', dismissable);
  p.agent = agent;
  p.need = need;
  tickStation(parts, item, Date.now());
}

/**
 * How long the agent has waited for you; otherwise its time on the job, frozen when it finished.
 * @param {WeakMap<HTMLElement, any>} parts @param {HTMLElement} item @param {number} now
 */
function tickStation(parts, item, now) {
  const p = parts.get(item);
  if (!p?.agent) return;
  // Screen readers hear "waiting for 4m 05s" rather than a bare time.
  const waited = p.need ? waitedText(p.need, now) : null;
  const end = p.agent.status === 'done' ? p.agent.lastActivity : now;
  setText(p.clock, waited ? waited.short : formatDuration(end - p.agent.startedAt));
  setAttr(p.clock, 'aria-hidden', waited ? 'true' : null);
  setText(p.clockWords, waited ? `, ${waited.long}` : '');
}

/** A crew's agents still in the store, in its order. @param {Session} session @param {StoreState} state */
function crewAgents(session, state) {
  return session.agentKeys.map((key) => state.agents[key]).filter(Boolean);
}

/** @param {HudContext} ctx @param {number} ended  crews that have gone home */
function emptyText(ctx, ended) {
  if (ended) return 'Every crew has gone home.';
  if (ctx.view.mode === 'demo') return 'The demo crews are on their way.';
  if (ctx.view.connection === 'signin') return 'Sign in to see your crews.';
  return 'No crews yet. Each Claude Code session you start appears here as a line.';
}
