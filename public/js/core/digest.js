// What each of your crews did, for "Catch me up" (docs/design/agent-health.md §7): what each crew
// did over the last 24 hours, and the summary of any period that ends now. Pure and bounded. The
// server keeps one (server/digest.mjs), fed by this computer's hooks and the approval broker, so a
// summary survives a page reload and does not depend on the history kept for late tabs; the demo
// keeps its own (sources/demo.js), so the feature can be seen without Claude Code.
//
// What a hook counts for (tallyOf):
//   Stop                 a finished turn, with its last message (not an interrupted turn, nor
//                        the same turn going on after a Stop hook, `stop_hook_active`)
//   StopFailure          a turn stopped on an error, by its kind (rate_limit, overloaded, …)
//   PreToolUse           a tool call (a Codex patch over several files is one)
//   PostToolUseFailure   a failed tool call, unless you interrupted it; a test run failing
//   PostToolUse          a file changed (Edit, MultiEdit, Write, NotebookEdit, a Codex patch that
//                        deletes one); a test run passing; each commit (not an amend); each push
//                        (not a deletion, nor one that found everything up to date). From Codex,
//                        only when its adapter found the exit code (`andary_exit_known`)
//   PermissionRequest    a permission asked for (a question or a plan to approve is not one)
//   SubagentStart, SubagentStop   a helper started, a helper finished
// A permission answered is read from the approval itself (answered()): allowed or denied in the
// town, or run or denied after it went to the terminal (its `proof`).
//
// Frequent counts (tool calls, helpers) are kept in five-minute buckets, each with the time of the
// latest thing it counted; the rest (turns, failures, permissions, commits, pushes, stops) keep
// each one's time, and so do the latest message, the latest test result and each changed file. A
// summary counts everything from one time: the time asked for, or the start of the five-minute
// bucket it falls in when a bucket counted something since then (`from`).
import { INTERACTIVE_TOOLS, inputKey } from './dialogs.js';
import { isDoctorSession } from './ids.js';
import { gitAction, isTestRun, runsNoTests, shellCommands } from './shell.js';
import { classifyError } from './summaries.js';
import { clip, isObject, oneLine, own, str, textOf } from './text.js';

/** Frequent counts are kept in buckets this long, so a summary may reach up to one bucket early. */
export const BUCKET_MS = 5 * 60_000;
/** Kept for a day: the longest absence worth catching up on in one go. */
export const KEEP_MS = 24 * 60 * 60_000;
/** A day's buckets for one crew, and the one filling up. */
const MAX_BUCKETS = KEEP_MS / BUCKET_MS + 1;
/** Crews kept at once; the one quiet for longest gives way. */
const MAX_CREWS = 100;
/** Changed files remembered per crew; the one changed longest ago gives way. */
const MAX_FILES = 200;
/** Times kept per crew of each rare count, and of its stops; the oldest give way. */
const MAX_TIMES = 200;
/** A crew's folder, as kept: at most this long. */
const CWD_CHARS = 1000;
/** A finished turn's last message: one line, at most this long. */
const MESSAGE_CHARS = 200;
/** A stop's kind comes from the hook (StopFailure's error code): at most this long. */
const KIND_CHARS = 40;
/** The town's crew for hooks without a session id (NO_SESSION in core/events.js). */
const NO_SESSION = 'unknown';
/** An approval decided in the town. */
const DECIDED = new Set(['allowed', 'denied']);
/** What shows that a request in the terminal was answered there (`stopped` may be abandoned). */
const PROOFS_OF_ANSWER = new Set(['ran', 'denied']);
/** What git push says when it had nothing to send. */
const UP_TO_DATE = /Everything up-to-date/g;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
/** Tools that change a file when they succeed: the town's diffs (core/changes.js), and a Codex patch that deletes one. */
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch']);

/** @typedef {'toolCalls'|'helpersStarted'|'helpersFinished'} BucketedName */
/** @typedef {'turns'|'failures'|'asked'|'answered'|'commits'|'pushes'} TimedName */
/** @typedef {BucketedName|TimedName} CountName */
/** @type {readonly BucketedName[]} */
const BUCKETED = Object.freeze(['toolCalls', 'helpersStarted', 'helpersFinished']);
/** @type {readonly TimedName[]} */
const TIMED = Object.freeze(['turns', 'failures', 'asked', 'answered', 'commits', 'pushes']);

/**
 * @typedef {object} Tally  what one hook adds to its crew's counts
 * @property {CountName} [count]  one more of these
 * @property {string} [message]   a finished turn's last message ('' when it said nothing)
 * @property {string} [stop]      a stopped turn's kind
 * @property {string} [file]      the file a tool changed
 * @property {boolean} [passed]   a test run's result
 * @property {number} [commits]   commits a command made
 * @property {number} [pushes]    pushes a command made
 */

/** @typedef {Record<BucketedName, number> & { lastAt: number }} Bucket  a crew's frequent counts in five minutes, and when the latest came */

/**
 * @typedef {object} Crew
 * @property {string} cwd           the folder its first hook named
 * @property {string|null} title
 * @property {number} lastAt        when its latest hook arrived
 * @property {Map<number, Bucket>} buckets  by start time
 * @property {Record<TimedName, number[]>|null} times  each rare count's times, oldest first (made with the first)
 * @property {{ kind: string, at: number }[]|null} stops  its stopped turns, oldest first (made with the first)
 * @property {Map<string, number>|null} files  a key of each file's path → when it last changed, oldest first
 * @property {{ text: string, at: number }|null} message  its latest finished turn's last message ('' when it said nothing)
 * @property {{ passed: boolean, at: number }|null} test  its latest test run's result
 */

/**
 * What one crew did in a period (CONTRACTS §4.13, `{ t: 'digest' }`).
 * @typedef {object} CrewDigest
 * @property {string} sessionId
 * @property {string} cwd
 * @property {string|null} title
 * @property {number} lastAt          when its latest hook arrived
 * @property {number} turns           finished turns
 * @property {string|null} lastMessage  its latest finished turn's last message, one line, clipped; null when that turn said nothing or came before the period
 * @property {Record<string, number>} stops  turns stopped on an error, by kind
 * @property {number} failures        failed tool calls
 * @property {'passed'|'failed'|null} tests  the latest test run's result
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
 * @property {number} since  where the period starts: the time asked for, or later when the town remembers no further back (`limit`)
 * @property {number} from   where its earliest count starts: `since`, or up to a bucket before it when a five-minute count reaches back
 * @property {number} until  when it was made
 * @property {'started'|'day'|null} limit  why `since` is later than the time asked for: the town started then, or it keeps a day
 * @property {CrewDigest[]} crews  the crews that did something, the most recently active first
 */

/**
 * A copy of a short piece of a long string, so the long one is not kept alive by it (an engine
 * may keep a slice as a view of its parent).
 * @param {string} text
 */
const fresh = (text) => ` ${text}`.slice(1);

/**
 * The simple commands of the shell command a hook ran to its end (core/shell.js), or none. One
 * sent to the background has only started when its hook comes: its result arrives later, through
 * tools that do not name the command.
 * @param {Record<string, any>} event
 */
function commandsOf(event) {
  const tool = str(event.tool_name);
  if (!SHELL_TOOLS.has(tool) || !isObject(event.tool_input) || event.tool_input.run_in_background === true) return [];
  return shellCommands(event.tool_input.command, { powershell: tool === 'PowerShell' });
}

/** @param {Record<string, any>} event @returns {string} the file a tool changed, or '' */
function changedFile(event) {
  if (!FILE_TOOLS.has(str(event.tool_name)) || !isObject(event.tool_input)) return '';
  return str(event.tool_input.file_path ?? event.tool_input.notebook_path).trim();
}

/** A later file of a Codex patch, which the adapter splits into one call per file (`id#2`, …). @param {Record<string, any>} event */
const isPatchPart = (event) => event.andary_tool === 'apply_patch' && /#\d+$/.test(str(event.tool_use_id));

/** One more of something, and what else came with it. @param {CountName} name @param {Tally} [extra] @returns {Tally} */
const one = (name, extra = {}) => ({ ...extra, count: name });

/** A commit that makes a new one (an amend rewrites the last). @param {string[]} words */
const isNewCommit = (words) => gitAction(words) === 'commit' && !words.includes('--amend');

/** A push that sends something rather than deleting (`--delete`, `-d`, `:branch`). @param {string[]} words */
const isSendingPush = (words) => gitAction(words) === 'push' && !words.some((word) => word === '--delete' || word === '-d' || word.startsWith(':'));

/** How many pushes said they had nothing to send. @param {Record<string, any>} event */
function upToDate(event) {
  const response = event.tool_response;
  const parts = typeof response === 'string' ? [response] : isObject(response) ? [response.stdout, response.stderr, response.output] : [];
  return parts.filter((part) => typeof part === 'string').join('\n').match(UP_TO_DATE)?.length ?? 0;
}

/**
 * A tool that ran: the file it changed, or what its shell command did. Tests passed when every
 * test run in the line must have succeeded for the line to (core/shell.js) and each runs tests;
 * each new commit and each push that sent something counts, when it must have succeeded. A Codex
 * command proves that only when its exit code was found.
 * @param {Record<string, any>} event
 * @returns {Tally|null}
 */
function ranTool(event) {
  const file = changedFile(event);
  if (file) return { file };
  if (event.andary_source === 'codex' && event.andary_exit_known !== true) return null;
  const commands = commandsOf(event);
  const tests = commands.filter((c) => isTestRun(c.words));
  const done = commands.filter((c) => c.succeeded);
  /** @type {Tally} */
  const tally = {};
  if (tests.length && tests.every((c) => c.succeeded && !runsNoTests(c.words))) tally.passed = true;
  const commits = done.filter((c) => isNewCommit(c.words)).length;
  const pushes = Math.max(0, done.filter((c) => isSendingPush(c.words)).length - upToDate(event));
  if (commits) tally.commits = commits;
  if (pushes) tally.pushes = pushes;
  return Object.keys(tally).length ? tally : null;
}

/**
 * A tool that failed, unless you interrupted it. The tests are red when the line's failure can
 * only be a test run's that runs tests, and it did not time out (the town calls that a timeout,
 * core/summaries.js).
 * @param {Record<string, any>} event
 * @returns {Tally|null}
 */
function failedTool(event) {
  if (event.is_interrupt === true) return null;
  const tests = commandsOf(event).filter((c) => isTestRun(c.words));
  const red = tests.some((c) => c.decides) && !tests.some((c) => runsNoTests(c.words)) && classifyError(str(event.error), false, 'test') === 'tests';
  return one('failures', red ? { passed: false } : {});
}

/** A finished turn's last message, one line, clipped. @param {Record<string, any>} event */
const lastMessage = (event) => fresh(clip(oneLine(textOf(event.last_assistant_message)), MESSAGE_CHARS));

/** @type {Readonly<Record<string, (event: Record<string, any>) => Tally|null>>} */
const TALLIES = Object.freeze({
  // After a Stop hook kept the turn going (stop_hook_active), the same turn ends again: newer words, no new turn.
  Stop: (e) => (e.stop_reason === 'interrupted' ? null : e.stop_hook_active === true ? { message: lastMessage(e) } : one('turns', { message: lastMessage(e) })),
  StopFailure: (e) => ({ stop: fresh(clip(oneLine(e.error), KIND_CHARS)) || 'unknown' }),
  PreToolUse: (e) => (isPatchPart(e) ? null : one('toolCalls')),
  PostToolUseFailure: failedTool,
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

/** @param {number} at @returns {Bucket} */
const emptyBucket = (at) => ({ lastAt: at, toolCalls: 0, helpersStarted: 0, helpersFinished: 0 });

/** @returns {Record<TimedName, number[]>} */
const emptyTimes = () => ({ turns: [], failures: [], asked: [], answered: [], commits: [], pushes: [] });

/** Keeps one more, the latest MAX_TIMES. @template T @param {T[]} list @param {T} item */
function keep(list, item) {
  list.push(item);
  if (list.length > MAX_TIMES) list.shift();
}

/** How many of the times (oldest first) are at or after `start`. @param {number[]|undefined} times @param {number} start */
function countFrom(times = [], start) {
  let n = 0;
  for (let i = times.length - 1; i >= 0 && times[i] >= start; i -= 1) n += 1;
  return n;
}

/**
 * A crew's frequent counts from `from` on: every bucket that counted something since then (each
 * begins at `from` or later, as summary() chooses `from`).
 * @param {Crew} crew @param {number} from
 */
function bucketedFrom(crew, from) {
  const n = /** @type {Record<BucketedName, number>} */ (Object.fromEntries(BUCKETED.map((name) => [name, 0])));
  for (const bucket of crew.buckets.values()) {
    if (bucket.lastAt < from) continue;
    for (const name of BUCKETED) n[name] += bucket[name];
  }
  return n;
}

/** Whether a crew's bucket began before `start` and counted something since: counts then reach back. @param {Crew} crew @param {number} start */
const reachesBack = (crew, start) => [...crew.buckets].some(([begins, bucket]) => begins < start && bucket.lastAt >= start);

/** A crew's stopped turns from `start` on, by kind. @param {Crew} crew @param {number} start */
function stopsFrom(crew, start) {
  /** @type {Record<string, number>} */
  const stops = {};
  for (const { kind, at } of crew.stops ?? []) if (at >= start) stops[kind] = (stops[kind] ?? 0) + 1;
  return stops;
}

/** Distinct files a crew changed from `start` on. @param {Crew} crew @param {number} start */
function filesFrom(crew, start) {
  let files = 0;
  for (const changed of crew.files?.values() ?? []) if (changed >= start) files += 1;
  return files;
}

/** A crew's latest time of a rare count (0: none kept). @param {Crew} crew @param {TimedName} name */
const latest = (crew, name) => crew.times?.[name].at(-1) ?? 0;

/**
 * One crew's work from `from` on, or null when it did nothing then.
 * @param {string} sessionId @param {Crew} crew @param {number} from
 * @returns {CrewDigest|null}
 */
function crewDigest(sessionId, crew, from) {
  const n = bucketedFrom(crew, from);
  const timed = /** @type {Record<TimedName, number>} */ (Object.fromEntries(TIMED.map((name) => [name, countFrom(crew.times?.[name], from)])));
  const stops = stopsFrom(crew, from);
  const files = filesFrom(crew, from);
  const lastMessage = crew.message && crew.message.at >= from && crew.message.text ? crew.message.text : null;
  const tests = crew.test && crew.test.at >= from ? (crew.test.passed ? 'passed' : 'failed') : null;
  const counted = [...Object.values(n), ...Object.values(timed), files, Object.keys(stops).length].some((value) => value > 0);
  if (!counted && tests === null && lastMessage === null) return null;
  const allPushed = timed.pushes > 0 && latest(crew, 'pushes') >= latest(crew, 'commits');
  return { sessionId, cwd: crew.cwd, title: crew.title, lastAt: crew.lastAt, ...n, ...timed, lastMessage, stops, tests, allPushed, files };
}

/** Keeps a file's latest change last; past MAX_FILES the oldest goes. @param {Map<string, number>} files @param {string} key @param {number} at */
function rememberFile(files, key, at) {
  files.delete(key);
  files.set(key, at);
  if (files.size > MAX_FILES) files.delete(/** @type {string} */ (files.keys().next().value));
}

/**
 * Drops what is at or before the cutoff from the front of a list kept oldest first.
 * @template T @param {T[]} list @param {number} cutoff @param {(item: T) => number} timeOf
 */
function dropUntil(list, cutoff, timeOf) {
  let n = 0;
  while (n < list.length && timeOf(list[n]) <= cutoff) n += 1;
  if (n) list.splice(0, n);
}

/**
 * What is more than a day old goes. A clock set back cannot grow a crew past a day's worth of
 * buckets either: the first made goes first.
 * @param {Crew} crew @param {number} at
 */
function dropOld(crew, at) {
  const cutoff = at - KEEP_MS;
  for (const begins of crew.buckets.keys()) if (begins + BUCKET_MS <= cutoff) crew.buckets.delete(begins);
  while (crew.buckets.size > MAX_BUCKETS) crew.buckets.delete(/** @type {number} */ (crew.buckets.keys().next().value));
  for (const times of Object.values(crew.times ?? {})) dropUntil(times, cutoff, (t) => t);
  if (crew.stops) dropUntil(crew.stops, cutoff, (stop) => stop.at);
  for (const [key, changed] of crew.files ?? []) {
    if (changed > cutoff) break;
    crew.files?.delete(key);
  }
  if (crew.message && crew.message.at <= cutoff) crew.message = null;
  if (crew.test && crew.test.at <= cutoff) crew.test = null;
}

/**
 * Each crew's counts for a day. Times are when hooks arrived (the server's clock), so a hook that
 * comes late still counts in the period it arrived in.
 * @param {{ startedAt?: number }} [options]  startedAt: when counting began (the server's start); nothing before it is known
 */
export function createDigest({ startedAt = 0 } = {}) {
  /** @type {Map<string, Crew>} the least recently active first */
  const crews = new Map();

  /**
   * The crew a hook belongs to, made on first sight and moved to the end (the most recent). Past
   * MAX_CREWS the one quiet for longest is forgotten.
   * @param {string} sessionId @param {number} at
   */
  function crewOf(sessionId, at) {
    /** @type {Crew} */
    const crew = crews.get(sessionId) ?? { cwd: '', title: null, lastAt: at, buckets: new Map(), times: null, stops: null, files: null, message: null, test: null };
    crews.delete(sessionId);
    crews.set(sessionId, crew);
    crew.lastAt = Math.max(crew.lastAt, at);
    if (crews.size > MAX_CREWS) crews.delete(/** @type {string} */ (crews.keys().next().value));
    return crew;
  }

  /** @param {Crew} crew @param {number} at @returns {Bucket} */
  function bucketAt(crew, at) {
    const begins = bucketStart(at);
    let bucket = crew.buckets.get(begins);
    if (!bucket) {
      bucket = emptyBucket(at);
      crew.buckets.set(begins, bucket);
      // A bucket rolled over: what is a day old can go.
      dropOld(crew, at);
    }
    bucket.lastAt = Math.max(bucket.lastAt, at);
    return bucket;
  }

  /** @param {Crew} crew @param {TimedName} name @param {number} at @param {number} [n] */
  function addTimes(crew, name, at, n = 1) {
    crew.times ??= emptyTimes();
    for (let i = 0; i < n; i += 1) keep(crew.times[name], at);
  }

  /** @param {Crew} crew @param {Tally} tally @param {number} at */
  function add(crew, tally, at) {
    // A file changed in several periods is one file changed, for any of them.
    if (tally.file) {
      rememberFile((crew.files ??= new Map()), inputKey(tally.file), at);
      return;
    }
    const { count } = tally;
    if (count && /** @type {readonly string[]} */ (BUCKETED).includes(count)) bucketAt(crew, at)[/** @type {BucketedName} */ (count)] += 1;
    else if (count) addTimes(crew, /** @type {TimedName} */ (count), at);
    if (tally.message !== undefined) crew.message = { text: tally.message, at };
    if (tally.stop) keep((crew.stops ??= []), { kind: tally.stop, at });
    if (tally.passed !== undefined) crew.test = { passed: tally.passed, at };
    if (tally.commits) addTimes(crew, 'commits', at, tally.commits);
    if (tally.pushes) addTimes(crew, 'pushes', at, tally.pushes);
  }

  return {
    /**
     * One hook. Teammates' crews are theirs: the caller leaves them out (server/ingest.mjs).
     * @param {unknown} event  a town payload; on the server, sanitized
     * @param {number} at      when it arrived
     */
    observe(event, at) {
      if (!isObject(event)) return;
      const sessionId = fresh(oneLine(event.session_id)) || NO_SESSION;
      if (isDoctorSession(sessionId)) return;
      const crew = crewOf(sessionId, at);
      // Named like the town names a crew: its first folder, its latest title.
      if (!crew.cwd) crew.cwd = fresh(clip(str(event.cwd), CWD_CHARS));
      const title = fresh(clip(oneLine(event.session_title), 120));
      if (title) crew.title = title;
      const tally = tallyOf(event);
      if (tally) add(crew, tally, at);
    },

    /**
     * An approval changed (the broker's onChange, or the demo's): a permission answered counts
     * once, when it is allowed or denied in the town, or when one in the terminal (resolved, or
     * expired first) shows it ran or was denied (its `proof`, server/approvals.mjs). One the agent
     * moved on from (`stopped`) may have been abandoned: it is not counted.
     * @param {unknown} approval  CONTRACTS §4.5 Approval
     * @param {number} at
     */
    answered(approval, at) {
      if (!isObject(approval) || Object.hasOwn(INTERACTIVE_TOOLS, str(approval.toolName))) return;
      const inTerminal = (approval.status === 'resolved' || approval.status === 'expired') && PROOFS_OF_ANSWER.has(approval.proof);
      if (!DECIDED.has(approval.status) && !inTerminal) return;
      const sessionId = fresh(oneLine(approval.sessionId)) || NO_SESSION;
      if (isDoctorSession(sessionId)) return;
      const crew = crewOf(sessionId, at);
      if (!crew.cwd) crew.cwd = fresh(clip(str(approval.cwd), CWD_CHARS));
      add(crew, { count: 'answered' }, at);
    },

    /**
     * What each crew did from `since` until `at`, as far back as the town remembers: since it
     * started, the last day at most. Crews quiet for a day are forgotten here.
     * @param {number} since
     * @param {number} at
     * @returns {Digest}
     */
    summary(since, at) {
      const floor = Math.max(startedAt, at - KEEP_MS);
      const asked = Number.isFinite(since) ? since : 0;
      const start = Math.min(at, Math.max(asked, floor));
      /** @type {Digest['limit']} */
      const limit = asked >= floor ? null : startedAt > at - KEEP_MS ? 'started' : 'day';
      for (const [sessionId, crew] of [...crews]) {
        if (crew.lastAt <= at - KEEP_MS) crews.delete(sessionId);
        else dropOld(crew, at);
      }
      // Everything is counted from one time, so the counts are never mixed: from the bucket's
      // start when a five-minute count reaches back before the time asked for.
      const from = [...crews.values()].some((crew) => reachesBack(crew, start)) ? bucketStart(start) : start;
      /** @type {CrewDigest[]} */
      const out = [];
      for (const [sessionId, crew] of crews) {
        const digest = crewDigest(sessionId, crew, from);
        if (digest) out.push(digest);
      }
      return { since: start, from, until: at, limit, crews: out.sort((a, b) => b.lastAt - a.lastAt) };
    },

    /** What it holds: crews, buckets, files and kept times, for tests of its bounds. */
    size() {
      let buckets = 0;
      let files = 0;
      let times = 0;
      for (const crew of crews.values()) {
        buckets += crew.buckets.size;
        files += crew.files?.size ?? 0;
        times += Object.values(crew.times ?? {}).reduce((sum, list) => sum + list.length, 0) + (crew.stops?.length ?? 0);
      }
      return { crews: crews.size, buckets, files, times };
    },
  };
}
