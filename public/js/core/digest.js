// What each of your crews did, for "Catch me up" (docs/design/agent-health.md §7): counters per
// crew in five-minute buckets for the last 24 hours, and the summary of any period that ends now.
// Pure and bounded. The server keeps one (server/digest.mjs), fed by this computer's hooks and the
// approval broker, so a summary survives a page reload and does not depend on the history kept for
// late tabs; the demo keeps its own (sources/demo.js), so the feature can be seen without Claude
// Code.
//
// What a hook counts for (tallyOf):
//   Stop                 a finished turn, with its last message (an interrupted turn is not one)
//   StopFailure          a turn stopped on an error, by its kind (rate_limit, overloaded, …)
//   PreToolUse           a tool call
//   PostToolUseFailure   a failed tool call, unless you interrupted it; a test command failing
//   PostToolUse          a file changed (Edit, MultiEdit, Write, NotebookEdit, a Codex patch that
//                        deletes one); a test command passing; a commit; a push
//   PermissionRequest    a permission asked for (a question or a plan to approve is not one)
//   SubagentStart, SubagentStop   a helper started, a helper finished
// A permission answered is read from the approval itself (answered()): allowed or denied in the
// town, or answered in the terminal.
import { INTERACTIVE_TOOLS, inputKey } from './dialogs.js';
import { isDoctorSession } from './ids.js';
import { classifyCommand, commandKinds } from './summaries.js';
import { clip, isObject, oneLine, own, str, textOf } from './text.js';

/** Counters are kept in buckets this long, so a summary may start up to one bucket early. */
export const BUCKET_MS = 5 * 60_000;
/** Buckets are kept for a day: the longest absence worth catching up on in one go. */
export const KEEP_MS = 24 * 60 * 60_000;
/** A day's buckets for one crew, and the one filling up. */
const MAX_BUCKETS = KEEP_MS / BUCKET_MS + 1;
/** Crews kept at once; the one quiet for longest gives way. */
const MAX_CREWS = 100;
/** Changed files remembered per crew; the one changed longest ago gives way. */
const MAX_FILES = 200;
/** A finished turn's last message: one line, at most this long. */
const MESSAGE_CHARS = 200;
/** A stop's kind comes from the hook (StopFailure's error code): at most this long. */
const KIND_CHARS = 40;
/** The town's crew for hooks without a session id (NO_SESSION in core/events.js). */
const NO_SESSION = 'unknown';
/** An approval settled by an answer, in the town or the terminal (an expiry is none). */
const ANSWERED = new Set(['allowed', 'denied', 'resolved']);

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Tools that change a file when they succeed: the town's diffs (core/changes.js), and a Codex patch that deletes one. */
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);

/** @typedef {'turns'|'failures'|'toolCalls'|'asked'|'answered'|'commits'|'pushes'|'helpersStarted'|'helpersFinished'} CountName */
/** @type {readonly CountName[]} */
const COUNT_NAMES = Object.freeze(['turns', 'failures', 'toolCalls', 'asked', 'answered', 'commits', 'pushes', 'helpersStarted', 'helpersFinished']);

/**
 * @typedef {object} Tally  what one hook adds to its crew's counts
 * @property {CountName} [count]  one more of these
 * @property {string} [message]   a finished turn's last message ('' when it had none)
 * @property {string} [stop]      a stopped turn's kind
 * @property {string} [file]      the file a tool changed
 * @property {boolean} [passed]   a test command's result
 * @property {boolean} [commit]
 * @property {boolean} [push]
 */

/**
 * @typedef {object} Counts  one crew's work in one bucket
 * @property {Record<CountName, number>} n
 * @property {Map<string, number>} stops  kind → how many
 * @property {{ text: string, at: number }|null} message  the latest finished turn's, when it said something
 * @property {{ passed: boolean, at: number }|null} test  the latest test command's result
 * @property {number} commitAt  the latest commit's time (0: none)
 * @property {number} pushAt    the latest push's time (0: none)
 */

/**
 * @typedef {object} Crew
 * @property {string} cwd           the folder its first hook named
 * @property {string|null} title
 * @property {number} lastAt        when its latest hook arrived
 * @property {Map<number, Counts>} buckets  by start time
 * @property {Map<string, number>} files    a key of each file's path → when it last changed, oldest first
 */

/**
 * What one crew did in a period (CONTRACTS §4.5, `{ t: 'digest' }`).
 * @typedef {object} CrewDigest
 * @property {string} sessionId
 * @property {string} cwd
 * @property {string|null} title
 * @property {number} lastAt          when its latest hook arrived
 * @property {number} turns           finished turns
 * @property {string|null} lastMessage  the latest finished turn's last message, one line, clipped
 * @property {Record<string, number>} stops  turns stopped on an error, by kind
 * @property {number} failures        failed tool calls
 * @property {'passed'|'failed'|null} tests  the latest test command's result
 * @property {number} commits
 * @property {number} pushes
 * @property {boolean} allPushed      a push came after the latest commit
 * @property {number} files           distinct files changed
 * @property {number} asked           permissions asked for
 * @property {number} answered        permissions answered
 * @property {number} helpersStarted
 * @property {number} helpersFinished
 * @property {number} toolCalls
 */

/**
 * @typedef {object} Digest
 * @property {number} since  the start of the first bucket counted: at most one bucket before the period asked for
 * @property {number} until  when it was made
 * @property {CrewDigest[]} crews  the crews that did something, the most recently active first
 */

/**
 * The shell command a hook ran to its end, or ''. One sent to the background has only started
 * when its hook comes: its result arrives later, through tools that do not name the command.
 * @param {Record<string, any>} event
 * @returns {string}
 */
function commandOf(event) {
  if (!SHELL_TOOLS.has(str(event.tool_name)) || !isObject(event.tool_input)) return '';
  return event.tool_input.run_in_background === true ? '' : str(event.tool_input.command);
}

/** A test run as the town reads one (its weather and records): by the command's strongest kind. @param {string} command */
const isTest = (command) => classifyCommand(command) === 'test';

/** @param {Record<string, any>} event @returns {string} the file a tool changed, or '' */
function changedFile(event) {
  if (!FILE_TOOLS.has(str(event.tool_name)) || !isObject(event.tool_input)) return '';
  return str(event.tool_input.file_path ?? event.tool_input.notebook_path).trim();
}

/**
 * A tool that ran: the file it changed, or what its shell command did. A test passing is read by
 * the command's strongest kind, as the town reads it ("npm test && git push" is a push), while a
 * commit and a push in one command both count.
 * @param {Record<string, any>} event
 * @returns {Tally|null}
 */
function ranTool(event) {
  const file = changedFile(event);
  if (file) return { file };
  const command = commandOf(event);
  const kinds = commandKinds(command);
  /** @type {Tally} */
  const tally = {};
  if (isTest(command)) tally.passed = true;
  if (kinds.includes('git-commit')) tally.commit = true;
  if (kinds.includes('git-push')) tally.push = true;
  return Object.keys(tally).length ? tally : null;
}

/** One more of something, and what else came with it. @param {CountName} name @param {Tally} [extra] @returns {Tally} */
const one = (name, extra = {}) => ({ ...extra, count: name });

/** @type {Readonly<Record<string, (event: Record<string, any>) => Tally|null>>} */
const TALLIES = Object.freeze({
  Stop: (e) => (e.stop_reason === 'interrupted' ? null : one('turns', { message: clip(oneLine(textOf(e.last_assistant_message)), MESSAGE_CHARS) })),
  StopFailure: (e) => ({ stop: clip(oneLine(e.error), KIND_CHARS) || 'unknown' }),
  PreToolUse: () => one('toolCalls'),
  // You interrupted it: nothing failed. A test command failing means the tests are red.
  PostToolUseFailure: (e) => (e.is_interrupt === true ? null : one('failures', isTest(commandOf(e)) ? { passed: false } : {})),
  PostToolUse: ranTool,
  // A question or a plan waits for you too, but it asks for an answer, not a permission.
  PermissionRequest: (e) => (Object.hasOwn(INTERACTIVE_TOOLS, str(e.tool_name)) ? null : one('asked')),
  SubagentStart: () => one('helpersStarted'),
  SubagentStop: () => one('helpersFinished'),
});

/**
 * What one hook adds to its crew's counts, or null when it counts for nothing.
 * @param {unknown} event  a town payload (CONTRACTS §4.2)
 * @returns {Tally|null}
 */
export function tallyOf(event) {
  if (!isObject(event)) return null;
  return own(TALLIES, event.hook_event_name)?.(event) ?? null;
}

/** @param {number} at */
const bucketStart = (at) => Math.floor(at / BUCKET_MS) * BUCKET_MS;

/** @returns {Counts} */
function emptyCounts() {
  const n = /** @type {Record<CountName, number>} */ (Object.fromEntries(COUNT_NAMES.map((name) => [name, 0])));
  return { n, stops: new Map(), message: null, test: null, commitAt: 0, pushAt: 0 };
}

/**
 * The later of two timed values.
 * @template {{ at: number }} T
 * @param {T|null} a @param {T|null} b
 */
const later = (a, b) => (!b || (a && a.at >= b.at) ? a : b);

/** @param {Counts} total @param {Counts} counts */
function merge(total, counts) {
  for (const name of COUNT_NAMES) total.n[name] += counts.n[name];
  for (const [kind, n] of counts.stops) total.stops.set(kind, (total.stops.get(kind) ?? 0) + n);
  total.message = later(total.message, counts.message);
  total.test = later(total.test, counts.test);
  total.commitAt = Math.max(total.commitAt, counts.commitAt);
  total.pushAt = Math.max(total.pushAt, counts.pushAt);
}

/** @param {Counts} total @param {number} files */
function didNothing(total, files) {
  return files === 0 && total.stops.size === 0 && total.test === null && COUNT_NAMES.every((name) => total.n[name] === 0);
}

/**
 * One crew's work in the buckets from `from` on, or null when it did nothing then.
 * @param {string} sessionId @param {Crew} crew @param {number} from  a bucket's start
 * @returns {CrewDigest|null}
 */
function crewDigest(sessionId, crew, from) {
  const total = emptyCounts();
  for (const [start, counts] of crew.buckets) if (start >= from) merge(total, counts);
  let files = 0;
  for (const changed of crew.files.values()) if (changed >= from) files += 1;
  if (didNothing(total, files)) return null;
  return {
    sessionId,
    cwd: crew.cwd,
    title: crew.title,
    lastAt: crew.lastAt,
    ...total.n,
    lastMessage: total.message?.text ?? null,
    stops: Object.fromEntries(total.stops),
    tests: total.test ? (total.test.passed ? 'passed' : 'failed') : null,
    allPushed: total.n.pushes > 0 && total.pushAt >= total.commitAt,
    files,
  };
}

/** Keeps a file's latest change last; past MAX_FILES the oldest goes. @param {Map<string, number>} files @param {string} key @param {number} at */
function rememberFile(files, key, at) {
  files.delete(key);
  files.set(key, at);
  if (files.size > MAX_FILES) files.delete(/** @type {string} */ (files.keys().next().value));
}

/**
 * Buckets and files older than a day go. A clock set back cannot grow a crew past a day's worth
 * of buckets either: the first made goes first.
 * @param {Crew} crew @param {number} at
 */
function dropOld(crew, at) {
  const cutoff = at - KEEP_MS;
  for (const start of crew.buckets.keys()) if (start + BUCKET_MS <= cutoff) crew.buckets.delete(start);
  while (crew.buckets.size > MAX_BUCKETS) crew.buckets.delete(/** @type {number} */ (crew.buckets.keys().next().value));
  for (const [key, changed] of crew.files) {
    if (changed > cutoff) break;
    crew.files.delete(key);
  }
}

/**
 * Each crew's counters, a day of five-minute buckets. Times are when hooks arrived (the server's
 * clock), so a hook that comes late still counts in the period it arrived in.
 */
export function createDigest() {
  /** @type {Map<string, Crew>} the least recently active first */
  const crews = new Map();

  /**
   * The crew a hook belongs to, made on first sight and moved to the end (the most recent). Past
   * MAX_CREWS the one quiet for longest is forgotten.
   * @param {string} sessionId @param {number} at
   */
  function crewOf(sessionId, at) {
    const crew = crews.get(sessionId) ?? { cwd: '', title: null, lastAt: at, buckets: new Map(), files: new Map() };
    crews.delete(sessionId);
    crews.set(sessionId, crew);
    crew.lastAt = Math.max(crew.lastAt, at);
    if (crews.size > MAX_CREWS) crews.delete(/** @type {string} */ (crews.keys().next().value));
    return crew;
  }

  /** @param {Crew} crew @param {number} at @returns {Counts} */
  function countsAt(crew, at) {
    const start = bucketStart(at);
    let counts = crew.buckets.get(start);
    if (!counts) {
      counts = emptyCounts();
      crew.buckets.set(start, counts);
      // A bucket rolled over: the oldest may be more than a day old now.
      dropOld(crew, at);
    }
    return counts;
  }

  /** @param {Crew} crew @param {Tally} tally @param {number} at */
  function add(crew, tally, at) {
    // Files are counted apart, by when each last changed: a file changed in several buckets is
    // one file changed, for any period.
    if (tally.file) {
      rememberFile(crew.files, inputKey(tally.file), at);
      return;
    }
    const counts = countsAt(crew, at);
    if (tally.count) counts.n[tally.count] += 1;
    if (tally.message) counts.message = { text: tally.message, at };
    if (tally.stop) counts.stops.set(tally.stop, (counts.stops.get(tally.stop) ?? 0) + 1);
    if (tally.passed !== undefined) counts.test = { passed: tally.passed, at };
    if (tally.commit) {
      counts.n.commits += 1;
      counts.commitAt = at;
    }
    if (tally.push) {
      counts.n.pushes += 1;
      counts.pushAt = at;
    }
  }

  return {
    /**
     * One hook. Teammates' crews are theirs: the caller leaves them out (server/ingest.mjs).
     * @param {unknown} event  a town payload; on the server, sanitized
     * @param {number} at      when it arrived
     */
    observe(event, at) {
      if (!isObject(event)) return;
      const sessionId = oneLine(event.session_id) || NO_SESSION;
      if (isDoctorSession(sessionId)) return;
      const crew = crewOf(sessionId, at);
      // Named like the town names a crew: its first folder, its latest title.
      if (!crew.cwd) crew.cwd = str(event.cwd);
      const title = clip(oneLine(event.session_title), 120);
      if (title) crew.title = title;
      const tally = tallyOf(event);
      if (tally) add(crew, tally, at);
    },

    /**
     * An approval changed (the broker's onChange, or the demo's): a permission answered counts
     * once, when it settles.
     * @param {unknown} approval  CONTRACTS §4.5 Approval
     * @param {number} at
     */
    answered(approval, at) {
      if (!isObject(approval) || !ANSWERED.has(approval.status) || Object.hasOwn(INTERACTIVE_TOOLS, str(approval.toolName))) return;
      const sessionId = oneLine(approval.sessionId) || NO_SESSION;
      if (isDoctorSession(sessionId)) return;
      const crew = crewOf(sessionId, at);
      if (!crew.cwd) crew.cwd = str(approval.cwd);
      add(crew, { count: 'answered' }, at);
    },

    /**
     * What each crew did from `since` until `at`: every bucket that ends after `since`, within
     * the last day. Crews quiet for a day are forgotten here.
     * @param {number} since
     * @param {number} at
     * @returns {Digest}
     */
    summary(since, at) {
      const from = bucketStart(Math.min(at, Math.max(Number.isFinite(since) ? since : 0, at - KEEP_MS)));
      /** @type {CrewDigest[]} */
      const out = [];
      for (const [sessionId, crew] of [...crews]) {
        if (crew.lastAt <= at - KEEP_MS) {
          crews.delete(sessionId);
          continue;
        }
        dropOld(crew, at);
        const digest = crewDigest(sessionId, crew, from);
        if (digest) out.push(digest);
      }
      return { since: from, until: at, crews: out.sort((a, b) => b.lastAt - a.lastAt) };
    },

    /** What it holds: crews, buckets and files, for tests of its bounds. */
    size() {
      let buckets = 0;
      let files = 0;
      for (const crew of crews.values()) {
        buckets += crew.buckets.size;
        files += crew.files.size;
      }
      return { crews: crews.size, buckets, files };
    },
  };
}
