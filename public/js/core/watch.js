// Cost and fan-out alerts, and long turns (CONTRACTS §5.1): a crew that spends fast with nothing to
// show ("$3.10 in the last 10 min, no files changed"), a turn that costs more than you set, a turn
// that starts many helpers ("Started 12 helpers this turn"), and a lead working a long time with no
// edits ("Working 42 min, no edits for 25 min"). Pure: the town's store and the phone notes
// (server/notify.mjs) feed one of these the same steps and get the same alerts.
//
// Cost comes from Claude Code's transcripts (server/usage.mjs), as each agent's total so far: what
// an agent had spent when the watch first heard of it is not counted (the town may open mid-turn,
// or reconnect), only what it spends after. Codex reports no cost, so a Codex crew only ever gets
// the helpers alert. Cost is an estimate at API list prices: on a Pro or Max plan a measure of
// value, not a bill, so the words say "estimate" and give the tokens too.
//
// An alert lasts until you set it aside, give the crew a prompt, or the session ends. A crew gets
// at most one alert of a kind per cooldown (30 minutes by default), and at most one turn-cost and
// one helpers alert per turn.
import { changesFiles } from './loops.js';
import { isObject } from './text.js';

/**
 * @typedef {object} WatchSettings  every threshold 0 turns its alert off
 * @property {number} burnUsd         alert when a crew spends this much (estimated $) within burnMinutes with no files changed
 * @property {number} burnMinutes     the burn window
 * @property {number} turnUsd         alert when one turn costs this much
 * @property {number} helpers         alert when one turn starts this many helpers
 * @property {number} longMinutes     a turn running this long…
 * @property {number} quietMinutes    …with no edit for this long gets a note on its row
 * @property {number} cooldownMinutes at most one alert of a kind per crew in this time
 * @property {boolean} phone          also a phone note (andary start --notify) when a cost or helpers alert starts
 */

/** @type {Readonly<WatchSettings>} */
export const WATCH_DEFAULTS = Object.freeze({ burnUsd: 3, burnMinutes: 10, turnUsd: 10, helpers: 10, longMinutes: 30, quietMinutes: 20, cooldownMinutes: 30, phone: false });

/** Each number's allowed range; a value outside it falls back to the default (Settings clamps first). */
export const WATCH_RANGES = Object.freeze({
  burnUsd: [0, 1000],
  burnMinutes: [1, 120],
  turnUsd: [0, 1000],
  helpers: [0, 200],
  longMinutes: [0, 600],
  quietMinutes: [1, 600],
  cooldownMinutes: [1, 1440],
});

/**
 * Settings read defensively (they come from storage, a browser or a file): each field checked,
 * a missing or bad one is its default.
 * @param {unknown} raw
 * @returns {WatchSettings}
 */
export function readWatchSettings(raw) {
  const data = isObject(raw) ? raw : {};
  /** @type {any} */
  const settings = { ...WATCH_DEFAULTS };
  for (const [key, [min, max]] of Object.entries(WATCH_RANGES)) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) settings[key] = Math.round(value * 100) / 100;
  }
  if (typeof data.phone === 'boolean') settings.phone = data.phone;
  return settings;
}

/** @typedef {'burn'|'turn-cost'|'fan-out'} WatchKind */

/**
 * @typedef {object} WatchAlert
 * @property {string} id          one per episode
 * @property {WatchKind} kind
 * @property {string} sessionId
 * @property {number} since
 * @property {string} text        one line, for the crew's row ("$3.10 in the last 10 min, no files changed")
 * @property {number} usd         what the alert counts in dollars (0 for helpers)
 * @property {number} helpers     helpers started this turn (fan-out)
 */

/**
 * @typedef {object} WatchTurn  a lead's turn as far as the watch saw it
 * @property {number} start
 * @property {boolean} sawStart   the watch saw its prompt
 * @property {number|null} lastEditAt
 * @property {boolean} open       still going (no Stop yet)
 * @property {number} helpers     helpers started in it
 * @property {number} usd         what it spent so far (estimate)
 * @property {number} tokens
 */

/**
 * One step of a crew, as both sides read their events:
 *   prompt  your prompt to the lead: a new turn, and the crew's alerts end
 *   edit    a file changed (a file tool, a patch, or a shell command that writes: isEditCall)
 *   helper  a helper started
 *   stop    the lead's turn ended
 *   end     the session ended
 *   usage   an agent's total cost and tokens so far (from the transcripts)
 * @typedef {{ type: 'prompt'|'edit'|'helper'|'stop'|'end', sessionId: string, at: number }
 *   | { type: 'usage', sessionId: string, agentKey: string, costUsd: number, tokens: number, at: number }} WatchStep
 */

const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Spends remembered per crew: more than any window needs. */
const MAX_SPENDS = 400;
/** Crews remembered at once; the oldest give way. */
const MAX_CREWS = 200;
const MINUTE = 60_000;

/**
 * Whether a finished tool call changed files: a file tool, a patch, or a shell command that writes
 * (core/loops.js changesFiles, as the stuck rules read it).
 * @param {string} tool
 * @param {unknown} input
 */
export function isEditCall(tool, input) {
  if (FILE_TOOLS.has(tool)) return true;
  if (!SHELL_TOOLS.has(tool)) return false;
  const command = isObject(input) && typeof input.command === 'string' ? input.command : '';
  return Boolean(command) && changesFiles(command, tool === 'PowerShell');
}

/** "$3.10", "under $0.01". @param {number} usd */
export function dollars(usd) {
  return usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`;
}

/** "1.2M", "830k", "950". @param {number} n */
function tokenWords(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

/** "42 min", "1 h 05 min". @param {number} ms */
export function minutesWords(ms) {
  const m = Math.max(0, Math.floor(ms / MINUTE));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/**
 * @typedef {object} Crew
 * @property {{ at: number, usd: number, tokens: number }[]} spends  oldest first
 * @property {number|null} lastEditAt
 * @property {WatchTurn|null} turn
 * @property {Map<WatchKind, number>} lastAlert  when each kind last started
 * @property {Set<WatchKind>} turnAlerts  kinds already raised in this turn
 * @property {WatchAlert[]} alerts
 */

/** @param {{ settings?: unknown }} [options] */
export function createWatch({ settings: initial } = {}) {
  let settings = readWatchSettings(initial);
  /** @type {Map<string, Crew>} */
  const crews = new Map();
  /** @type {Map<string, { usd: number, tokens: number }>} agentKey → its totals as last heard */
  const totals = new Map();

  /** @param {string} sessionId @returns {Crew} */
  function crewOf(sessionId) {
    let crew = crews.get(sessionId);
    if (!crew) {
      crew = { spends: [], lastEditAt: null, turn: null, lastAlert: new Map(), turnAlerts: new Set(), alerts: [] };
      crews.set(sessionId, crew);
      if (crews.size > MAX_CREWS) crews.delete(/** @type {string} */ (crews.keys().next().value));
    }
    return crew;
  }

  /** @param {number} at @param {boolean} sawStart @returns {WatchTurn} */
  const newTurn = (at, sawStart) => ({ start: at, sawStart, lastEditAt: null, open: true, helpers: 0, usd: 0, tokens: 0 });

  /** The open turn, or one the watch joined midway. @param {Crew} crew @param {number} at */
  function turnOf(crew, at) {
    if (!crew.turn || !crew.turn.open) {
      crew.turn = newTurn(at, false);
      crew.turnAlerts.clear();
    }
    return crew.turn;
  }

  /**
   * Starts an alert unless its kind is cooling down for this crew (or was raised this turn).
   * @param {Crew} crew @param {string} sessionId @param {WatchKind} kind @param {number} at
   * @param {{ text: string, usd?: number, helpers?: number }} what
   * @returns {WatchAlert|null}
   */
  function raise(crew, sessionId, kind, at, what) {
    const last = crew.lastAlert.get(kind);
    if (last !== undefined && at - last < settings.cooldownMinutes * MINUTE) return null;
    if (kind !== 'burn' && crew.turnAlerts.has(kind)) return null;
    crew.lastAlert.set(kind, at);
    crew.turnAlerts.add(kind);
    /** @type {WatchAlert} */
    const alert = { id: `${kind}:${sessionId}:${at}`, kind, sessionId, since: at, text: what.text, usd: what.usd ?? 0, helpers: what.helpers ?? 0 };
    crew.alerts = [...crew.alerts.filter((a) => a.kind !== kind), alert];
    return alert;
  }

  /**
   * New spending: the burn rule over the window, and the turn's cost.
   * @param {Crew} crew @param {string} sessionId @param {number} at
   * @returns {WatchAlert[]}
   */
  function checkCost(crew, sessionId, at) {
    /** @type {WatchAlert[]} */
    const started = [];
    const windowMs = settings.burnMinutes * MINUTE;
    const recent = crew.spends.filter((s) => s.at > at - windowMs);
    const usd = recent.reduce((n, s) => n + s.usd, 0);
    const tokens = recent.reduce((n, s) => n + s.tokens, 0);
    const edited = crew.lastEditAt !== null && crew.lastEditAt > at - windowMs;
    if (settings.burnUsd > 0 && usd >= settings.burnUsd && !edited) {
      const alert = raise(crew, sessionId, 'burn', at, { text: `${dollars(usd)} (estimate, ${tokenWords(tokens)} tokens) in the last ${settings.burnMinutes} min, no files changed`, usd });
      if (alert) started.push(alert);
    }
    const turn = crew.turn;
    if (turn && settings.turnUsd > 0 && turn.usd >= settings.turnUsd) {
      const atLeast = turn.sawStart ? '' : 'at least ';
      const alert = raise(crew, sessionId, 'turn-cost', at, { text: `This turn has cost ${atLeast}${dollars(turn.usd)} (estimate, ${tokenWords(turn.tokens)} tokens)`, usd: turn.usd });
      if (alert) started.push(alert);
    }
    return started;
  }

  /**
   * @param {WatchStep} step
   * @returns {WatchAlert[]} the alerts that just started
   */
  function record(step) {
    const { sessionId, at } = step;
    if (!sessionId) return [];
    if (step.type === 'end') {
      crews.delete(sessionId);
      for (const key of [...totals.keys()]) if (key.startsWith(`${sessionId}:`)) totals.delete(key);
      return [];
    }
    const crew = crewOf(sessionId);
    switch (step.type) {
      case 'prompt':
        crew.turn = newTurn(at, true);
        crew.turnAlerts.clear();
        crew.alerts = [];
        return [];
      case 'edit':
        crew.lastEditAt = Math.max(crew.lastEditAt ?? 0, at);
        // A late edit after the Stop opens no turn: only work a turn is seen doing keeps it.
        if (crew.turn) crew.turn.lastEditAt = crew.lastEditAt;
        return [];
      case 'stop':
        if (crew.turn) crew.turn.open = false;
        return [];
      case 'helper': {
        const turn = turnOf(crew, at);
        turn.helpers += 1;
        if (settings.helpers <= 0 || turn.helpers < settings.helpers) return [];
        const alert = raise(crew, sessionId, 'fan-out', at, { text: `Started ${turn.helpers} helpers this turn`, helpers: turn.helpers });
        return alert ? [alert] : [];
      }
      case 'usage':
        return spent(crew, step);
      default:
        return [];
    }
  }

  /**
   * An agent's new totals: what it spent since it was last heard of goes to its crew and turn.
   * @param {Crew} crew @param {Extract<WatchStep, { type: 'usage' }>} step
   */
  function spent(crew, step) {
    const before = totals.get(step.agentKey);
    totals.set(step.agentKey, { usd: step.costUsd, tokens: step.tokens });
    // First heard of: what it spent before is not this window's or this turn's to count.
    if (!before) return [];
    const usd = Math.max(0, step.costUsd - before.usd);
    const tokens = Math.max(0, step.tokens - before.tokens);
    if (usd <= 0 && tokens <= 0) return [];
    crew.spends.push({ at: step.at, usd, tokens });
    if (crew.spends.length > MAX_SPENDS) crew.spends.shift();
    // Cost that comes in after the Stop is still that turn's (the transcript catches up).
    if (crew.turn) {
      crew.turn.usd += usd;
      crew.turn.tokens += tokens;
    }
    return checkCost(crew, step.sessionId, step.at);
  }

  return {
    record,
    /** @param {unknown} next */
    setSettings(next) {
      settings = readWatchSettings(next);
    },
    settings: () => settings,
    /** Every crew's alerts, oldest first. @returns {WatchAlert[]} */
    alerts: () => [...crews.values()].flatMap((crew) => crew.alerts).sort((a, b) => a.since - b.since),
    /** Each crew's turn now, by session id. @returns {Record<string, WatchTurn>} */
    turns() {
      /** @type {Record<string, WatchTurn>} */
      const out = {};
      for (const [id, crew] of crews) if (crew.turn) out[id] = { ...crew.turn };
      return out;
    },
  };
}

/** @typedef {ReturnType<typeof createWatch>} Watch */

/**
 * A lead's turn that has run long with no edit: its row's note ("Working 42 min, no edits for
 * 25 min"), or null.
 * @param {WatchTurn|undefined} turn
 * @param {WatchSettings} settings
 * @param {number} now
 * @returns {string|null}
 */
export function longTurnText(turn, settings, now) {
  if (!turn?.open || settings.longMinutes <= 0) return null;
  const running = now - turn.start;
  const quiet = now - (turn.lastEditAt ?? turn.start);
  if (running < settings.longMinutes * MINUTE || quiet < settings.quietMinutes * MINUTE) return null;
  const atLeast = turn.sawStart ? '' : 'at least ';
  const edits = turn.lastEditAt === null ? 'no edits yet' : `no edits for ${minutesWords(quiet)}`;
  return `Working ${atLeast}${minutesWords(running)}, ${edits}`;
}

/**
 * The phone note's words for an alert: what happened, never the crew's project or files.
 * @param {WatchAlert} alert
 */
export function watchNoteText(alert) {
  if (alert.kind === 'fan-out') return `A crew started ${alert.helpers} helpers in one turn.`;
  if (alert.kind === 'turn-cost') return `A crew's turn has cost ${dollars(alert.usd)} so far (estimate).`;
  return `A crew spent ${dollars(alert.usd)} (estimate) in a few minutes with no files changed.`;
}
