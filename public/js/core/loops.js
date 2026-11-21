// Agents going round in circles (docs/design/agent-health.md §4): the same step failing again and
// again with nothing changed, or run over and over with nothing changed, whatever its exit code.
// Pure, and needing nothing but text.js (shared with the server too), because both sides run it:
// the browser's store keeps AgentState.stuck through it, and the server's notifier sends its phone
// note from it. Each maps its own events to the small input below: a finished tool call
// (LoopCall), or a fresh start for an agent (reset).
//
//   rule 1  the same step failed 3 times with no change in between
//   rule 2  the identical step ran 5 times with no change in between, whatever its exit code
//           (`npm test 2>&1 | tail -40` exits with tail's status, so failures can hide)
//   rule 3  the same step failed 6 times within 20 minutes with the same first error line,
//           changes or not
//
// A change is progress: a successful edit or patch by any agent working in the same folder
// (helpers share the tree), or a shell command that changes files. An alert ends when its step
// succeeds (rules 1 and 3), when a change happens (rules 1 and 2), or when the agent starts afresh
// (its turn ended, you sent a prompt, it finished: the callers' resets). Steps that wait or poll
// by nature are never counted: nothing changes while one waits, and that is not a loop.
import { clip, isObject, oneLine, shellWords, shortPath, str } from './text.js';

/**
 * One finished tool call, as the rules read it.
 * @typedef {object} LoopCall
 * @property {string} agent   who made it: an agent key ("<session>:main")
 * @property {string} folder  the folder it ran in (the hook's cwd)
 * @property {string} tool
 * @property {Record<string, any>} input
 * @property {boolean} ok     false for PostToolUseFailure and PermissionDenied
 * @property {string} error   its first error line ('' when it succeeded)
 * @property {number} at      when it finished (ms)
 */

/**
 * Why an agent seems stuck: AgentState.stuck (CONTRACTS §5.1).
 * @typedef {object} Stuck
 * @property {1|2|3} rule
 * @property {string} step    the step in a few words, for display ("npm test")
 * @property {number} since   when the episode started: a new episode is a new alert
 * @property {number} count   its failures (rules 1 and 3) or runs (rule 2)
 * @property {string} text    one line: "Seems stuck: `npm test` failed 3 times, nothing changed"
 */

/**
 * An agent's alert started, changed or ended.
 * @typedef {object} LoopChange
 * @property {string} agent
 * @property {Stuck|null} stuck   null: the alert ended
 * @property {boolean} started    a new episode: the moment for a log line or a note
 */

/**
 * What is remembered of one step of one agent.
 * @typedef {object} Step
 * @property {string} label
 * @property {number} fails     failures since the last change or success (rule 1)
 * @property {number} runs      runs since the last change (rule 2)
 * @property {{ at: number, error: string }[]} failures  recent failures, in arrival order (rule 3)
 */

/**
 * @typedef {object} AgentLoops
 * @property {string} folder
 * @property {Map<string, Step>} steps  least recently run first
 * @property {Stuck|null} stuck
 */

/** Rule 1: the same step failed this many times with nothing changed. */
const SAME_FAILURES = 3;
/** Rule 2: the identical step ran this many times with nothing changed. */
const SAME_RUNS = 5;
/** Rule 3: the same step failed this many times with the same first error line… */
const SAME_ERRORS = 6;
/** …within this window, changes or not. */
const SAME_ERRORS_MS = 20 * 60_000;
/** Agents remembered at once; the one quiet the longest is forgotten first. */
export const MAX_AGENTS = 200;
/** Steps remembered per agent; the one run the longest ago is forgotten first. */
export const MAX_STEPS = 20;
/** Failures remembered per step, for rule 3: room for a few other errors among six alike. */
const MAX_FAILURES = 12;
/** A step key is cut here: the rest of a long input says nothing more about repeating it. */
export const MAX_KEY_CHARS = 300;
/** The step's words in the alert, short enough for the whole alert to fit on a crew row. */
const LABEL_CHARS = 36;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Tools that work on one file: the same tool on the same file is the same step. */
const FILE_TOOLS = new Set(['Read', 'NotebookRead', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
/** Tools whose success changes files. `apply_patch` is a Codex patch its adapter left whole (a deleted file). */
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);

/**
 * Tools that wait by nature: they read a background task's output (BashOutput, and TaskOutput
 * until Claude Code removed it), watch a command (Monitor), wait for something (ScheduleWakeup of
 * a self-paced loop, WaitForMcpServers) or check on teammates' tasks (TaskList, TaskGet).
 */
const POLLING_TOOLS = new Set(['BashOutput', 'TaskOutput', 'Monitor', 'ScheduleWakeup', 'WaitForMcpServers', 'TaskList', 'TaskGet']);
/** Claude Code writes a background task's output to …/tasks/<id>.output, which Claude reads again and again. */
const TASK_OUTPUT = /\/tasks\/[\w.-]+\.output(?![\w.-])/;
/** Shell commands that wait or poll by nature, read after a leading `cd <dir> &&`. */
const POLLING_COMMANDS = Object.freeze([
  /^(?:sleep|start-sleep)\b/i,
  /\b(?:while|until|for)\b.*\bsleep\b/,
  /(?:^|[;&|]\s*)watch\s/,
  /\bgh\s+(?:run\s+(?:watch|view|list)|pr\s+(?:checks|status)|workflow\s+view)\b/,
  /\bgh\s+api\b.*\/(?:actions\/runs|check-runs|check-suites|status(?:es)?)\b/,
  /\bglab\s+(?:ci|pipeline)\s+(?:status|view|list|trace)\b/,
  /\bkubectl\s+(?:rollout\s+status|wait)\b/,
  /\\tasks\\[\w.-]+\.output\b/,
  TASK_OUTPUT,
]);

/**
 * Shell commands that change files, judged by the command (what it did cannot be seen): in-place
 * edits, formatters and fixers, git commands that rewrite the work tree or the index, patches,
 * package installs, and moving, copying, creating or removing files. A command's output written
 * to a file (`> test.log`) is not on the list: test output is often kept that way, and counting
 * it would hide the very loops rule 2 is for.
 */
const CHANGING_COMMANDS = Object.freeze([
  /\b(?:sed|perl)\s+(?:[^|;&]*\s)?-[a-zA-Z]*i/,
  /\bsed\s+(?:[^|;&]*\s)?--in-place\b/,
  /\s--(?:write|fix)(?![\w-])/,
  /\b(?:ruff\s+format|black|cargo\s+fmt|go\s+fmt|gofmt\s+-w)\b/,
  /\bgit\s+(?:-[cC]\s+\S+\s+)*(?:checkout|switch|restore|reset|stash(?!\s+(?:list|show)\b)|apply|am|merge|rebase|pull|cherry-pick|revert|commit)\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci|remove|uninstall|rm)\b|\b(?:pip3?|uv\s+pip)\s+install\b|\buv\s+(?:sync|add)\b|\bpoetry\s+(?:install|add)\b|\bcargo\s+add\b|\bgo\s+get\b|\bbundle\s+install\b/,
  /(?:^|[\s;&|(])(?:patch|rm|mv|cp|mkdir|touch)\s/,
]);

const LEADING_CD = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*&&\s*/;
/** Output plumbing at the end of a command: `2>&1`, or a single pipe into tail, head or grep. */
const TRAILING_PLUMBING = /\s*(?:2>&1|(?<!\|)\|(?!\|)\s*(?:tail|head|grep)\b[^|]*)$/;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:\/)/;

/** @type {Readonly<Record<1|2|3, (n: number) => string>>} */
const WORDS = Object.freeze({
  1: (n) => `failed ${n} times, nothing changed`,
  2: (n) => `ran ${n} times, nothing changed`,
  3: (n) => `failed ${n} times with the same error`,
});

/**
 * A shell command as the step it repeats: whitespace collapsed, without a leading `cd <dir> &&`
 * and without trailing output plumbing, so `cd app && npm test 2>&1 | tail -40` is `npm test`.
 * @param {unknown} command  a string, or a list of arguments (Codex)
 */
export function coreCommand(command) {
  let text = commandText(command).replace(LEADING_CD, '');
  for (let before = ''; before !== text; ) {
    before = text;
    text = text.replace(TRAILING_PLUMBING, '').trim();
  }
  return text;
}

/**
 * What makes two calls the same step: the command, the tool and its file, the search, or else the
 * whole input (keys in any order), cut at MAX_KEY_CHARS.
 * @param {string} tool
 * @param {unknown} input
 */
export function stepKey(tool, input) {
  const args = isObject(input) ? input : {};
  if (SHELL_TOOLS.has(tool)) return clip(`${tool}\n${coreCommand(args.command)}`, MAX_KEY_CHARS);
  if (tool === 'Read') return clip(`${tool}\n${pathOf(args)}\n${str(args.offset)}\n${str(args.limit)}`, MAX_KEY_CHARS);
  if (FILE_TOOLS.has(tool)) return clip(`${tool}\n${pathOf(args)}`, MAX_KEY_CHARS);
  if (SEARCH_TOOLS.has(tool)) return clip(`${tool}\n${str(args.pattern)}\n${pathOf(args)}`, MAX_KEY_CHARS);
  return clip(`${tool}\n${sortedJson(args)}`, MAX_KEY_CHARS);
}

/**
 * Whether a shell command changes files (see CHANGING_COMMANDS).
 * @param {unknown} command
 */
export function changesFiles(command) {
  const text = commandText(command);
  return CHANGING_COMMANDS.some((pattern) => pattern.test(text));
}

/**
 * A command on one line: a string as it is, a list of arguments (Codex) joined as a shell would
 * need them, anything else nothing.
 * @param {unknown} command
 */
function commandText(command) {
  return Array.isArray(command) ? oneLine(shellWords(command)) : oneLine(command);
}

/**
 * Whether a call waits or polls by nature, so that running it again and again is no loop.
 * @param {string} tool
 * @param {unknown} input
 */
export function isPolling(tool, input) {
  const args = isObject(input) ? input : {};
  if (POLLING_TOOLS.has(tool)) return true;
  if (tool === 'Read') return TASK_OUTPUT.test(pathOf(args));
  if (!SHELL_TOOLS.has(tool)) return false;
  const command = coreCommand(args.command);
  return POLLING_COMMANDS.some((pattern) => pattern.test(command));
}

/**
 * The rules' memory for every agent. Bounded: MAX_AGENTS agents of MAX_STEPS steps each.
 */
export function createLoops() {
  /** @type {Map<string, AgentLoops>} least recently active first */
  const agents = new Map();

  /**
   * An agent starts afresh: everything about it is forgotten, and its alert, if any, ends.
   * @param {string} agent
   * @returns {LoopChange[]}
   */
  function reset(agent) {
    const memory = agents.get(agent);
    agents.delete(agent);
    return memory?.stuck ? [ended(agent)] : [];
  }

  return {
    /**
     * A finished tool call. Returns every alert it started, changed or ended: a change by one
     * agent can end the alerts of others in the same folder.
     * @param {LoopCall} raw
     * @returns {LoopChange[]}
     */
    record(raw) {
      const call = { ...raw, tool: str(raw.tool), input: isObject(raw.input) ? raw.input : {} };
      const change = isChange(call);
      if (!change && isPolling(call.tool, call.input)) return [];
      const forgotten = remember(agents, call);
      const memory = /** @type {AgentLoops} */ (agents.get(call.agent));
      const key = stepKey(call.tool, call.input);
      if (call.ok) succeeded(memory.steps.get(key));
      if (change) return [...forgotten, ...progress(agents, call)];
      count(memory, key, call);
      return [...forgotten, ...judge(call.agent, memory, call.at)];
    },
    reset,
    /**
     * Every agent `belongs` picks starts afresh (a session's agents, when it ends).
     * @param {(agent: string) => boolean} belongs
     */
    resetAll(belongs) {
      return [...agents.keys()].filter(belongs).flatMap(reset);
    },
  };
}

/**
 * The calling agent's memory, made the most recent; past MAX_AGENTS the agents quiet the longest
 * are forgotten, and their alerts end.
 * @param {Map<string, AgentLoops>} agents
 * @param {LoopCall} call
 * @returns {LoopChange[]}
 */
function remember(agents, call) {
  const memory = agents.get(call.agent) ?? { folder: '', steps: new Map(), stuck: null };
  agents.delete(call.agent);
  memory.folder = folderOf(call.folder);
  agents.set(call.agent, memory);
  return trim(agents, MAX_AGENTS)
    .filter(([, gone]) => gone.stuck)
    .map(([agent]) => ended(agent));
}

/**
 * A change: the counts of rules 1 and 2 start again for the agent that made it and for every
 * agent in its tree. Rule 3 keeps its failures: it holds whether things changed or not.
 * @param {Map<string, AgentLoops>} agents
 * @param {LoopCall} call
 * @returns {LoopChange[]}
 */
function progress(agents, call) {
  const where = folderOf(call.folder);
  const file = changedFile(call, where);
  /** @type {LoopChange[]} */
  const changes = [];
  for (const [agent, memory] of agents) {
    if (agent !== call.agent && !sameTree(memory.folder, where, file)) continue;
    for (const step of memory.steps.values()) {
      step.fails = 0;
      step.runs = 0;
    }
    changes.push(...judge(agent, memory, call.at));
  }
  return changes;
}

/**
 * Counts a run of a step that changed nothing, the newest MAX_STEPS steps kept.
 * @param {AgentLoops} memory
 * @param {string} key
 * @param {LoopCall} call
 */
function count(memory, key, call) {
  const step = memory.steps.get(key) ?? { label: stepLabel(call), fails: 0, runs: 0, failures: [] };
  memory.steps.delete(key);
  memory.steps.set(key, step);
  trim(memory.steps, MAX_STEPS);
  step.runs += 1;
  if (call.ok) return;
  step.fails += 1;
  const error = clip(oneLine(call.error), 200);
  // Rule 3's window: only failures within SAME_ERRORS_MS of the newest are kept.
  const recent = step.failures.filter((failure) => call.at - failure.at <= SAME_ERRORS_MS);
  step.failures = [...recent, { at: call.at, error }].slice(-MAX_FAILURES);
}

/**
 * The step worked: its failures no longer count (rules 1 and 3 end).
 * @param {Step|undefined} step
 */
function succeeded(step) {
  if (!step) return;
  step.fails = 0;
  step.failures = [];
}

/**
 * Whether the agent seems stuck now, as a change of its alert. While any step stays stuck the
 * episode goes on, showing the step run most recently; it keeps the time it started.
 * @param {string} agent
 * @param {AgentLoops} memory
 * @param {number} at
 * @returns {LoopChange[]}
 */
function judge(agent, memory, at) {
  const found = stuckStep(memory);
  const before = memory.stuck;
  if (!found) {
    memory.stuck = null;
    return before ? [ended(agent)] : [];
  }
  const stuck = alert(found.rule, found.label, found.count, before?.since ?? at);
  if (before?.text === stuck.text) return [];
  memory.stuck = stuck;
  return [{ agent, stuck, started: !before }];
}

/**
 * The stuck step run most recently, with its rule.
 * @param {AgentLoops} memory
 * @returns {{ rule: 1|2|3, count: number, label: string }|null}
 */
function stuckStep(memory) {
  let found = null;
  for (const step of memory.steps.values()) {
    const rule = ruleOf(step);
    if (rule) found = { ...rule, label: step.label };
  }
  return found;
}

/**
 * Which rule a step meets. "Nothing changed" says the most when it holds, so rule 1 comes first;
 * rule 2 only speaks for a step that does not visibly fail.
 * @param {Step} step
 * @returns {{ rule: 1|2|3, count: number }|null}
 */
function ruleOf(step) {
  if (step.fails >= SAME_FAILURES) return { rule: 1, count: step.fails };
  const same = sameErrors(step.failures);
  if (same >= SAME_ERRORS) return { rule: 3, count: same };
  if (step.runs >= SAME_RUNS) return { rule: 2, count: step.runs };
  return null;
}

/**
 * How many of the step's recent failures had the newest one's error. `count` keeps only those
 * within SAME_ERRORS_MS of the newest.
 * @param {{ at: number, error: string }[]} failures
 */
function sameErrors(failures) {
  const newest = failures.at(-1);
  return newest ? failures.filter((failure) => failure.error === newest.error).length : 0;
}

/**
 * @param {1|2|3} rule
 * @param {string} step
 * @param {number} count
 * @param {number} since
 * @returns {Stuck}
 */
function alert(rule, step, count, since) {
  return { rule, step, since, count, text: `Seems stuck: \`${step}\` ${WORDS[rule](count)}` };
}

/** @param {string} agent @returns {LoopChange} */
function ended(agent) {
  return { agent, stuck: null, started: false };
}

/**
 * Whether a call changed files: progress for every agent in its tree.
 * @param {LoopCall} call
 */
function isChange(call) {
  if (!call.ok) return false;
  if (EDIT_TOOLS.has(call.tool)) return true;
  return SHELL_TOOLS.has(call.tool) && changesFiles(call.input.command);
}

/**
 * Whether a change concerns an agent in `folder`: it was made in the same folder, or the file it
 * changed lies in that folder (a helper that went into a package of the project).
 * @param {string} folder
 * @param {string} where   the folder the change was made in
 * @param {string|null} file  the file it changed, when known
 */
function sameTree(folder, where, file) {
  if (!folder) return false;
  return folder === where || (file !== null && inside(file, folder));
}

/**
 * The absolute path an editing call changed, or null (a shell command does not say).
 * @param {LoopCall} call
 * @param {string} where
 */
function changedFile(call, where) {
  const path = EDIT_TOOLS.has(call.tool) ? pathOf(call.input) : '';
  if (!path) return null;
  return ABSOLUTE_PATH.test(path) || !where ? path : `${where}/${path}`;
}

/** @param {string} path @param {string} folder */
function inside(path, folder) {
  return path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/**
 * A folder as compared here: forward slashes, no trailing slash.
 * @param {unknown} path
 */
function folderOf(path) {
  const text = str(path).trim().replace(/\\/g, '/');
  return text.length > 1 ? text.replace(/\/+$/, '') : text;
}

/** @param {Record<string, any>} input */
function pathOf(input) {
  return str(input.file_path ?? input.notebook_path ?? input.path).trim().replace(/\\/g, '/');
}

/**
 * JSON with its keys sorted, so the order of keys never makes two inputs differ.
 * @param {unknown} value
 */
function sortedJson(value) {
  try {
    return JSON.stringify(value, (_key, v) => (isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)) ?? '';
  } catch {
    return '';
  }
}

/**
 * The step in a few words, for the alert: the command itself, or the tool with its file or
 * pattern.
 * @param {LoopCall} call
 */
function stepLabel(call) {
  const { tool, input } = call;
  if (SHELL_TOOLS.has(tool)) return clip(coreCommand(input.command), LABEL_CHARS) || tool;
  const path = pathOf(input);
  if (path && FILE_TOOLS.has(tool)) return `${tool} ${shortPath(path, call.folder, Math.max(12, LABEL_CHARS - tool.length - 1))}`;
  if (SEARCH_TOOLS.has(tool)) return clip(`${tool} ${oneLine(input.pattern)}`, LABEL_CHARS);
  return clip(tool, LABEL_CHARS);
}

/**
 * Drops a map's oldest entries past `max`, and returns them.
 * @template V
 * @param {Map<string, V>} map
 * @param {number} max
 * @returns {[string, V][]}
 */
function trim(map, max) {
  /** @type {[string, V][]} */
  const dropped = [];
  for (const entry of map) {
    if (map.size <= max) break;
    map.delete(entry[0]);
    dropped.push(entry);
  }
  return dropped;
}
