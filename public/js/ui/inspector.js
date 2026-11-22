// The agent inspector: everything known about the selected agent — role, crew, status, what it is
// doing (or waiting for you on, or why it seems stuck, and since when; and a note when another
// agent changed a file it edits), the moment picked on the timeline, its brief, its context in use
// and what it cost, which tools it used how often, recent files and activity, its last message.
import { h, renderList, setAttr, setCrewColor, setHidden, setText } from './dom.js';
import { icon } from './icons.js';
import { doingText, formatAgo, formatClock, formatDuration, isCommandText, roleLabel, shortenPath, truncate } from './format.js';
import { changeSummary } from './changes.js';
import { contextSentence, hasCounted, liveContext, usageSentence } from './usage.js';
import { approvalAgentKey, crewNumber, findSession, roundel, statusChip, updateRoundel, updateStatusChip } from './parts.js';
import { isNote, waitedText } from './needs-you.js';

/** @typedef {import('./types.js').HudContext} HudContext */
/** @typedef {import('./types.js').StoreState} StoreState */
/** @typedef {import('./types.js').AgentState} AgentState */

const TOOL_BARS = 6;
const FILES_SHOWN = 8;
const RECENT_SHOWN = 8;
const CHANGES_SHOWN = 8;

/**
 * The most-used tools, largest first, with each count as a fraction of the largest.
 * @param {Record<string, number>} counts
 * @param {number} [limit]
 */
export function topTools(counts, limit = TOOL_BARS) {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  const max = entries[0]?.[1] ?? 1;
  return entries.map(([tool, count]) => ({ tool, count, ratio: count / max }));
}

/** @param {HudContext} ctx */
export function createInspector(ctx) {
  const mark = roundel(0);
  const name = h('h2', { class: 'hud-inspector__name', id: 'hud-inspector-title', tabindex: '-1' });
  const role = h('p', { class: 'hud-inspector__role' });
  const close = h('button', { type: 'button', class: 'hud-iconbtn', 'aria-label': 'Close agent details' }, icon('close'));
  const chip = statusChip('idle', { labelled: true });
  const since = h('span', { class: 'hud-inspector__since' });
  const now = h('p', { class: 'hud-inspector__now' });
  const need = createNeedLine(ctx, name);
  const note = h('p', { class: 'hud-inspector__note', 'data-testid': 'inspector-note', hidden: true });
  const brief = h('p', { class: 'hud-inspector__brief' });
  const tools = h('ul', { class: 'hud-bars' });
  const files = h('ul', { class: 'hud-files' });
  const changes = h('ul', { class: 'hud-changes', 'data-testid': 'agent-changes' });
  const recent = h('ol', { class: 'hud-recent' });
  const message = h('p', { class: 'hud-inspector__message' });
  const usage = createUsageLines();
  const moment = createMoment(ctx);
  const sections = {
    now: section('Now', h('div', {}, now, need.el, note)),
    moment: section('On the timeline', moment.el),
    brief: section('Brief', brief),
    usage: section('Usage', usage.el),
    tools: section('Tools used', tools),
    changes: section('Changes', changes),
    files: section('Recent files', files),
    recent: section('Recent activity', recent),
    message: section('Last message', message),
  };
  const follow = h('button', { type: 'button', class: 'hud-btn hud-btn--primary', 'aria-pressed': 'false' }, icon('follow', { size: 18 }), 'Follow');
  const closeText = h('button', { type: 'button', class: 'hud-btn' }, 'Close');
  const el = h('aside', { class: 'hud hud-inspector', 'data-testid': 'agent-inspector', 'aria-labelledby': 'hud-inspector-title', hidden: true },
    h('div', { class: 'hud-inspector__head' }, mark, h('div', { class: 'hud-inspector__titles' }, name, role), close),
    h('div', { class: 'hud-inspector__status' }, chip, since),
    // Focusable so keyboard users can scroll it: it holds text, not controls.
    h('div', { class: 'hud-inspector__body', tabindex: '0', role: 'region', 'aria-label': 'Agent details' }, ...Object.values(sections)),
    h('div', { class: 'hud-inspector__foot' }, follow, closeText));

  /** @type {string|null} */
  let agentKey = null;
  /** @type {HTMLElement|null} where focus returns when the inspector closes */
  let opener = null;

  const dismiss = () => ctx.select(null);
  for (const button of [close, closeText]) button.addEventListener('click', dismiss);
  follow.addEventListener('click', () => ctx.setFollow(!ctx.view.follow));

  /**
   * @param {string} key
   * @param {{ focus?: boolean }} [options]
   */
  function open(key, { focus = false } = {}) {
    const active = /** @type {HTMLElement|null} */ (document.activeElement);
    if (el.hidden) opener = active && active !== document.body ? active : null;
    agentKey = key;
    setHidden(el, false);
    document.documentElement.dataset.inspector = 'open';
    render(ctx.store.getState());
    if (focus) name.focus();
  }

  /** @param {{ restoreFocus?: boolean }} [options] */
  function hide({ restoreFocus = true } = {}) {
    if (el.hidden) return;
    const hadFocus = el.contains(document.activeElement);
    agentKey = null;
    setHidden(el, true);
    delete document.documentElement.dataset.inspector;
    if (restoreFocus && hadFocus && opener?.isConnected) opener.focus();
    opener = null;
  }

  /** @param {StoreState} state */
  function render(state) {
    if (!agentKey) return;
    const agent = state.agents[agentKey];
    if (!agent) {
      dismiss();
      return;
    }
    const session = findSession(state, agent.sessionId);
    setCrewColor(el, session?.color ?? agent.color);
    updateRoundel(mark, crewNumber(state, agent.sessionId), session?.color ?? agent.color);
    setText(name, agent.name);
    setText(role, `${roleLabel(agent)}${session ? ` in ${session.project}` : ''}`);
    updateStatusChip(chip, agent.status);
    const asking = state.approvals.find((approval) => approval.status === 'pending' && approvalAgentKey(approval) === agent.key);
    const items = ctx.needsYou.items(state).filter((item) => item.agentKeys.includes(agent.key));
    need.update(items.find((item) => !isNote(item)) ?? null);
    // A note sits under what the agent does: the newest one.
    const newest = items.filter(isNote).sort((a, b) => b.since - a.since)[0];
    setText(note, newest?.text ?? '');
    setHidden(note, !newest);
    renderSections(agent, session?.cwd, asking);
    setHidden(sections.moment, !moment.update(ctx.view.moment?.agentKey === agent.key ? ctx.view.moment.item : null));
    setHidden(sections.usage, !usage.update(state, agent.key, Date.now()));
    setAttr(follow, 'aria-pressed', String(ctx.view.follow));
    tick(Date.now());
  }

  /**
   * @param {AgentState} agent
   * @param {string|undefined} cwd
   * @param {import('./types.js').Approval} [asking]
   */
  function renderSections(agent, cwd, asking) {
    const doing = need.item ? need.item.text : doingText(agent, asking);
    setText(now, doing);
    now.classList.toggle('hud-mono', isCommandText(doing));
    setText(brief, agent.description ?? '');
    setHidden(sections.brief, !agent.description);
    const bars = topTools(agent.toolCounts);
    setHidden(sections.tools, !bars.length);
    renderList(tools, bars, (bar) => bar.tool, createBar, updateBar);
    const shownFiles = (agent.files ?? []).slice(0, FILES_SHOWN);
    setHidden(sections.files, !shownFiles.length);
    renderList(files, shownFiles, (file) => file, (file) => h('li', { class: 'hud-mono', title: file, text: shortenPath(file, { cwd, max: 46 }) }), () => {});
    const shownChanges = [...(agent.changes ?? [])].reverse().slice(0, CHANGES_SHOWN);
    setHidden(sections.changes, !shownChanges.length);
    renderList(changes, shownChanges, (change) => change.id, (change) => changeItem(change, () => ctx.showDiff(agent.key, change.id)), () => {});
    const recentEntries = (agent.recent ?? []).slice(-RECENT_SHOWN).reverse();
    setHidden(sections.recent, !recentEntries.length);
    renderList(recent, recentEntries, (entry) => String(entry.id), createRecent, updateRecent);
    setText(message, agent.lastMessage ? truncate(agent.lastMessage, 700) : '');
    setHidden(sections.message, !agent.lastMessage);
  }

  /** @param {number} nowMs */
  function tick(nowMs) {
    if (!agentKey) return;
    const agent = ctx.store.getState().agents[agentKey];
    if (!agent) return;
    const end = agent.status === 'done' ? agent.lastActivity : nowMs;
    setText(since, `Started ${formatAgo(agent.startedAt, nowMs)}, on the job for ${formatDuration(end - agent.startedAt)}`);
    need.tick(nowMs);
    usage.tick(nowMs);
    for (const item of recent.children) {
      const time = item.querySelector('time');
      if (time) setText(time, formatAgo(Number(/** @type {HTMLElement} */ (item).dataset.ts), nowMs, { short: true }));
    }
  }

  return { el, open, hide, render, tick, get agentKey() { return agentKey; } };
}

/**
 * The moment picked on the timeline: what it was, when, and what it ran or touched; an edit the
 * town has the diff of gets a button to it.
 * @param {HudContext} ctx
 */
function createMoment(ctx) {
  const what = h('p', { class: 'hud-inspector__moment', 'data-testid': 'inspector-moment' });
  const when = h('p', { class: 'hud-inspector__when' });
  const detail = h('pre', { class: 'hud-inspector__detail hud-mono', hidden: true });
  const diff = h('button', { type: 'button', class: 'hud-btn hud-btn--small', hidden: true }, 'Show the diff');
  /** @type {import('../core/timeline.js').TimelineItem|null} */
  let item = null;
  diff.addEventListener('click', () => {
    if (item?.changeId) ctx.showDiff(item.laneKey, item.changeId);
  });
  return {
    el: h('div', {}, what, when, detail, diff),
    /** @param {import('../core/timeline.js').TimelineItem|null} next @returns {boolean} whether there is one */
    update(next) {
      item = next;
      if (!item) return false;
      setText(what, item.label);
      const took = item.type === 'tool' || item.type === 'wait' ? ` for ${formatDuration(item.end - item.start)}${item.open ? ' so far' : ''}` : '';
      setText(when, `At ${formatClock(item.start)}${took}`);
      setText(detail, item.detail && item.detail !== item.label ? item.detail : '');
      setHidden(detail, !detail.textContent);
      setHidden(diff, !item.changeId);
      return true;
    },
  };
}

/**
 * A change as a button that opens its diff.
 * @param {NonNullable<AgentState['changes']>[number]} change
 * @param {() => void} open
 */
function changeItem(change, open) {
  const button = h('button', { type: 'button', class: 'hud-change', title: change.path },
    h('span', { class: 'hud-change__path hud-mono', text: change.path.split('/').pop() ?? change.path }),
    h('span', { class: 'hud-change__stat', text: changeSummary(change) }));
  button.setAttribute('aria-label', `Show changes to ${change.path}, ${changeSummary(change)}`);
  button.addEventListener('click', open);
  return h('li', {}, button);
}

/**
 * Under the Now line while the agent waits for you or seems stuck: since when, and a Set aside
 * button for a finished turn, a stop or a stuck alert.
 * @param {HudContext} ctx
 * @param {HTMLElement} focusAfter  where the keyboard goes when the button goes
 */
function createNeedLine(ctx, focusAfter) {
  const waited = h('span', { class: 'hud-inspector__waited' });
  const setAside = h('button', { type: 'button', class: 'hud-btn hud-btn--small', 'data-testid': 'inspector-dismiss' }, 'Set aside');
  const el = h('p', { class: 'hud-inspector__need', hidden: true }, waited, setAside);
  /** @type {import('../core/attention.js').AttentionItem|null} */
  let item = null;
  setAside.addEventListener('click', () => {
    if (!item?.dismissable) return;
    ctx.needsYou.dismiss(item.id);
    focusAfter.focus();
    ctx.announcer.polite(`Set aside: ${item.text}`);
    ctx.refresh();
  });
  return {
    el,
    get item() {
      return item;
    },
    /** @param {import('../core/attention.js').AttentionItem|null} next */
    update(next) {
      item = next;
      setHidden(el, !item);
      if (!item?.dismissable && document.activeElement === setAside) focusAfter.focus();
      setHidden(setAside, !item?.dismissable);
    },
    /** @param {number} now */
    tick(now) {
      if (!item) return;
      const { long } = waitedText(item, now);
      setText(waited, long.charAt(0).toUpperCase() + long.slice(1));
    },
  };
}

/**
 * The Usage section's lines: the context in use while it can still be true, or that it was
 * compacted, with how long ago (that ages, so it is redrawn every second), then what the agent
 * has used and cost so far.
 */
function createUsageLines() {
  const context = h('p', { class: 'hud-inspector__context', 'data-testid': 'agent-context', hidden: true });
  const totals = h('p', { class: 'hud-inspector__usage', 'data-testid': 'agent-usage' });
  /** @type {import('./usage.js').ContextView|null} */
  let reading = null;
  /** @param {number} now */
  const tick = (now) => {
    if (reading) setText(context, contextSentence(reading, now));
  };
  return {
    el: h('div', { class: 'hud-inspector__lines' }, context, totals),
    tick,
    /**
     * @param {StoreState} state @param {string} agentKey @param {number} now
     * @returns {boolean} whether there is anything to show
     */
    update(state, agentKey, now) {
      const spent = state.usage?.[agentKey];
      const sentence = spent && hasCounted(spent) ? usageSentence(spent) : '';
      setText(totals, sentence);
      setHidden(totals, !sentence);
      reading = liveContext(state, agentKey);
      setHidden(context, !reading);
      tick(now);
      return Boolean(sentence || reading);
    },
  };
}

/** @param {string} title @param {HTMLElement} content */
function section(title, content) {
  return h('section', { class: 'hud-inspector__section' }, h('h3', { class: 'hud-inspector__heading', text: title }), content);
}

/** @param {{ tool: string, count: number, ratio: number }} bar */
function createBar(bar) {
  return h('li', { class: 'hud-bar' },
    h('span', { class: 'hud-bar__name', text: bar.tool }),
    h('span', { class: 'hud-bar__track', 'aria-hidden': 'true' }, h('span', { class: 'hud-bar__fill' })),
    h('span', { class: 'hud-bar__count' }));
}

/** @param {HTMLElement} el @param {{ tool: string, count: number, ratio: number }} bar */
function updateBar(el, bar) {
  const fill = /** @type {HTMLElement} */ (el.querySelector('.hud-bar__fill'));
  const transform = `scaleX(${bar.ratio.toFixed(3)})`;
  if (fill.style.transform !== transform) fill.style.transform = transform;
  setText(/** @type {HTMLElement} */ (el.querySelector('.hud-bar__count')), String(bar.count));
}

/** @param {import('./types.js').LogEntry} entry */
function createRecent(entry) {
  const item = h('li', { class: `hud-recent__item${entry.level === 'error' ? ' is-error' : ''}` },
    h('time', { class: 'hud-recent__time', datetime: new Date(entry.ts).toISOString() }),
    h('span', { class: isCommandText(entry.text) ? 'hud-recent__text hud-mono' : 'hud-recent__text', text: entry.text }));
  item.dataset.ts = String(entry.ts);
  return item;
}

/** @param {HTMLElement} item @param {import('./types.js').LogEntry} entry */
function updateRecent(item, entry) {
  setText(/** @type {HTMLElement} */ (item.querySelector('time')), formatAgo(entry.ts, Date.now(), { short: true }));
}
