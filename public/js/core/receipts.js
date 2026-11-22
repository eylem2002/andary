// Turn receipts (CONTRACTS §5.1): when a lead's turn ends, what the turn did, as far as the hooks
// prove it. The files its crew changed (with lines added and removed where the town has the
// edit's text), the last test run and the last build with what their exit status proves
// (core/shell.js reads the command line, as for the catch-up), whether a test ran after the last
// edit, the calls that failed, the helpers it used, how long it took and, from Claude Code's
// transcripts, what it cost (an estimate). Pure: the store feeds it the events it applied.
//
// A turn starts at your prompt; one the town joined midway starts at its first event and says so
// (`sawStart: false`), and has no cost: what it cost before the town looked is unknown. A Stop
// hook that kept the turn going (`stop_hook_active`) ends the same turn again: its receipt is
// updated. Helpers' events count for their lead's turn; agent-team teammates have turns of their
// own and are left out.
import { changeHunks } from './changes.js';
import { errorSignature } from './loops.js';
import { isBuildRun, isTestRun, runsNoTests, shellCommands } from './shell.js';
import { clip, oneLine, relativePath, str } from './text.js';

/** @typedef {import('./events.js').TownEvent} TownEvent */

/**
 * @typedef {object} ReceiptFile
 * @property {string} path      relative to the crew's folder where possible
 * @property {number} added     lines added, as far as the town has the text
 * @property {number|null} removed  null when a whole file was written over: what it held is unknown
 * @property {boolean} approx   an edit's text was cut (longer than the town keeps): the counts are at least these
 * @property {boolean} deleted  a Codex patch deleted it
 * @property {number} edits
 */

/**
 * @typedef {object} ReceiptRun  a test run or a build, and what its exit status proves
 * @property {'test'|'build'} kind
 * @property {string} command   as written, clipped
 * @property {number} at        when it started (its PreToolUse), else when it finished
 * @property {'passed'|'failed'|'unproven'|'started'|'interrupted'} result
 *   unproven: the line's exit status is another command's (`npm test | tail`), or Codex did not
 *   report it; started: sent to the background, its result comes through other tools
 * @property {string|null} why  a failure's first line, or why the result is not proven
 */

/**
 * @typedef {object} Receipt
 * @property {string} id
 * @property {string} sessionId
 * @property {string} agentKey     the lead's
 * @property {'claude'|'codex'} source
 * @property {number} start
 * @property {number} end
 * @property {boolean} sawStart    the town saw the prompt that started it
 * @property {'done'|'error'|'interrupted'} ended
 * @property {string} said         the turn's last message, one line, clipped
 * @property {ReceiptFile[]} files  most recently changed first, at most MAX_FILES
 * @property {number} moreFiles    changed files beyond those
 * @property {ReceiptRun|null} test   the last test run
 * @property {ReceiptRun|null} build  the last build
 * @property {number|null} lastEditAt
 * @property {boolean|null} testedAfterEdit  null when nothing was edited
 * @property {string|null} flag    what deserves a second look, in words
 * @property {number} failures     failed calls (not interrupts)
 * @property {string[]} failed     a few of them, in words
 * @property {string[]} helpers    names of the helpers that worked in it
 * @property {number|null} costUsd an estimate from the transcripts; null when unknown
 */

/** @typedef {Record<string, { costUsd: number, unpriced: boolean }>} Costs */
/** @typedef {{ name: string, role: 'lead'|'subagent'|'teammate' }} Who */

export const MAX_FILES = 12;
/** Receipts kept, the oldest go first. */
export const MAX_RECEIPTS = 60;
const MAX_FAILED_SHOWN = 3;
const MAX_HELPERS = 12;
const MAX_STARTS = 200;
const SAID_CHARS = 200;
const COMMAND_CHARS = 160;
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * @typedef {object} Turn
 * @property {string} id
 * @property {number} start
 * @property {boolean} sawStart
 * @property {Map<string, ReceiptFile>} files
 * @property {ReceiptRun|null} test
 * @property {ReceiptRun|null} build
 * @property {number|null} lastEditAt
 * @property {number} failures
 * @property {string[]} failed
 * @property {Set<string>} helpers
 * @property {Set<string>} agents   keys of everyone who worked in it
 * @property {Map<string, number>} starts  toolUseId → when its call started
 * @property {Record<string, number>|null} base  each agent's cost when it started; null: unknown
 * @property {Receipt|null} receipt
 * @property {Turn} [previous]  the turn that ended before it, when the town saw no prompt between
 */

export function createReceipts() {
  /** @type {Map<string, Turn>} sessionId → its lead's turn now (or the one that just ended) */
  const turns = new Map();
  /** @type {Set<string>} sessions the town saw start afresh, so nothing was spent before */
  const fresh = new Set();
  /** @type {Receipt[]} */
  const list = [];
  let seq = 0;

  /**
   * @param {string} sessionId @param {number} at @param {boolean} sawStart @param {Costs} costs
   * @returns {Turn}
   */
  function startTurn(sessionId, at, sawStart, costs) {
    seq += 1;
    const turn = { id: `r${seq}`, start: at, sawStart, files: new Map(), test: null, build: null, lastEditAt: null, failures: 0, failed: [], helpers: new Set(), agents: new Set(), starts: new Map(), base: sawStart ? baseOf(sessionId, costs) : null, receipt: null };
    turns.set(sessionId, turn);
    return turn;
  }

  /** What each agent of the crew had cost when the turn started. @param {string} sessionId @param {Costs} costs */
  function baseOf(sessionId, costs) {
    /** @type {Record<string, number>} */
    const base = {};
    for (const [key, usage] of Object.entries(costs)) if (key.startsWith(`${sessionId}:`)) base[key] = usage.costUsd;
    const lead = `${sessionId}:main`;
    if (!(lead in base) && fresh.has(sessionId)) base[lead] = 0;
    return lead in base ? base : null;
  }

  /**
   * Adds one applied event to its crew's turn; returns the receipt its end made or updated.
   * @param {TownEvent} e
   * @param {Who} who
   * @param {{ costs: Costs, cwd: string }} context
   * @returns {Receipt|null}
   */
  function record(e, who, { costs, cwd }) {
    if (e.kind === 'session.end') {
      turns.delete(e.sessionId);
      fresh.delete(e.sessionId);
      return null;
    }
    if (who.role === 'teammate') return null;
    if (e.kind === 'session.start') {
      if (e.data.source === 'startup' || e.data.source === 'clear') fresh.add(e.sessionId);
      return null;
    }
    const lead = who.role === 'lead';
    if (e.kind === 'prompt' && lead) {
      startTurn(e.sessionId, e.ts, true, costs).agents.add(e.agentKey);
      fresh.delete(e.sessionId);
      return null;
    }
    let turn = turns.get(e.sessionId);
    const ending = lead && (e.kind === 'turn.stop' || e.kind === 'turn.fail');
    // Work after a turn ended, with no prompt seen: a turn whose prompt the town missed, or the same
    // turn going on after a Stop hook (its next Stop says which).
    if (!turn || (turn.receipt && !ending && countsFor(e))) turn = continueAfter(e, turn, costs);
    if (!ending) {
      addWork(turn, e, who, cwd);
      return null;
    }
    turn.agents.add(e.agentKey);
    return endTurn(turn, e, costs);
  }

  /**
   * @param {TownEvent} e @param {Turn|undefined} ended @param {Costs} costs
   * @returns {Turn}
   */
  function continueAfter(e, ended, costs) {
    const turn = startTurn(e.sessionId, e.ts, false, costs);
    if (ended) turn.previous = ended;
    return turn;
  }

  /**
   * @param {Turn} turn @param {TownEvent} e @param {Costs} costs
   * @returns {Receipt}
   */
  function endTurn(turn, e, costs) {
    let current = turn;
    // A Stop hook kept the turn going: what came since belongs to the turn that ended before.
    if (e.data.stopHookActive === true && turn.previous?.receipt) {
      current = mergeInto(turn.previous, turn);
      turns.set(e.sessionId, current);
    }
    const receipt = receiptOf(current, e, costs);
    if (current.receipt) list.splice(list.indexOf(current.receipt), 1, receipt);
    else {
      list.push(receipt);
      if (list.length > MAX_RECEIPTS) list.shift();
    }
    current.receipt = receipt;
    return receipt;
  }

  /**
   * @param {Turn} turn @param {TownEvent} e @param {Costs} costs
   * @returns {Receipt}
   */
  function receiptOf(turn, e, costs) {
    const files = [...turn.files.values()].reverse();
    const ended = e.kind === 'turn.fail' ? 'error' : e.data.interrupted === true ? 'interrupted' : 'done';
    const testedAfterEdit = turn.lastEditAt === null ? null : Boolean(turn.test && turn.test.at >= turn.lastEditAt);
    /** @type {Omit<Receipt, 'flag'>} */
    const base = {
      id: turn.id,
      sessionId: e.sessionId,
      agentKey: e.agentKey,
      source: e.source === 'codex' ? 'codex' : 'claude',
      start: turn.start,
      end: Math.max(turn.start, e.ts),
      sawStart: turn.sawStart,
      ended,
      said: clip(oneLine(e.data.lastMessage), SAID_CHARS),
      files: files.slice(0, MAX_FILES),
      moreFiles: Math.max(0, files.length - MAX_FILES),
      test: turn.test,
      build: turn.build,
      lastEditAt: turn.lastEditAt,
      testedAfterEdit,
      failures: turn.failures,
      failed: [...turn.failed],
      helpers: [...turn.helpers],
      costUsd: costOf(turn, costs),
    };
    return { ...base, flag: flagOf(base) };
  }

  return {
    record,
    /**
     * New usage came for a crew: the receipt of the turn that ended last gets its cost, until
     * the next prompt starts another turn. Returns that receipt when its cost changed.
     * @param {string} sessionId @param {Costs} costs
     * @returns {Receipt|null}
     */
    priced(sessionId, costs) {
      const turn = turns.get(sessionId);
      const receipt = turn?.receipt;
      if (!turn || !receipt) return null;
      const costUsd = costOf(turn, costs);
      if (costUsd === receipt.costUsd) return null;
      const next = { ...receipt, costUsd };
      list.splice(list.indexOf(receipt), 1, next);
      turn.receipt = next;
      return next;
    },
    /** Receipts, newest last. @returns {readonly Receipt[]} */
    list: () => list,
  };
}

/** @typedef {ReturnType<typeof createReceipts>} Receipts */

/** Events that are work of the turn (not merely a notice or a model switch). @param {TownEvent} e */
function countsFor(e) {
  return e.kind === 'tool.start' || e.kind === 'tool.end' || e.kind === 'tool.fail' || e.kind === 'subagent.start';
}

/**
 * @param {Turn} turn @param {TownEvent} e @param {Who} who @param {string} cwd
 */
function addWork(turn, e, who, cwd) {
  turn.agents.add(e.agentKey);
  if (who.role === 'subagent') {
    if (turn.helpers.size < MAX_HELPERS) turn.helpers.add(who.name);
    // A helper that started in this turn had spent nothing before it.
    if (turn.base && e.kind === 'subagent.start' && !(e.agentKey in turn.base)) turn.base[e.agentKey] = 0;
  }
  const d = e.data;
  if (e.kind === 'tool.start' && d.toolUseId) {
    turn.starts.set(d.toolUseId, e.ts);
    if (turn.starts.size > MAX_STARTS) turn.starts.delete(/** @type {string} */ (turn.starts.keys().next().value));
  }
  if (e.kind === 'tool.end') {
    if (FILE_TOOLS.has(d.tool) || (d.tool === 'apply_patch' && d.file)) changedFile(turn, e, cwd);
    else if (SHELL_TOOLS.has(d.tool)) ran(turn, e);
  }
  if (e.kind === 'tool.fail') {
    if (d.isInterrupt !== true) {
      turn.failures += 1;
      if (turn.failed.length < MAX_FAILED_SHOWN) turn.failed.push(clip(`${d.summary}: ${failureLine(d)}`, 160));
    }
    if (SHELL_TOOLS.has(d.tool)) ran(turn, e);
  }
}

/** A failure's line that says something (as the stuck rules read it), else its first. @param {Record<string, any>} d */
function failureLine(d) {
  return errorSignature(str(d.errorText) || str(d.error), d.input?.command) || oneLine(d.error);
}

/** @param {Turn} turn @param {TownEvent} e @param {string} cwd */
function changedFile(turn, e, cwd) {
  const d = e.data;
  const path = relativePath(str(d.file), e.cwd || cwd);
  if (!path) return;
  const file = turn.files.get(path) ?? { path, added: 0, removed: 0, approx: false, deleted: false, edits: 0 };
  turn.files.delete(path);
  turn.files.set(path, file);
  file.edits += 1;
  turn.lastEditAt = Math.max(turn.lastEditAt ?? 0, e.ts);
  if (d.tool === 'apply_patch') {
    file.deleted = true;
    return;
  }
  const hunks = changeHunks(d.tool, d.input ?? {});
  if (!hunks) return;
  const created = d.tool === 'Write' && (d.response?.type === 'create' || d.sourceTool === 'apply_patch');
  for (const hunk of hunks.list) {
    const delta = lineDelta(hunk.before, hunk.after);
    file.added += delta.added;
    if (file.removed !== null) file.removed += delta.removed;
    if (hunk.cut) file.approx = true;
  }
  // A whole file written over something the hook does not show: what was removed is unknown.
  if (hunks.whole && !created) file.removed = null;
}

/**
 * Lines added and removed by replacing `before` with `after`: what is left once the lines both
 * start and end with are set aside (an Edit's old and new text usually share a few).
 * @param {string} before @param {string} after
 */
export function lineDelta(before, after) {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  return { added: b.length - head - tail, removed: a.length - head - tail };
}

/**
 * A shell call that ran tests or a build (or both): what its exit status proves of each
 * (core/shell.js), as the catch-up reads it. A Codex command proves it succeeded only with its
 * exit code.
 * @param {Turn} turn @param {TownEvent} e
 */
function ran(turn, e) {
  const d = e.data;
  const commands = shellCommands(d.input?.command, { powershell: d.tool === 'PowerShell' });
  const runs = {
    test: commands.filter((c) => isTestRun(c.words) && !runsNoTests(c.words)),
    build: commands.filter((c) => isBuildRun(c.words)),
  };
  const at = (d.toolUseId && turn.starts.get(d.toolUseId)) || e.ts;
  for (const kind of /** @type {const} */ (['test', 'build'])) {
    if (!runs[kind].length) continue;
    const last = turn[kind];
    if (!last || at >= last.at) turn[kind] = { kind, command: clip(oneLine(d.input?.command), COMMAND_CHARS), at, ...resultOf(e, runs[kind]) };
  }
}

/**
 * @param {TownEvent} e @param {import('./shell.js').ShellCommand[]} relevant
 * @returns {Pick<ReceiptRun, 'result'|'why'>}
 */
function resultOf(e, relevant) {
  const d = e.data;
  if (d.input?.run_in_background === true) return { result: 'started', why: 'it runs in the background' };
  if (e.kind === 'tool.fail') {
    if (d.isInterrupt === true) return { result: 'interrupted', why: null };
    if (relevant.some((c) => c.decides)) return { result: 'failed', why: clip(failureLine(d), 160) || null };
    return { result: 'unproven', why: 'the line failed, maybe not here' };
  }
  if (e.source === 'codex' && d.exitKnown !== true) return { result: 'unproven', why: 'Codex did not report the exit code' };
  if (relevant.every((c) => c.succeeded)) return { result: 'passed', why: null };
  return { result: 'unproven', why: 'the exit status shown is another command\'s' };
}

/**
 * What the turn's crew spent since it started, from the usage the town has: null when it cannot
 * be told (a Codex crew, a turn the town joined midway, an agent whose earlier cost is unknown, a
 * model without a price), or when nothing was counted yet.
 * @param {Turn} turn @param {Costs} costs
 */
function costOf(turn, costs) {
  if (!turn.base) return null;
  let total = 0;
  for (const key of turn.agents) {
    const now = costs[key];
    if (!now) continue;
    if (now.unpriced) return null;
    const before = turn.base[key];
    if (before === undefined) return null;
    total += Math.max(0, now.costUsd - before);
  }
  return total > 0 ? total : null;
}

/**
 * The later part of a turn, joined to the part a Stop hook had ended.
 * @param {Turn} into @param {Turn} later
 */
function mergeInto(into, later) {
  for (const [path, file] of later.files) {
    const kept = into.files.get(path);
    into.files.delete(path);
    into.files.set(path, kept ? mergeFiles(kept, file) : file);
  }
  for (const kind of /** @type {const} */ (['test', 'build'])) {
    const run = later[kind];
    if (run && (!into[kind] || run.at >= /** @type {ReceiptRun} */ (into[kind]).at)) into[kind] = run;
  }
  if (later.lastEditAt !== null) into.lastEditAt = Math.max(into.lastEditAt ?? 0, later.lastEditAt);
  into.failures += later.failures;
  into.failed = [...into.failed, ...later.failed].slice(0, MAX_FAILED_SHOWN);
  for (const name of later.helpers) if (into.helpers.size < MAX_HELPERS) into.helpers.add(name);
  for (const key of later.agents) into.agents.add(key);
  if (into.base && later.base) for (const [key, cost] of Object.entries(later.base)) if (!(key in into.base)) into.base[key] = cost;
  return into;
}

/** @param {ReceiptFile} a @param {ReceiptFile} b @returns {ReceiptFile} */
function mergeFiles(a, b) {
  return {
    path: a.path,
    added: a.added + b.added,
    removed: a.removed === null || b.removed === null ? null : a.removed + b.removed,
    approx: a.approx || b.approx,
    deleted: b.deleted,
    edits: a.edits + b.edits,
  };
}

/**
 * What deserves a second look: files changed and no test run after the last of them, or a test
 * after them that failed or proves nothing. A turn that ended saying it was done says so.
 * @param {Omit<Receipt, 'flag'>} r
 * @returns {string|null}
 */
export function flagOf(r) {
  if (r.testedAfterEdit === null) return null;
  const said = r.ended === 'done' ? 'Said done, but ' : '';
  const lower = (/** @type {string} */ text) => (said ? text.charAt(0).toLowerCase() + text.slice(1) : text);
  if (!r.test) return `${said}${lower('No test ran this turn after the edits')}`;
  if (!r.testedAfterEdit) return `${said}${lower('Tests were not re-run since the last edit')}`;
  if (r.test.result === 'failed') return `${said}${lower('The last test run after the edits failed')}`;
  if (r.test.result !== 'passed') return `The test run after the last edit proves nothing: ${RESULT_WORDS[r.test.result]}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Words, shared by the activity log and the agent's details.

const RESULT_WORDS = Object.freeze({
  passed: 'passed',
  failed: 'failed',
  unproven: 'result not proven',
  started: 'started in the background, result not seen',
  interrupted: 'interrupted',
});

/** "4m 10s", "1h 05m", "35s". @param {number} ms */
export function durationWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** "+12 −3", "+40 (written whole)", "deleted". @param {ReceiptFile} f */
export function fileLines(f) {
  if (f.deleted) return 'deleted';
  const at = f.approx ? '≥' : '';
  return f.removed === null ? `${at}+${f.added}, written whole` : `${at}+${f.added} −${f.removed}`;
}

/** "npm test passed", "npm test | tail: result not proven (…)". @param {ReceiptRun} run */
export function runWords(run) {
  const why = run.why && run.result !== 'started' ? ` (${run.why})` : '';
  return `${run.command}: ${RESULT_WORDS[run.result]}${why}`;
}

/** What every changed file adds up to. @param {Receipt} r */
function filesTotal(r) {
  const count = r.files.length + r.moreFiles;
  if (!count) return 'no files changed';
  const added = r.files.reduce((n, f) => n + f.added, 0);
  const known = r.files.every((f) => f.removed !== null);
  const removed = r.files.reduce((n, f) => n + (f.removed ?? 0), 0);
  const lines = r.moreFiles ? '' : known ? ` (+${added} −${removed})` : ` (+${added})`;
  return `${count} file${count === 1 ? '' : 's'} changed${lines}`;
}

/** "about $0.42 (estimate)". @param {number} usd */
export function costWords(usd) {
  return `${usd < 0.01 ? 'under $0.01' : `$${usd.toFixed(2)}`} (estimate)`;
}

/**
 * The receipt on one line, for the activity log.
 * @param {Receipt} r
 */
export function receiptLine(r) {
  const parts = [filesTotal(r)];
  if (r.test) parts.push(`tests ${RESULT_WORDS[r.test.result]}`);
  else if (r.build) parts.push(`build ${RESULT_WORDS[r.build.result]}`);
  if (r.failures) parts.push(`${r.failures} failed call${r.failures === 1 ? '' : 's'}`);
  if (r.helpers.length) parts.push(`${r.helpers.length} helper${r.helpers.length === 1 ? '' : 's'}`);
  parts.push(r.sawStart ? durationWords(r.end - r.start) : `at least ${durationWords(r.end - r.start)}`);
  const flag = r.flag ? `. ${r.flag}` : '';
  return `Turn receipt: ${parts.join(', ')}${flag}`;
}

/**
 * The receipt as labelled lines, for the agent's details.
 * @param {Receipt} r
 * @returns {{ label: string, text: string, tone: 'ok'|'warn'|'error'|null, mono?: boolean }[]}
 */
export function receiptRows(r) {
  /** @type {ReturnType<typeof receiptRows>} */
  const rows = [];
  const took = r.sawStart ? durationWords(r.end - r.start) : `at least ${durationWords(r.end - r.start)} (the town joined midway)`;
  rows.push({ label: 'Took', text: r.ended === 'done' ? took : `${took}, ${r.ended === 'error' ? 'stopped on an error' : 'interrupted'}`, tone: r.ended === 'done' ? null : 'warn' });
  rows.push({ label: 'Files', text: filesTotal(r), tone: null });
  if (r.test) rows.push({ label: 'Last test', text: runWords(r.test), tone: toneOf(r.test), mono: true });
  if (r.build) rows.push({ label: 'Last build', text: runWords(r.build), tone: toneOf(r.build), mono: true });
  if (r.flag) rows.push({ label: 'Check', text: r.flag, tone: 'warn' });
  if (r.failures) rows.push({ label: 'Failed', text: `${r.failures} call${r.failures === 1 ? '' : 's'}: ${r.failed.join('; ')}${r.failures > r.failed.length ? '; …' : ''}`, tone: 'error' });
  if (r.helpers.length) rows.push({ label: 'Helpers', text: r.helpers.join(', '), tone: null });
  if (r.costUsd !== null) rows.push({ label: 'Cost', text: costWords(r.costUsd), tone: null });
  return rows;
}

/** @param {ReceiptRun} run @returns {'ok'|'warn'|'error'} */
function toneOf(run) {
  return run.result === 'passed' ? 'ok' : run.result === 'failed' ? 'error' : 'warn';
}
