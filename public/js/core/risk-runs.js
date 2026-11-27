// Risky calls that ran without asking you (core/risk.js): an allow rule, a permission mode or an
// earlier "don't ask again" let them through, so no card ever showed. The store follows each
// agent's calls: a permission request marks its call as asked; a risky call that then ends (it
// ran, or ran and failed) without having asked is kept here, and "needs you" counts it until you
// set it aside (core/attention.js). Calls are told apart by the server's call key (`andary_key`,
// the same for a request and the hooks of its call, also when an adapter renamed the tool, as
// Codex's apply_patch becomes Edit or Write), else by their tool and input with keys in order, as
// the permission request carries no tool_use_id. A refusal takes its mark away. Pure; bounded
// memory.
import { riskOf } from './risk.js';
import { clip, oneLine } from './text.js';

/**
 * @typedef {object} RiskRun
 * @property {string} id         one per run: `risk:<agent>:<when>`
 * @property {string} sessionId
 * @property {string} agentKey
 * @property {number} at          when it ended
 * @property {string} tool
 * @property {string} what        the command or file, one line, cut short
 * @property {string[]} reasons   core/risk.js
 */

/** Asked-for calls remembered per agent; the oldest are forgotten. */
const MAX_ASKED = 50;
/** Risky runs kept; the oldest are forgotten. */
const MAX_RUNS = 50;
/** A run's command or file is cut here. */
const WHAT_CHARS = 120;

/** @param {unknown} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const object = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

/**
 * Which call a hook is about: the server's call key when it has one, else its tool and input.
 * @param {unknown} key  the event's callKey (andary_key)
 * @param {string} tool @param {unknown} input
 * @returns {string}
 */
export function riskCallKey(key, tool, input) {
  if (typeof key === 'string' && key) return `key:${key}`;
  try {
    return `${tool}\n${canonical(input)}`;
  } catch {
    return `${tool}\n?`;
  }
}

/** @param {unknown} input */
function whatOf(input) {
  const object = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const text = typeof input === 'string' ? input : object.command ?? object.file_path ?? object.notebook_path ?? '';
  return clip(oneLine(Array.isArray(text) ? text.join(' ') : String(text)), WHAT_CHARS);
}

export function createRiskRuns() {
  /** @type {Map<string, string[]>} agent → keys of calls that asked, oldest first */
  const asked = new Map();
  /** @type {RiskRun[]} */
  let runs = [];

  return {
    /**
     * A permission request: this agent's call asked you.
     * @param {string} agent @param {string} key  riskCallKey
     */
    asked(agent, key) {
      const keys = asked.get(agent) ?? [];
      keys.push(key);
      if (keys.length > MAX_ASKED) keys.shift();
      asked.set(agent, keys);
    },

    /**
     * A call that was refused (in the town or the terminal): it will not run, so its mark goes.
     * @param {string} agent @param {string} key
     */
    refused(agent, key) {
      const keys = asked.get(agent);
      const mark = keys ? keys.lastIndexOf(key) : -1;
      if (keys && mark >= 0) keys.splice(mark, 1);
    },

    /**
     * A call that ended (it ran): the run it makes when it is risky and did not ask, else null.
     * A call that asked uses up its mark, so the same command run again later without asking
     * still counts.
     * @param {{ agent: string, session: string, key: string, tool: string, input: unknown, at: number, place: import('./risk.js').RiskPlace }} call
     * @returns {RiskRun|null}
     */
    ended({ agent, session, key, tool, input, at, place }) {
      const keys = asked.get(agent);
      const mark = keys ? keys.lastIndexOf(key) : -1;
      if (keys && mark >= 0) {
        keys.splice(mark, 1);
        return null;
      }
      const risk = riskOf(tool, input, place);
      // A rebuildable folder (rm -rf dist) is ordinary work: no notice.
      if (!risk || risk.quiet) return null;
      /** @type {RiskRun} */
      const run = { id: `risk:${agent}:${at}`, sessionId: session, agentKey: agent, at, tool, what: whatOf(input), reasons: risk.reasons };
      runs = [...runs, run].slice(-MAX_RUNS);
      return run;
    },

    /** A crew left: its marks and runs go with it. @param {string} session */
    sessionEnded(session) {
      for (const agent of [...asked.keys()]) if (agent.startsWith(`${session}:`)) asked.delete(agent);
      const kept = runs.filter((run) => run.sessionId !== session);
      const changed = kept.length !== runs.length;
      runs = kept;
      return changed;
    },

    /** @returns {readonly RiskRun[]} oldest first */
    list() {
      return runs;
    },
  };
}

/**
 * The run in a few words, for the activity log and "needs you": "Ran without asking: git reset
 * --hard (throws away uncommitted changes)".
 * @param {RiskRun} run
 */
export function riskRunText(run) {
  return `Ran without asking: ${run.what || run.tool} (${run.reasons[0] ?? 'risky'})`;
}
