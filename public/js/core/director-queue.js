// Each agent's visit queue and speech, for the director (core/director.js). A tool call becomes a
// visit to its building; visits queue up and are walked in order, and when an agent falls behind
// it runs (more than RUN_AFTER waiting), teleports and merges repeats (more than TELEPORT_AFTER),
// and never keeps more than MAX_QUEUE (CONTRACTS §5). Bubbles are throttled per agent (SAY_GAP_MS)
// so important lines wait their turn instead of flickering past.

import { modelLabel } from './catalog.js';
import { clip, hostOf, isObject, oneLine, shortCommand, str } from './text.js';

/** @typedef {import('./catalog.js').BuildingKey} BuildingKey */
/** @typedef {import('./events.js').TownEvent} TownEvent */
/** @typedef {import('./store.js').AgentState} AgentState */
/** @typedef {import('./director.js').Director} Director */
/** @typedef {import('./director.js').Runtime} Runtime */
/** @typedef {import('./director.js').Visit} Visit */

export const SAY_GAP_MS = 1200;
export const MAX_SPEECH_QUEUE = 3;
export const RUN_AFTER = 3;
export const TELEPORT_AFTER = 6;
export const MAX_QUEUE = 10;
export const DWELL_MS = 900;

/**
 * Wraps a reaction so it runs with a fixed "historic" flag and never throws into the caller.
 * @param {Director} d
 * @param {boolean} historic
 * @param {() => void} fn
 */
export function scoped(d, historic, fn) {
  return () => {
    const was = d.historic;
    d.historic = historic;
    try {
      fn();
    } catch (error) {
      d.report(error);
    } finally {
      d.historic = was;
    }
  };
}

/** @param {Director} d @param {string} key */
export function agentState(d, key) {
  return d.store.getState().agents[key];
}

/** @param {Director} d @param {string} sessionId */
export function sessionOf(d, sessionId) {
  return d.store.getState().sessions.find((s) => s.id === sessionId);
}

// ---------------------------------------------------------------------------------------------
// The visit queue.

/**
 * @param {Director} d
 * @param {BuildingKey} building
 * @param {Visit['kind']} kind
 * @param {() => void} arrive
 * @param {{toolUseId?: string|null, tool?: string|null, hold?: boolean}} [extra]
 * @returns {Visit}
 */
export function makeVisit(d, building, kind, arrive, extra = {}) {
  return {
    building,
    kind,
    tool: extra.tool ?? null,
    toolUseIds: new Set(extra.toolUseId ? [extra.toolUseId] : []),
    arrive: scoped(d, d.historic, arrive),
    settles: [],
    arrived: false,
    hold: extra.hold ?? false,
    historic: d.historic,
  };
}

/** Consecutive visits to the same building become one (used when far behind). */
/** @param {Visit[]} queue */
export function collapse(queue) {
  /** @type {Visit[]} */
  const merged = [];
  for (const visit of queue) {
    const last = merged[merged.length - 1];
    if (last && last.building === visit.building && last.kind === visit.kind && !last.hold && !visit.hold) {
      visit.toolUseIds.forEach((id) => last.toolUseIds.add(id));
      last.settles.push(...visit.settles);
      last.arrive = visit.arrive;
      last.tool = visit.tool;
    } else {
      merged.push(visit);
    }
  }
  queue.splice(0, queue.length, ...merged);
}

/** @param {Director} d @param {Runtime} rt @param {Visit} visit */
export function arrive(d, rt, visit) {
  rt.walking = false;
  if (rt.leaving || d.disposed) return;
  rt.at = visit.building;
  rt.arrivedAt = d.now();
  visit.arrived = true;
  visit.arrive();
  for (const settle of visit.settles.splice(0)) settle();
  pump(d, rt);
}

/** @param {Director} d @param {Runtime} rt @param {Visit} visit @param {'walk'|'run'|'teleport'} pace */
export function walkTo(d, rt, visit, pace) {
  rt.current = visit;
  rt.walking = true;
  rt.pace = pace;
  const seq = ++rt.walkSeq;
  const trip = rt.at === visit.building ? true : d.world.goTo(rt.key, visit.building, { pace });
  const done = () => {
    if (seq === rt.walkSeq) arrive(d, rt, visit);
  };
  Promise.resolve(trip).then(done, done);
}

/**
 * Starts the next visit when the agent is free: not walking, not held, and done dwelling long
 * enough for its last activity to be seen (skipped while catching up).
 * @param {Director} d
 * @param {Runtime} rt
 */
export function pump(d, rt) {
  if (rt.walking || rt.leaving || rt.pumpTimer != null || rt.current?.hold) return;
  if (!rt.queue.length) {
    rt.rush = null;
    return;
  }
  const wait = rt.rush ? 0 : DWELL_MS - (d.now() - rt.arrivedAt);
  if (wait > 0) {
    rt.pumpTimer = d.later(() => {
      rt.pumpTimer = null;
      pump(d, rt);
    }, wait);
    return;
  }
  const visit = /** @type {Visit} */ (rt.queue.shift());
  walkTo(d, rt, visit, visit.historic ? 'teleport' : rt.rush ?? 'walk');
}

/**
 * Queues a visit. More than RUN_AFTER waiting → the agent runs; more than TELEPORT_AFTER → it
 * teleports (the current walk included) and repeated visits merge. The queue never exceeds
 * MAX_QUEUE: the oldest visits are dropped.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {Visit} visit
 */
export function enqueue(d, rt, visit) {
  if (rt.leaving) return;
  rt.queue.push(visit);
  if (rt.queue.length > TELEPORT_AFTER) {
    rt.rush = 'teleport';
    collapse(rt.queue);
    hurry(d, rt);
  } else if (rt.queue.length > RUN_AFTER && rt.rush !== 'teleport') {
    rt.rush = 'run';
  }
  if (rt.queue.length > MAX_QUEUE) rt.queue.splice(0, rt.queue.length - MAX_QUEUE);
  if (rt.rush && rt.pumpTimer != null) {
    d.cancel(rt.pumpTimer);
    rt.pumpTimer = null;
  }
  pump(d, rt);
}

/** Cuts the current walk short with a teleport. @param {Director} d @param {Runtime} rt */
export function hurry(d, rt) {
  const visit = rt.current;
  if (!rt.walking || !visit || rt.pace === 'teleport') return;
  rt.pace = 'teleport';
  const seq = ++rt.walkSeq;
  const done = () => {
    if (seq === rt.walkSeq) arrive(d, rt, visit);
  };
  Promise.resolve(d.world.goTo(rt.key, visit.building, { pace: 'teleport' })).then(done, done);
}

/**
 * Plays a tool result where it belongs: on arrival if the agent is still on its way to that tool's
 * building, otherwise right away.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {string|null} toolUseId
 * @param {() => void} reaction
 */
export function settle(d, rt, toolUseId, reaction) {
  const run = scoped(d, d.historic, reaction);
  const visit = toolUseId ? [rt.current, ...rt.queue].find((v) => v?.toolUseIds.has(toolUseId)) : null;
  if (visit && !visit.arrived) visit.settles.push(run);
  else run();
}

/** Lets a held agent go (its permit was answered, its compaction finished, …). */
/** @param {Director} d @param {Runtime} rt */
export function release(d, rt) {
  for (const handle of rt.nagTimers) d.cancel(handle);
  rt.nagTimers = [];
  rt.holdReason = null;
  rt.queue = rt.queue.filter((v) => !v.hold);
  if (rt.current?.hold) {
    rt.current.hold = false;
    pump(d, rt);
  }
}

/** @param {Director} d @param {Runtime} rt */
export function wake(d, rt) {
  d.cancel(rt.sleepTimer);
  rt.sleepTimer = null;
  if (rt.sleeping) {
    d.world.emote(rt.key, '❗');
    say(d, rt, d.quip('wake', contextFor(d, rt)), { priority: 'high' });
  }
  rt.sleeping = false;
  rt.idle = false;
  rt.queue = rt.queue.filter((v) => v.kind !== 'idle');
}

// ---------------------------------------------------------------------------------------------
// Speech.

/** @param {Director} d @param {Runtime} rt @param {{line: string, style: object}} item */
export function speak(d, rt, item) {
  rt.lastSayAt = d.now();
  d.world.say(rt.key, item.line, item.style);
}

/** Speaks the waiting lines one gap apart. @param {Director} d @param {Runtime} rt */
export function drainSpeech(d, rt) {
  if (rt.sayTimer != null || !rt.speech.length) return;
  rt.sayTimer = d.later(
    () => {
      rt.sayTimer = null;
      const item = rt.speech.shift();
      if (item) speak(d, rt, item);
      drainSpeech(d, rt);
    },
    SAY_GAP_MS - (d.now() - rt.lastSayAt),
  );
}

/**
 * Says something, at most once per SAY_GAP_MS per agent. High-priority lines that come too soon
 * queue up (the oldest are dropped past MAX_SPEECH_QUEUE); anything else is simply skipped.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {string} text
 * @param {{tone?: 'speech'|'thought'|'shout'|'code', ms?: number, priority?: 'high'|'normal'}} [opts]
 */
export function say(d, rt, text, opts = {}) {
  const line = clip(oneLine(text), 140);
  if (!line || d.historic) return;
  const item = { line, style: { tone: opts.tone ?? 'speech', ...(opts.ms ? { ms: opts.ms } : {}) } };
  if (!rt.speech.length && d.now() - rt.lastSayAt >= SAY_GAP_MS) return speak(d, rt, item);
  if (opts.priority !== 'high') return;
  rt.speech.push(item);
  if (rt.speech.length > MAX_SPEECH_QUEUE) rt.speech.shift();
  drainSpeech(d, rt);
}

/** @param {unknown} path */
export function baseName(path) {
  const parts = str(path).replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * Details a quip may use. Missing values are fine: humor.js only picks lines it can fill.
 * @param {Director} d
 * @param {Runtime} rt
 * @param {TownEvent} [e]
 */
export function contextFor(d, rt, e) {
  const data = e?.data ?? {};
  const input = isObject(data.input) ? data.input : {};
  const session = sessionOf(d, rt.sessionId);
  return {
    agent: rt.name,
    type: rt.type,
    project: session?.project,
    model: modelLabel(session?.model),
    tool: data.tool,
    file: baseName(input.file_path ?? input.notebook_path ?? input.path),
    cmd: input.command ? shortCommand(input.command, 32) : undefined,
    pattern: input.pattern ?? input.query,
    query: input.query,
    host: hostOf(input.url) || hostOf(/https?:\/\/\S+/.exec(str(input.command))?.[0]),
    server: data.mcpServer,
    skill: data.tool === 'Skill' ? input.skill ?? input.command : undefined,
    name: input.name,
    to: data.to,
  };
}
