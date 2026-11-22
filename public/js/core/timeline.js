// The timeline under the town (CONTRACTS §5.1): one lane per agent, with what it did over the day.
// Tool calls are spans coloured by their building, a failed call keeps a red tick, waits for you
// (a permission, a question, a plan, an MCP form, a stopped turn, a stuck alert) are spans of their
// own, and your prompts and the turn's end are marks. Pure: the store feeds it the events it
// applied and each agent's wait after them; timelineView() cuts a window out of it for the HUD.
//
// Memory is bounded without losing the day: a lane over its limit merges its older half in pairs
// (two neighbouring calls become one span that counts both), so a busy morning stays visible at a
// coarser grain; only what is more than a day older than the lane's newest moment goes.
import { changeHunks } from './changes.js';
import { clip, oneLine, str } from './text.js';

/** @typedef {import('./events.js').TownEvent} TownEvent */
/** @typedef {import('./catalog.js').BuildingKey} BuildingKey */
/** @typedef {'permission'|'question'|'plan'|'input'|'stopped'|'stuck'} WaitKind */

/**
 * One tool call, or several neighbouring ones merged (`calls` > 1).
 * @typedef {object} Span
 * @property {string} id
 * @property {number} start
 * @property {number|null} end       null while it runs
 * @property {BuildingKey} building
 * @property {string} tool           '' once calls of different tools are merged
 * @property {string} summary
 * @property {string|null} toolUseId
 * @property {string|null} file      the file it read or changed
 * @property {string|null} command   a shell command, as written
 * @property {string|null} error     a failure's first line
 * @property {string|null} changeId  the town's diff of it (AgentState.changes), if it kept one
 * @property {number} calls
 * @property {number} fails          failed calls in it (not interrupts)
 */

/**
 * @typedef {object} WaitSpan  a stretch the agent waited for you
 * @property {string} id
 * @property {WaitKind} kind
 * @property {number} start
 * @property {number|null} end
 * @property {string} text
 */

/**
 * @typedef {object} Mark  a prompt of yours, or the turn's end
 * @property {string} id
 * @property {'prompt'|'end'} kind
 * @property {number} at
 * @property {string} text
 * @property {'done'|'error'|'interrupted'|null} ended  how the turn ended (end marks)
 * @property {number} count  marks merged into this one
 */

/**
 * @typedef {object} Lane
 * @property {string} key        the agent's key
 * @property {string} sessionId
 * @property {string} name
 * @property {'lead'|'subagent'|'teammate'} role
 * @property {number} first      its first moment seen
 * @property {number} last       its latest
 * @property {Span[]} spans      by start
 * @property {WaitSpan[]} waits  by start
 * @property {Mark[]} marks      by time
 */

/** @typedef {{ kind: WaitKind, text: string }} WaitNow */
/** @typedef {{ name: string, role: Lane['role'] }} Who */

/** Kept per lane before its older half is merged. */
export const MAX_SPANS = 400;
export const MAX_WAITS = 120;
export const MAX_MARKS = 200;
/** Lanes kept; the one quiet the longest goes first. */
export const MAX_LANES = 120;
/** How far back a lane keeps anything, from its newest moment. */
export const DAY_MS = 24 * 60 * 60_000;
/** Open spans a finished call is matched against, newest first. */
const MATCH_WINDOW = 64;
const TEXT_CHARS = 300;

/** How each turn-ending event ends the turn. */
const TURN_ENDS = Object.freeze({ 'turn.stop': 'done', 'turn.fail': 'error' });

/** @returns {{ lanes: Record<string, Lane>, seq: number }} */
export function createTimeline() {
  return { lanes: {}, seq: 0 };
}

/** @typedef {ReturnType<typeof createTimeline>} Timeline */

/**
 * Adds what one applied event did to its agent's lane.
 * @param {Timeline} t
 * @param {TownEvent} e
 * @param {Who} who
 */
export function recordEvent(t, e, who) {
  if (e.kind === 'session.end') return closeSession(t, e.sessionId, e.ts);
  const lane = laneFor(t, e, who);
  const d = e.data;
  if (e.kind === 'tool.start') openSpan(t, lane, e);
  else if (e.kind === 'tool.end' || e.kind === 'tool.fail' || e.kind === 'permission.denied') closeSpan(t, lane, e);
  else if (e.kind === 'prompt') addMark(t, lane, { kind: 'prompt', at: e.ts, text: clip(oneLine(d.prompt), TEXT_CHARS) || 'New prompt', ended: null });
  else if (e.kind === 'turn.stop' || e.kind === 'turn.fail') endTurn(t, lane, e);
  else if (e.kind === 'subagent.stop') closeOpen(lane, e.ts);
  else return;
  trim(lane);
}

/**
 * Keeps what an agent waits for you on after an event: a new kind of wait starts a span, the end
 * of one closes it.
 * @param {Timeline} t
 * @param {{ key: string, sessionId: string } & Who} agent
 * @param {WaitNow|null} now
 * @param {number} at
 */
export function recordWait(t, agent, now, at) {
  const lane = t.lanes[agent.key];
  const open = lane?.waits.findLast((w) => w.end === null);
  if (open?.kind === now?.kind) return;
  if (open) open.end = Math.max(open.start, at);
  if (!now) return;
  const target = lane ?? laneFor(t, { agentKey: agent.key, sessionId: agent.sessionId, ts: at }, agent);
  insertBy(target.waits, { id: nextId(t, 'w'), kind: now.kind, start: at, end: null, text: clip(oneLine(now.text), TEXT_CHARS) }, (w) => w.start);
  target.last = Math.max(target.last, at);
  trim(target);
}

/**
 * @param {Timeline} t
 * @param {{ agentKey: string, sessionId: string, ts: number }} e
 * @param {Who} who
 */
function laneFor(t, e, who) {
  let lane = t.lanes[e.agentKey];
  if (!lane) {
    lane = { key: e.agentKey, sessionId: e.sessionId, name: who.name, role: who.role, first: e.ts, last: e.ts, spans: [], waits: [], marks: [] };
    t.lanes[e.agentKey] = lane;
    dropQuietLanes(t);
  }
  // A helper's label can be corrected later (a teammate's name, its Agent call's result).
  lane.name = who.name;
  lane.role = who.role;
  lane.first = Math.min(lane.first, e.ts);
  lane.last = Math.max(lane.last, e.ts);
  return lane;
}

/** @param {Timeline} t @param {string} prefix */
function nextId(t, prefix) {
  t.seq += 1;
  return `${prefix}${t.seq}`;
}

/** @param {Timeline} t @param {Lane} lane @param {TownEvent} e */
function openSpan(t, lane, e) {
  const d = e.data;
  insertBy(lane.spans, {
    id: nextId(t, 's'),
    start: e.ts,
    end: null,
    building: d.building,
    tool: str(d.tool),
    summary: str(d.summary) || str(d.tool),
    toolUseId: d.toolUseId ?? null,
    file: d.file ?? null,
    command: commandOf(d),
    error: null,
    changeId: null,
    calls: 1,
    fails: 0,
  }, (s) => s.start);
}

/**
 * A call that finished, failed or was refused closes its span: the one with its id, else the open
 * one of the same tool (a permission's refusal names none). A call whose start the town missed
 * gets a span of its own, as long as its hook says it took.
 * @param {Timeline} t @param {Lane} lane @param {TownEvent} e
 */
function closeSpan(t, lane, e) {
  const d = e.data;
  const open = lane.spans.slice(-MATCH_WINDOW).reverse().filter((s) => s.end === null && s.calls === 1);
  let span = (d.toolUseId && open.find((s) => s.toolUseId === d.toolUseId)) || (!d.toolUseId ? open.find((s) => s.tool === d.tool) : undefined);
  if (!span) {
    const took = typeof d.durationMs === 'number' && d.durationMs > 0 ? d.durationMs : 0;
    openSpan(t, lane, { ...e, ts: e.ts - took });
    span = /** @type {Span} */ (lane.spans.findLast((s) => s.end === null && s.toolUseId === (d.toolUseId ?? null)));
  }
  span.end = Math.max(span.start, e.ts);
  const failed = e.kind !== 'tool.end' && d.isInterrupt !== true;
  if (failed) {
    span.fails = 1;
    span.error = clip(oneLine(e.kind === 'permission.denied' ? `Permission denied${d.reason ? `: ${d.reason}` : ''}` : d.error), TEXT_CHARS) || 'Failed';
  }
  if (e.kind === 'tool.end' && d.file && changeHunks(d.tool, d.input ?? {})) span.changeId = e.id;
}

/** @param {Timeline} t @param {Lane} lane @param {TownEvent} e */
function endTurn(t, lane, e) {
  closeOpen(lane, e.ts);
  const ended = e.data.interrupted === true ? 'interrupted' : /** @type {'done'|'error'} */ (TURN_ENDS[/** @type {'turn.stop'|'turn.fail'} */ (e.kind)]);
  const text = clip(oneLine(e.kind === 'turn.fail' ? e.data.errorDetails || e.data.error : e.data.lastMessage), TEXT_CHARS);
  // A Stop hook that kept the turn going ends the same turn again: one cap, with the newer words.
  const last = lane.marks.at(-1);
  if (e.data.stopHookActive === true && last?.kind === 'end') {
    Object.assign(last, { at: Math.max(last.at, e.ts), text: text || last.text, ended });
    return;
  }
  addMark(t, lane, { kind: 'end', at: e.ts, text, ended });
}

/** @param {Timeline} t @param {Lane} lane @param {Omit<Mark, 'id'|'count'>} mark */
function addMark(t, lane, mark) {
  insertBy(lane.marks, { id: nextId(t, 'm'), count: 1, ...mark }, (m) => m.at);
}

/** Calls still open when the turn or the helper ended will not report back. @param {Lane} lane @param {number} at */
function closeOpen(lane, at) {
  for (const span of lane.spans) if (span.end === null) span.end = Math.max(span.start, at);
  for (const wait of lane.waits) if (wait.end === null) wait.end = Math.max(wait.start, at);
}

/** @param {Timeline} t @param {string} sessionId @param {number} at */
function closeSession(t, sessionId, at) {
  for (const lane of Object.values(t.lanes)) if (lane.sessionId === sessionId) closeOpen(lane, at);
}

/** @param {Record<string, any>} d */
function commandOf(d) {
  const command = d.input?.command;
  if (d.tool !== 'Bash' && d.tool !== 'PowerShell') return null;
  return typeof command === 'string' ? clip(command, 2000) : null;
}

/**
 * Inserts in order of `at`; hooks mostly arrive in order, so this looks from the end.
 * @template T @param {T[]} list @param {T} item @param {(x: T) => number} at
 */
function insertBy(list, item, at) {
  let i = list.length;
  while (i > 0 && at(list[i - 1]) > at(item)) i -= 1;
  list.splice(i, 0, item);
}

/** @param {Timeline} t */
function dropQuietLanes(t) {
  const lanes = Object.values(t.lanes);
  if (lanes.length <= MAX_LANES) return;
  const quietest = lanes.reduce((a, b) => (b.last < a.last ? b : a));
  delete t.lanes[quietest.key];
}

/**
 * Keeps a lane within its limits: what is more than a day older than its newest moment goes, and
 * a list over its limit merges its older half in pairs.
 * @param {Lane} lane
 */
function trim(lane) {
  const since = lane.last - DAY_MS;
  lane.spans = lane.spans.filter((s) => (s.end ?? lane.last) >= since);
  lane.waits = lane.waits.filter((w) => (w.end ?? lane.last) >= since);
  lane.marks = lane.marks.filter((m) => m.at >= since);
  lane.spans = bound(lane.spans, MAX_SPANS, mergeSpans, (a, b) => a.end !== null && b.end !== null);
  lane.waits = bound(lane.waits, MAX_WAITS, mergeWaits, (a, b) => a.end !== null && b.end !== null);
  lane.marks = bound(lane.marks, MAX_MARKS, mergeMarks, (a, b) => a.kind === b.kind);
}

/**
 * A list within `max`: over it, its older half merges in pairs; should little of it merge (calls
 * still open, prompts and caps in turn), the oldest go.
 * @template T @param {T[]} list @param {number} max @param {(a: T, b: T) => T} merge @param {(a: T, b: T) => boolean} mergeable
 */
function bound(list, max, merge, mergeable) {
  if (list.length <= max) return list;
  const thinned = thin(list, merge, mergeable);
  return thinned.length > max ? thinned.slice(-max) : thinned;
}

/**
 * The list with its older half merged in neighbouring pairs (those `mergeable` allows).
 * @template T @param {T[]} list @param {(a: T, b: T) => T} merge @param {(a: T, b: T) => boolean} mergeable
 */
function thin(list, merge, mergeable) {
  const half = Math.floor(list.length / 2);
  /** @type {T[]} */
  const out = [];
  let i = 0;
  while (i < half) {
    const a = list[i];
    const b = list[i + 1];
    if (i + 1 < half && mergeable(a, b)) {
      out.push(merge(a, b));
      i += 2;
    } else {
      out.push(a);
      i += 1;
    }
  }
  return out.concat(list.slice(i));
}

/** Two calls as one span: the building of the longer, what both did in words. @param {Span} a @param {Span} b @returns {Span} */
function mergeSpans(a, b) {
  const length = (/** @type {Span} */ s) => (s.end ?? s.start) - s.start;
  const main = length(b) > length(a) ? b : a;
  const calls = a.calls + b.calls;
  return {
    ...main,
    id: a.id,
    start: Math.min(a.start, b.start),
    end: Math.max(a.end ?? a.start, b.end ?? b.start),
    tool: a.tool === b.tool ? a.tool : '',
    summary: `${calls} calls, ${a.tool === b.tool && a.tool ? a.tool : 'several tools'}`,
    toolUseId: null,
    file: null,
    command: null,
    changeId: null,
    error: b.error ?? a.error,
    calls,
    fails: a.fails + b.fails,
  };
}

/** @param {WaitSpan} a @param {WaitSpan} b @returns {WaitSpan} */
function mergeWaits(a, b) {
  const main = (b.end ?? b.start) - b.start > (a.end ?? a.start) - a.start ? b : a;
  return { ...main, id: a.id, start: Math.min(a.start, b.start), end: Math.max(a.end ?? a.start, b.end ?? b.start), text: main.text };
}

/** Two marks of one kind as one, at the later one's time. @param {Mark} a @param {Mark} b @returns {Mark} */
function mergeMarks(a, b) {
  return { ...b, id: a.id, count: a.count + b.count, text: b.text || a.text };
}

// ---------------------------------------------------------------------------------------------
// The window the HUD shows.

/**
 * @typedef {object} TimelineItem
 * @property {string} id
 * @property {string} laneKey
 * @property {'tool'|'wait'|'prompt'|'end'} type
 * @property {number} start
 * @property {number} end           as shown: a running call or wait ends now
 * @property {boolean} open         still running (or waiting)
 * @property {string} label         what it was, in words
 * @property {BuildingKey|null} building  a call's
 * @property {WaitKind|null} wait   a wait's kind
 * @property {number} calls
 * @property {number} fails
 * @property {'done'|'error'|'interrupted'|null} ended
 * @property {string|null} detail   the command, the file or the error, for the details
 * @property {string|null} changeId
 */

/**
 * @typedef {object} TimelineLane
 * @property {string} key
 * @property {string} name
 * @property {Lane['role']} role
 * @property {TimelineItem[]} items  by start
 */

/** @typedef {{ sessionId: string, lanes: TimelineLane[] }} TimelineGroup */

/** Words for each kind of wait. */
export const WAIT_WORDS = Object.freeze({
  permission: 'Waited for your permission',
  question: 'Asked you a question',
  plan: 'Waited for you to approve a plan',
  input: 'Waited for your input',
  stopped: 'Stopped on an error',
  stuck: 'Seemed stuck',
});

/**
 * What happened between `from` and `to`, per crew and agent: crews in `order`, leads first then
 * helpers as they arrived, each lane's items by start. Calls shorter than `minMs` next to each
 * other merge, so a long window stays readable; a merged item keeps its failures.
 * @param {Timeline} t
 * @param {{ from: number, to: number, sessions?: string[]|null, order?: string[], minMs?: number }} window
 * @returns {TimelineGroup[]}
 */
export function timelineView(t, { from, to, sessions = null, order = [], minMs = 0 }) {
  /** @type {Map<string, TimelineLane[]>} */
  const bySession = new Map();
  const lanes = Object.values(t.lanes)
    .filter((lane) => (!sessions || sessions.includes(lane.sessionId)) && lane.last >= from && lane.first <= to)
    .sort((a, b) => roleRank(a) - roleRank(b) || a.first - b.first);
  for (const lane of lanes) {
    const items = laneItems(lane, from, to, minMs);
    if (!items.length) continue;
    const list = bySession.get(lane.sessionId) ?? [];
    list.push({ key: lane.key, name: lane.name, role: lane.role, items });
    bySession.set(lane.sessionId, list);
  }
  const rank = (/** @type {string} */ id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...bySession.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([sessionId, list]) => ({ sessionId, lanes: list }));
}

/** @param {Lane} lane */
const roleRank = (lane) => (lane.role === 'lead' ? 0 : 1);

/**
 * @param {Lane} lane @param {number} from @param {number} to @param {number} minMs
 * @returns {TimelineItem[]}
 */
function laneItems(lane, from, to, minMs) {
  const inWindow = (/** @type {number} */ start, /** @type {number} */ end) => end >= from && start <= to;
  /** @type {TimelineItem[]} */
  const calls = [];
  for (const span of lane.spans) {
    const end = span.end ?? to;
    if (inWindow(span.start, end)) calls.push(spanItem(lane.key, span, end));
  }
  /** @type {TimelineItem[]} */
  const items = coalesce(calls, minMs);
  for (const wait of lane.waits) {
    const end = wait.end ?? to;
    if (inWindow(wait.start, end)) items.push(waitItem(lane.key, wait, end));
  }
  for (const mark of lane.marks) if (inWindow(mark.at, mark.at)) items.push(markItem(lane.key, mark));
  return items.sort((a, b) => a.start - b.start || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}

const TYPE_ORDER = Object.freeze({ prompt: 0, wait: 1, tool: 2, end: 3 });

/** @param {string} laneKey @param {Span} span @param {number} end @returns {TimelineItem} */
function spanItem(laneKey, span, end) {
  const failed = span.fails > 0 && span.calls === 1 ? ` (failed: ${span.error ?? 'error'})` : span.fails ? ` (${span.fails} failed)` : '';
  return {
    id: span.id,
    laneKey,
    type: 'tool',
    start: span.start,
    end,
    open: span.end === null,
    label: `${span.summary}${failed}`,
    building: span.building,
    wait: null,
    calls: span.calls,
    fails: span.fails,
    ended: null,
    detail: span.command ?? span.file ?? span.error,
    changeId: span.changeId,
  };
}

/** @param {string} laneKey @param {WaitSpan} wait @param {number} end @returns {TimelineItem} */
function waitItem(laneKey, wait, end) {
  const words = WAIT_WORDS[wait.kind];
  return { id: wait.id, laneKey, type: 'wait', start: wait.start, end, open: wait.end === null, label: wait.text ? `${words}: ${wait.text}` : words, building: null, wait: wait.kind, calls: 0, fails: 0, ended: null, detail: wait.text || null, changeId: null };
}

/** @param {string} laneKey @param {Mark} mark @returns {TimelineItem} */
function markItem(laneKey, mark) {
  const more = mark.count > 1 ? ` (and ${mark.count - 1} more)` : '';
  const label = mark.kind === 'prompt' ? `Your prompt: ${mark.text}${more}` : `${END_WORDS[mark.ended ?? 'done']}${mark.text ? `: ${mark.text}` : ''}${more}`;
  return { id: mark.id, laneKey, type: mark.kind, start: mark.at, end: mark.at, open: false, label, building: null, wait: null, calls: 0, fails: 0, ended: mark.ended, detail: mark.text || null, changeId: null };
}

const END_WORDS = Object.freeze({ done: 'Turn ended', error: 'Turn stopped on an error', interrupted: 'Turn interrupted' });

/**
 * Neighbouring calls too short to see merge, into the building of the longest; a merged item
 * says how many calls and failures it holds.
 * @param {TimelineItem[]} items  calls, by start
 * @param {number} minMs
 */
function coalesce(items, minMs) {
  if (minMs <= 0) return items;
  /** @type {TimelineItem[]} */
  const out = [];
  for (const item of items) {
    const last = out.at(-1);
    const short = (/** @type {TimelineItem} */ x) => x.end - x.start < minMs;
    if (last && !last.open && !item.open && (short(last) || short(item)) && item.start - last.end < minMs) {
      const calls = last.calls + item.calls;
      const fails = last.fails + item.fails;
      const main = item.end - item.start > last.end - last.start ? item : last;
      out[out.length - 1] = { ...main, id: last.id, start: last.start, end: Math.max(last.end, item.end), label: `${calls} calls${fails ? ` (${fails} failed)` : ''}`, calls, fails, detail: null, changeId: null };
    } else {
      out.push(item);
    }
  }
  return out;
}
