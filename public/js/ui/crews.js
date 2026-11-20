// The Crews panel: every Claude Code session is a line on a metro map (its colour and number),
// and its agents are the stations along it. A station shows the agent's status, what it is doing
// and for how long; clicking it selects the agent and points the camera at it.
import { h, renderList, setAttr, setCrewColor, setHidden, setText, srOnly } from './dom.js';
import { icon } from './icons.js';
import { modelLabel } from '../core/catalog.js';
import { doingText, formatDuration, isCommandText, plural, truncate } from './format.js';
import { approvalAgentKey, roundel, setCurrent, statusChip, updateRoundel, updateStatusChip } from './parts.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').Session} Session */
/** @typedef {import('./types.js').AgentState} AgentState */

/** Finished agents beyond this many per crew fold behind a "show" button. */
const FINISHED_SHOWN = 3;

/** @param {HudContext} ctx */
export function createCrewsPanel(ctx) {
  const count = h('span', { class: 'hud-panel__meta' });
  const collapse = h('button', {
    type: 'button',
    class: 'hud-iconbtn hud-collapse',
    'aria-expanded': 'true',
    'aria-controls': 'hud-crews-body',
    'aria-label': 'Crews list',
  }, icon('chevronUp', { size: 18 }));
  const empty = h('p', { class: 'hud-empty' });
  const lines = h('ol', { class: 'hud-lines' });
  const body = h('div', { class: 'hud-panel__body hud-crews__body', id: 'hud-crews-body' }, empty, lines);
  const el = h('section', { class: 'hud-panel hud-crews', 'data-testid': 'crew-list', 'aria-labelledby': 'hud-crews-title' },
    h('div', { class: 'hud-panel__head' }, h('h2', { class: 'hud-panel__title', id: 'hud-crews-title', text: 'Crews' }), count, collapse),
    body);

  /** Sessions whose finished agents are unfolded. */
  const unfolded = new Set();
  /** @type {WeakMap<HTMLElement, any>} element → its part references */
  const parts = new WeakMap();

  collapse.addEventListener('click', () => {
    ctx.setPrefs({ crewsCollapsed: !ctx.prefs.crewsCollapsed });
    applyCollapsed();
  });

  function applyCollapsed() {
    const collapsed = ctx.prefs.crewsCollapsed && !ctx.view.mobile;
    if (collapse.getAttribute('aria-expanded') === String(!collapsed)) return;
    setAttr(collapse, 'aria-expanded', String(!collapsed));
    collapse.replaceChildren(icon(collapsed ? 'chevronDown' : 'chevronUp', { size: 18 }));
    setHidden(body, collapsed);
    el.classList.toggle('is-collapsed', collapsed);
  }

  /** @param {Session} session */
  function createLine(session) {
    const mark = roundel(0, session.color);
    const number = srOnly('');
    const title = h('span', { class: 'hud-line__title' });
    const name = h('h3', { class: 'hud-line__name' }, number, title);
    const model = h('span', { class: 'hud-line__model' });
    const goal = h('p', { class: 'hud-line__goal' });
    const stations = h('ol', { class: 'hud-stations' });
    const more = h('button', { type: 'button', class: 'hud-line__more' });
    more.addEventListener('click', () => {
      if (unfolded.has(session.id)) unfolded.delete(session.id);
      else unfolded.add(session.id);
      render(ctx.store.getState());
    });
    const line = h('li', { class: 'hud-line', 'data-testid': 'crew', 'data-session-id': session.id },
      h('div', { class: 'hud-line__head' }, mark, name, model), goal, stations, more);
    parts.set(line, { mark, number, title, name, model, goal, stations, more });
    return line;
  }

  /**
   * @param {HTMLElement} line
   * @param {Session} session
   * @param {StoreState} state
   * @param {number} number
   * @param {Map<string, import('./types.js').Approval>} asking  pending approvals by agent
   */
  function updateLine(line, session, state, number, asking) {
    const p = parts.get(line);
    setCrewColor(line, session.color);
    updateRoundel(p.mark, number, session.color);
    const ended = session.status === 'ended';
    line.classList.toggle('is-ended', ended);
    setText(p.number, `Crew ${number}: `);
    setText(p.title, session.title ? truncate(session.title, 60) : session.project);
    setAttr(p.name, 'title', session.cwd);
    setText(p.model, ended ? 'Ended' : modelLabel(session.model));
    setText(p.goal, session.goal ? truncate(session.goal, 140) : '');
    setHidden(p.goal, !session.goal || ended);
    const showAll = unfolded.has(session.id);
    const shown = ended ? [] : visibleAgents(session, state, showAll);
    renderList(p.stations, shown, (agent) => agent.key, (agent) => createStation(ctx, parts, agent), (item, agent) => updateStation(ctx, parts, item, agent, asking.get(agent.key)));
    const hiddenCount = Math.max(0, countFinished(session, state) - FINISHED_SHOWN);
    setHidden(p.more, ended || hiddenCount === 0);
    setText(p.more, showAll ? 'Hide finished agents' : `Show ${plural(hiddenCount, 'more finished agent')}`);
    setAttr(p.more, 'aria-expanded', String(showAll));
  }

  /** @param {StoreState} state */
  function render(state) {
    const active = state.sessions.filter((session) => session.status !== 'ended');
    const ended = state.sessions.filter((session) => session.status === 'ended');
    setText(count, active.length ? `${active.length} active` : '');
    setText(empty, emptyText(ctx));
    setHidden(empty, state.sessions.length > 0);
    const numbers = new Map(state.sessions.map((session, index) => [session.id, index + 1]));
    const asking = new Map();
    for (const approval of state.approvals) {
      if (approval.status === 'pending' && !asking.has(approvalAgentKey(approval))) asking.set(approvalAgentKey(approval), approval);
    }
    renderList(lines, [...active, ...ended], (session) => session.id, createLine, (line, session) => updateLine(line, session, state, numbers.get(session.id), asking));
    applyCollapsed();
  }

  /** @param {number} now */
  function tick(now) {
    for (const item of lines.querySelectorAll('.hud-stations__item')) tickStation(parts, /** @type {HTMLElement} */ (item), now);
  }

  /** Scrolls a crew into view (used by the 1–9 shortcuts). @param {string} sessionId */
  function reveal(sessionId) {
    const line = lines.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`);
    line?.scrollIntoView({ block: 'nearest' });
  }

  return { el, render, tick, reveal };
}

/**
 * One agent's station on its crew's line.
 * @param {HudContext} ctx
 * @param {WeakMap<HTMLElement, any>} parts
 * @param {AgentState} agent
 */
function createStation(ctx, parts, agent) {
  const chip = statusChip(agent.status);
  const name = h('span', { class: 'hud-station__name' });
  const time = h('span', { class: 'hud-station__time' });
  const doing = h('span', { class: 'hud-station__doing' });
  const button = h('button', { type: 'button', class: 'hud-station', 'data-testid': 'agent-row', 'data-agent-key': agent.key },
    h('span', { class: 'hud-station__mark' }, chip), name, time, doing);
  // detail is 0 for keyboard activation: then focus follows into the inspector.
  button.addEventListener('click', (event) => ctx.select({ type: 'agent', id: agent.key }, { camera: true, focus: event.detail === 0 }));
  const item = h('li', { class: 'hud-stations__item' }, button);
  parts.set(item, { chip, name, time, doing, button });
  return item;
}

/**
 * @param {HudContext} ctx
 * @param {WeakMap<HTMLElement, any>} parts
 * @param {HTMLElement} item
 * @param {AgentState} agent
 * @param {import('./types.js').Approval} [approval]  what the agent is waiting on, if anything
 */
function updateStation(ctx, parts, item, agent, approval) {
  const p = parts.get(item);
  updateStatusChip(p.chip, agent.status);
  setText(p.name, agent.name);
  const doing = doingText(agent, approval);
  setText(p.doing, doing);
  p.doing.classList.toggle('hud-mono', isCommandText(doing));
  setAttr(p.button, 'data-status', agent.status);
  setCurrent(p.button, ctx.view.selection?.type === 'agent' && ctx.view.selection.id === agent.key);
  p.agent = agent;
  tickStation(parts, item, Date.now());
}

/** Elapsed time on the job, frozen when the agent finished. @param {WeakMap<HTMLElement, any>} parts @param {HTMLElement} item @param {number} now */
function tickStation(parts, item, now) {
  const p = parts.get(item);
  if (!p?.agent) return;
  const end = p.agent.status === 'done' ? p.agent.lastActivity : now;
  setText(p.time, formatDuration(end - p.agent.startedAt));
}

/**
 * The agents to list for a crew: everyone still at work, plus the most recently finished few
 * (all of them when unfolded).
 * @param {Session} session
 * @param {StoreState} state
 * @param {boolean} showAll
 * @returns {AgentState[]}
 */
export function visibleAgents(session, state, showAll) {
  const agents = session.agentKeys.map((key) => state.agents[key]).filter(Boolean);
  if (showAll) return agents;
  const finished = agents.filter((agent) => agent.status === 'done');
  const keep = new Set(finished.sort((a, b) => b.lastActivity - a.lastActivity).slice(0, FINISHED_SHOWN));
  return agents.filter((agent) => agent.status !== 'done' || keep.has(agent));
}

/** @param {Session} session @param {StoreState} state */
function countFinished(session, state) {
  return session.agentKeys.filter((key) => state.agents[key]?.status === 'done').length;
}

/** @param {HudContext} ctx */
function emptyText(ctx) {
  if (ctx.view.mode === 'demo') return 'The demo crews are on their way.';
  if (ctx.view.connection === 'signin') return 'Sign in to see your crews.';
  return 'No crews yet. Each Claude Code session you start appears here as a line.';
}
