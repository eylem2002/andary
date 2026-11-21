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
//   rule 3  the same step failed 6 times within 20 minutes with the same error, changes or not:
//           the same first line that says something about it (not `Exit code 1`, not npm's
//           banner); a failure with no such line is left out of rule 3
//
// A change is progress: a successful edit or patch by any agent working in the same folder
// (helpers share the tree), or a shell command that changes files. An alert ends when its step
// succeeds (rules 1 and 3), when a change happens (rules 1 and 2), or when the agent starts afresh
// (its turn ended, you sent a prompt, it finished: the callers' resets). Steps that wait or poll
// by nature are never counted: nothing changes while one waits, and that is not a loop.
//
// Hooks reach Andary out of order, so the rules go by each call's own time (`at`): a call made
// before the agent's latest change counts for rule 3 only, and rule 3's window is in time order.
import { clip, isObject, oneLine, relativePath, shellWords, shortPath, str } from './text.js';

/**
 * One finished tool call, as the rules read it.
 * @typedef {object} LoopCall
 * @property {string} agent   who made it: an agent key ("<session>:main")
 * @property {string} folder  the folder it ran in (the hook's cwd)
 * @property {string} tool
 * @property {Record<string, any>} input
 * @property {boolean} ok     false for PostToolUseFailure and PermissionDenied
 * @property {string} error   its error text, every line of it ('' when it succeeded)
 * @property {number} at      when it finished (ms): the hook's own time
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
 * @property {{ at: number, error: string }[]} failures  recent failures with an error that says something, in time order (rule 3)
 */

/**
 * @typedef {object} AgentLoops
 * @property {string} folder
 * @property {Map<string, Step>} steps  least recently run first
 * @property {Stuck|null} stuck
 * @property {number} changedAt  the latest change that counted for it (hook time): calls made before count for rule 3 only
 */

/** Rule 1: the same step failed this many times with nothing changed. */
const SAME_FAILURES = 3;
/** Rule 2: the identical step ran this many times with nothing changed. */
const SAME_RUNS = 5;
/** Rule 3: the same step failed this many times with the same error… */
const SAME_ERRORS = 6;
/** …within this window, changes or not. */
const SAME_ERRORS_MS = 20 * 60_000;
/** Agents remembered at once; the one quiet the longest is forgotten first. */
export const MAX_AGENTS = 200;
/** Steps remembered per agent; one that never failed goes first, else the one run the longest ago. */
export const MAX_STEPS = 64;
/** Failures remembered per step, for rule 3: room for a few other errors among six alike. */
const MAX_FAILURES = 12;
/** A step key is cut here: the rest of a long input says nothing more about repeating it. */
export const MAX_KEY_CHARS = 300;
/** The step's words in the alert, short enough for the whole alert to fit on a crew row. */
const LABEL_CHARS = 36;
/** An error line is compared up to here… */
const ERROR_CHARS = 200;
/** …without the times in it, which differ from run to run: `✖ login (1.2ms)`. */
const DURATION = /\s*\(?\b\d+(?:\.\d+)?\s?m?s\b\)?/g;

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
/** A whole command that waits: a loop around `sleep` (`until curl -sf …; do sleep 1; done`). */
const SLEEP_LOOP = /\b(?:while|until|for)\b.*\bsleep\b/;
const LOCALHOST = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/;
/**
 * Parts of a command (between `&&`, `||` and `;`) that wait or poll by nature: sleeping, watching,
 * CI and deployment checks, health checks, looking at logs and processes, a background task's
 * output. A command is a wait only when every part waits (or is a `cd` or an `echo`): `sleep 5 &&
 * npm test` is the test run.
 */
const WAITS = Object.freeze([
  /^(?:sleep|start-sleep|get-job|wait-job|receive-job)\b/i,
  /^watch\s/,
  /^gh\s+(?:run\s+(?:watch|view|list)|pr\s+(?:checks|status)|workflow\s+view)\b/,
  /^gh\s+pr\s+view\b.*\bstatusCheckRollup\b/,
  /^gh\s+api\b.*\/(?:actions\/runs|check-runs|check-suites|status(?:es)?)\b/,
  /^glab\s+(?:ci|pipeline)\s+(?:status|view|list|trace)\b/,
  /^kubectl\s+(?:rollout\s+status|wait|get\s+(?:pods?|po))\b/,
  /^docker(?:\s+compose|-compose)?\s+ps\b/,
  /^(?:ps|pgrep)\b/,
  /^lsof\b.*\s-i/,
  /^tail\b.*\.log\b/,
  /^curl\b.*\/health/,
  new RegExp(`^curl\\b(?=.*\\s(?:-[a-zA-Z]*f[a-zA-Z]*|--fail)(?:\\s|$)).*${LOCALHOST.source}`),
  new RegExp(`^wget\\b.*${LOCALHOST.source}`),
  /\\tasks\\[\w.-]+\.output\b/,
  TASK_OUTPUT,
]);
/** Parts that neither wait nor work. */
const NEUTRAL = /^(?:cd|echo|printf|true|date)\b/;
const COMMAND_SEPARATORS = /\s*(?:&&|\|\||;)\s*/;

/** The name of a command, after an opening quote or parenthesis (`(cd a && rm b)`, `sh -c 'mv a b'`). */
const STARTS = String.raw`(?:^|[\s;&|(]|-l?c\s+['"])`;
/**
 * Shell commands that change files, judged by the command (what it did cannot be seen): in-place
 * edits, formatters and fixers, scripts that format, fix or generate, the project's own scripts,
 * git commands that rewrite the work tree or the index, patches, package installs, and moving,
 * copying, creating or removing files. Output written to a file is judged apart (writesFile).
 */
const CHANGING_COMMANDS = Object.freeze([
  /\b(?:sed|perl)\s+(?:[^|;&]*\s)?-[a-zA-Z]*i/,
  /\bsed\s+(?:[^|;&]*\s)?--in-place\b/,
  /\s--(?:write|fix)(?![\w-])/,
  /\b(?:ruff\s+format|black|cargo\s+fmt|go\s+fmt|gofmt\s+-w)\b/,
  new RegExp(`${STARTS}(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?(?:(?:[\\w.-]+[:_-])?(?:format|fix|codegen|generate)(?:[:_-][\\w.:-]*)?|build:types)(?=[\\s;&|)'"]|$)`),
  new RegExp(`${STARTS}(?:node|python[\\d.]*)\\s+(?:\\./)?scripts/`),
  /\bgit\s+(?:-[cC]\s+\S+\s+)*(?:checkout|switch|restore|reset|stash(?!\s+(?:list|show)\b)|apply|am|merge|rebase|pull|cherry-pick|revert|commit)\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci|remove|uninstall|rm)\b|\b(?:pip3?|uv\s+pip)\s+install\b|\buv\s+(?:sync|add)\b|\bpoetry\s+(?:install|add)\b|\bcargo\s+add\b|\bgo\s+get\b|\bbundle\s+install\b/,
  new RegExp(`${STARTS}(?:patch|rm|mv|cp|mkdir|touch)\\s`),
]);
/** `> file`, `>> file`, `2> file`, `&> file`; not `2>&1`, `>&2`, `=>` or `->`. */
const REDIRECT = /(?<![=<>-])[\d&]?>>?\s*([^\s;&|<>()]+)/g;
const TEE = /(?:^|[\s|])tee\s+(?:(?:-[ai]|--append)\s+)*([^\s;&|<>()]+)/g;
/** Where output may go without changing the project: logs and temporary files. */
const SCRATCH = /^(?:\/dev\/|\/tmp\/|\/private\/tmp\/|\$\{?TMPDIR\b)|\.(?:log|out)$/i;
/** A script handed to an interpreter on the command line: a here-document, `-c` or `-e`… */
const INLINE_SCRIPT = /\b(?:python[\d.]*|node|ruby|perl|bash|sh|zsh)\s+(?:[^|;&]*\s)?(?:<<|-[ce]\s)/;
/** …that opens a file for writing, or writes one. */
const SCRIPT_WRITES = /\bopen\([^)]*,\s*(?:mode\s*=\s*)?['"][wax]b?\+?['"]|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|write_text|write_bytes)\b/;
/** `-w` writes for gofmt, prettier and the like; for these it reads (words, a format, whitespace). */
const WRITE_FLAG = /\s-w(?=\s|$)/;
const READING_W = /^(?:grep|egrep|fgrep|rg|curl|wc|diff|git)$/;

/** `bash -lc '…'`, `sh -c "…"`, `zsh -c …`: a command handed to a shell (Codex sends every command this way). */
const SHELL_WRAPPER = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+/;
const LEADING_CD = /^cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/;
/** A pause before the step: `sleep 2 && npm test` is `npm test`. */
const LEADING_SLEEP = /^(?:sleep|start-sleep)\s[^;&|]*?(?:&&|;)\s*/i;
const TRAILING_REDIRECT = /\s*2>&1$/;
/** A single pipe at the end into tail, head or grep (`|| true` stays). */
const TRAILING_PIPE = /\s*(?<!\|)\|(?!\|)\s*(tail|head|grep)\b(?:'[^']*'|"[^"]*"|[^|'"])*$/;
/** A test or build run, whose output a trailing grep only filters: `npm test | grep FAIL` is `npm test`. */
const TEST_OR_BUILD =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck)(?![\w-])|jest|vitest|mocha|pytest|tox|tsc|node\s+--test|deno\s+test|cargo\s+(?:test|build|check|clippy)|go\s+(?:test|build|vet)|make|gradlew?|mvn|dotnet\s+(?:test|build)|rspec|phpunit)\b/;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:\/)/;

/**
 * Lines of a failure that say nothing about it in particular, so rule 3 looks past them: Claude
 * Code's `Exit code 1`, the command echoed back, npm's, pnpm's, yarn's and make's lines about a
 * script failing, CI's, rules and banners, passing tests and a test runner's headers.
 */
const GENERIC_LINES = Object.freeze([
  /^(?:exit code -?\d+|exit status \d+|error:?|failed\.?|(?:error:? )?command failed(?: with exit code \d+)?\.?)$/i,
  /^[>$+] /,
  /^npm (?:ERR!|error)(?:$| (?:code (?:ELIFECYCLE|\d+)$|errno |path |workspace |location |command |in workspace|at location|lifecycle script|failed at the|exit status|this is probably not|a complete log|(?:error: )?command failed|[/~]|[a-z]:\\|\S+@\S+ [\w:.-]+: ))/i,
  /^(?:ELIFECYCLE |ERR_PNPM_\w+ |error command failed with exit code |info visit https:\/\/yarnpkg\.com|(?:error: )?process completed with exit code |make(?:\[\d+\])?: \*\*\* )/i,
  /^(?:[-=_*#~.]{3,}.*[-=_*#~.]{3,}|[-=_*#~.\s]+)$/,
  /^(?:✔|✓|√|▶|ok \d|PASS |TAP version|RUN v\d|platform \S+ -- Python|rootdir:|configfile:|cachedir:|plugins:|collect(?:ed|ing) \d+ items?)/,
]);

/** @type {Readonly<Record<1|2|3, (n: number) => string>>} */
const WORDS = Object.freeze({
  1: (n) => `failed ${n} times, nothing changed`,
  2: (n) => `ran ${n} times, nothing changed`,
  3: (n) => `failed ${n} times with the same error`,
});

/**
 * What an alert is about in words that name no step, for notes that may show on a locked screen:
 * rule 2's step need not fail.
 * @param {1|2|3} rule
 */
export function stuckWords(rule) {
  return rule === 2 ? 'it keeps repeating the same step' : 'the same step keeps failing';
}

/**
 * A shell command as the step it repeats: unwrapped from `bash -lc '…'`, whitespace collapsed,
 * without a pause before it or trailing output plumbing, and without a leading `cd` into the
 * folder it runs in. A `cd` elsewhere stays: `cd packages/a && npm test` is a step of its own.
 * @param {unknown} command  a string, or a list of arguments (Codex)
 * @param {string} [folder]  the folder it runs in
 */
export function coreCommand(command, folder = '') {
  const home = folderOf(folder);
  const { dir, core } = parseCommand(command, home);
  return dir === home ? core : `cd ${relativePath(dir, home)} && ${core}`;
}

/**
 * What makes two calls the same step: the command and the folder it ran in (after its `cd`s), the
 * tool and its file, the search, or else the whole input (keys in any order), cut at MAX_KEY_CHARS.
 * @param {string} tool
 * @param {unknown} input
 * @param {string} [folder]  the folder it was run from
 */
export function stepKey(tool, input, folder = '') {
  const args = isObject(input) ? input : {};
  if (SHELL_TOOLS.has(tool)) {
    const { dir, core } = parseCommand(args.command, folderOf(folder));
    return clip(`${tool}\n${dir}\n${core}`, MAX_KEY_CHARS);
  }
  if (tool === 'Read') return clip(`${tool}\n${pathOf(args)}\n${str(args.offset)}\n${str(args.limit)}`, MAX_KEY_CHARS);
  if (FILE_TOOLS.has(tool)) return clip(`${tool}\n${pathOf(args)}`, MAX_KEY_CHARS);
  if (SEARCH_TOOLS.has(tool)) return clip(`${tool}\n${str(args.pattern)}\n${pathOf(args)}`, MAX_KEY_CHARS);
  return clip(`${tool}\n${sortedJson(args)}`, MAX_KEY_CHARS);
}

/**
 * Whether a shell command changes files, judged by what it says: see CHANGING_COMMANDS, output
 * written to a file that is not a log or a temporary one, a script given inline that writes, and
 * a `-w` flag.
 * @param {unknown} command
 */
export function changesFiles(command) {
  const text = commandText(command);
  if (CHANGING_COMMANDS.some((pattern) => pattern.test(text)) || writesFile(text)) return true;
  if (INLINE_SCRIPT.test(text) && SCRIPT_WRITES.test(text)) return true;
  return text.split(COMMAND_SEPARATORS).some((part) => WRITE_FLAG.test(part) && !READING_W.test(programOf(part)));
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
  const text = withoutPlumbing(commandText(args.command));
  if (SLEEP_LOOP.test(text)) return true;
  const parts = text.split(COMMAND_SEPARATORS).filter(Boolean);
  const waits = parts.filter((part) => WAITS.some((pattern) => pattern.test(part)));
  return waits.length > 0 && parts.every((part) => waits.includes(part) || NEUTRAL.test(part));
}

/**
 * The line of a failure that rule 3 compares: the first that says something about it (see
 * GENERIC_LINES; a line that only repeats the command says nothing either), without its times, or
 * '' when none does.
 * @param {unknown} error  the failure's text
 * @param {unknown} [command]  the command that failed, for a shell tool
 */
export function errorSignature(error, command) {
  const echoes = new Set([commandText(command), coreCommand(command)]);
  for (const raw of str(error).split('\n')) {
    const line = oneLine(raw);
    if (line && !echoes.has(line) && !GENERIC_LINES.some((pattern) => pattern.test(line))) return clip(line.replace(DURATION, ''), ERROR_CHARS);
  }
  return '';
}

/**
 * A command on one line, unwrapped from a shell it was handed to (one level). A list of
 * arguments (Codex) is joined as a shell would need it first.
 * @param {unknown} command
 */
function commandText(command) {
  const text = oneLine(Array.isArray(command) ? shellWords(command) : command);
  const wrapper = SHELL_WRAPPER.exec(text);
  const script = wrapper ? unquoted(text.slice(wrapper[0].length)) : null;
  return script === null ? text : oneLine(script);
}

/**
 * One shell word without its quotes, or null when the text is more than one word.
 * @param {string} word
 * @returns {string|null}
 */
function unquoted(word) {
  if (/^'(?:[^']|'\\'')*'$/.test(word)) return word.slice(1, -1).replaceAll(`'\\''`, "'");
  if (/^"(?:[^"\\]|\\.)*"$/.test(word)) return word.slice(1, -1).replace(/\\(.)/g, '$1');
  return /^[^\s'"]+$/.test(word) ? word : null;
}

/**
 * A shell command split into where it runs and what it runs: `dir` is the folder its leading `cd`s
 * lead to from `folder`, `core` the rest, without a pause before it or the output plumbing after it.
 * @param {unknown} command
 * @param {string} folder  as folderOf has it
 */
function parseCommand(command, folder) {
  let text = commandText(command);
  let dir = folder;
  for (let lead = leadOf(text); lead; lead = leadOf(text)) {
    if (lead[1] !== undefined) dir = resolveDir(unquoted(lead[1]) ?? lead[1], dir);
    text = text.slice(lead[0].length);
  }
  return { dir, core: withoutPlumbing(text) };
}

/** A leading `cd <dir> &&` (its dir captured) or `sleep N &&`. @param {string} text */
function leadOf(text) {
  return LEADING_CD.exec(text) ?? LEADING_SLEEP.exec(text);
}

/**
 * A command without its trailing `2>&1` and a single pipe into tail or head, or into grep after a
 * test or build run (else grep's pattern is part of the step: `git log | grep fix` is not
 * `git log | grep feat`).
 * @param {string} command
 */
function withoutPlumbing(command) {
  let text = command;
  for (let before = ''; before !== text; ) {
    before = text;
    text = text.replace(TRAILING_REDIRECT, '');
    const pipe = TRAILING_PIPE.exec(text);
    if (pipe && (pipe[1] !== 'grep' || TEST_OR_BUILD.test(text.slice(0, pipe.index)))) text = text.slice(0, pipe.index);
    text = text.trim();
  }
  return text;
}

/**
 * Where `cd <dir>` leads from `base`. A path that cannot be worked out here (`~`, `$VAR`) is kept
 * as written.
 * @param {string} dir
 * @param {string} base
 */
function resolveDir(dir, base) {
  const path = dir.replace(/\\/g, '/');
  if (path === '.' || path === '') return base;
  if (ABSOLUTE_PATH.test(path) || /^[~$]/.test(path) || !base) return folderOf(normalized(path));
  return folderOf(normalized(`${base}/${path}`));
}

/** A path without `.` and `..` segments. @param {string} path */
function normalized(path) {
  /** @type {string[]} */
  const parts = [];
  for (const [i, part] of path.split('/').entries()) {
    if (part === '.' || (part === '' && i > 0)) continue;
    if (part === '..' && parts.length > 0 && !['', '..'].includes(parts[parts.length - 1])) parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * Whether a command writes its output, or a here-document, to a file that is not a log or a
 * temporary file: `> src/a.ts`, `>> notes.md`, `| tee -a out.txt`.
 * @param {string} text
 */
function writesFile(text) {
  return [...text.matchAll(REDIRECT), ...text.matchAll(TEE)]
    .map((match) => match[1].replace(/^['"]+|['"]+$/g, ''))
    .some((path) => path !== '' && !SCRATCH.test(path));
}

/** The program a part of a command runs: `sh -c 'grep -w x'` is grep. @param {string} part */
function programOf(part) {
  const word = part.replace(/^[('"]+/, '').split(' ')[0] ?? '';
  return word.slice(word.lastIndexOf('/') + 1);
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
      const key = stepKey(call.tool, call.input, memory.folder);
      if (change) {
        succeeded(memory.steps.get(key));
        return [...forgotten, ...progress(agents, call)];
      }
      // Made before a change already seen (it arrived late): only rule 3 holds whatever changed.
      const late = call.at < memory.changedAt;
      if (call.ok && !late) succeeded(memory.steps.get(key));
      count(memory, key, call, late);
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
  const memory = agents.get(call.agent) ?? { folder: '', steps: new Map(), stuck: null, changedAt: -Infinity };
  agents.delete(call.agent);
  memory.folder = folderOf(call.folder);
  agents.set(call.agent, memory);
  /** @type {LoopChange[]} */
  const changes = [];
  for (const [agent, gone] of agents) {
    if (agents.size <= MAX_AGENTS) break;
    agents.delete(agent);
    if (gone.stuck) changes.push(ended(agent));
  }
  return changes;
}

/**
 * A change: the counts of rules 1 and 2 start again for the agent that made it and for every
 * agent in its tree, and their calls made before it that arrive later count for rule 3 only. Rule
 * 3 keeps its failures: it holds whether things changed or not.
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
    memory.changedAt = Math.max(memory.changedAt, call.at);
    for (const step of memory.steps.values()) {
      step.fails = 0;
      step.runs = 0;
    }
    changes.push(...judge(agent, memory, call.at));
  }
  return changes;
}

/**
 * Counts a run of a step that changed nothing, keeping at most MAX_STEPS steps. A run made before
 * the agent's latest change (`late`) counts for rule 3 only.
 * @param {AgentLoops} memory
 * @param {string} key
 * @param {LoopCall} call
 * @param {boolean} late
 */
function count(memory, key, call, late) {
  const step = memory.steps.get(key) ?? { label: stepLabel(call, memory.folder), fails: 0, runs: 0, failures: [] };
  memory.steps.delete(key);
  memory.steps.set(key, step);
  forgetStep(memory.steps, key);
  if (!late) step.runs += 1;
  if (call.ok) return;
  if (!late) step.fails += 1;
  const error = errorSignature(call.error, call.input.command);
  if (error) step.failures = recentFailures([...step.failures, { at: call.at, error }]);
}

/**
 * Past MAX_STEPS, forgets the step run the longest ago that has no failures, or else the one run
 * the longest ago; never `keep`, the step just run. A step failing between many others is what
 * rule 1 is for.
 * @param {Map<string, Step>} steps
 * @param {string} keep
 */
function forgetStep(steps, keep) {
  if (steps.size <= MAX_STEPS) return;
  let oldest = null;
  for (const [key, step] of steps) {
    if (key === keep) continue;
    if (step.fails === 0 && step.failures.length === 0) {
      steps.delete(key);
      return;
    }
    oldest ??= key;
  }
  if (oldest !== null) steps.delete(oldest);
}

/**
 * Rule 3's failures in time order: those within SAME_ERRORS_MS of the newest, the last MAX_FAILURES.
 * @param {{ at: number, error: string }[]} failures
 */
function recentFailures(failures) {
  const sorted = failures.sort((a, b) => a.at - b.at);
  const newest = sorted[sorted.length - 1]?.at ?? 0;
  return sorted.filter((failure) => newest - failure.at <= SAME_ERRORS_MS).slice(-MAX_FAILURES);
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
 * How many of the step's recent failures had the newest one's error. `recentFailures` keeps only
 * those within SAME_ERRORS_MS of the newest.
 * @param {{ at: number, error: string }[]} failures
 */
function sameErrors(failures) {
  const newest = failures[failures.length - 1];
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
 * @param {string} folder
 */
function stepLabel(call, folder) {
  const { tool, input } = call;
  if (SHELL_TOOLS.has(tool)) return clip(coreCommand(input.command, folder), LABEL_CHARS) || tool;
  const path = pathOf(input);
  if (path && FILE_TOOLS.has(tool)) return `${tool} ${shortPath(path, call.folder, Math.max(12, LABEL_CHARS - tool.length - 1))}`;
  if (SEARCH_TOOLS.has(tool)) return clip(`${tool} ${oneLine(input.pattern)}`, LABEL_CHARS);
  return clip(tool, LABEL_CHARS);
}
