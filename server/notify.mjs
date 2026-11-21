// Phone notifications through ntfy (https://ntfy.sh): free, no account, an app for Android and
// iOS. Opt-in with `andary start --notify` (a random private topic on ntfy.sh, kept in
// <ANDARY_HOME>/notify.json) or `--notify-url <url>` (your own ntfy server or topic). Messages
// say only what happened ("A crew needs your permission"), never a project, a file, a command or
// a tool, because anyone who knows the topic can read them. At most one of a kind every 30
// seconds and 30 an hour (CONTRACTS §4.10).
//
// They follow the town's attention rules (docs/design/agent-health.md §2). What an agent has asked
// you and had no answer to is decided by core/dialogs.js, the model the approval broker uses too:
// every hook goes through its afterHook() table at its own time (a dialog per call, closed only
// on proof of an answer). This module keeps only its own part: a dialog's note waits
// DIALOG_DELAY_MS and goes out if the dialog is still open then; dialogs due together become one
// note. A finished turn is no news by itself:
// Claude Code's idle_prompt says so a minute later if nobody answered, and for Codex, which sends
// no idle_prompt, that minute is counted here. An agent that seems stuck gets one note per
// episode, from the very rules the town's alert follows (core/loops.js).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterHook, createDialogs } from '../public/js/core/dialogs.js';
import { HIGH_PERCENT, SAME_WINDOW_MS, limitName, resetWords, usedWords } from '../public/js/core/limits.js';
import { agentKeyOf, normalizeAgentId } from '../public/js/core/ids.js';
import { createLoops, stuckWords } from '../public/js/core/loops.js';
import { clip, isObject, textOf } from '../public/js/core/text.js';
import { hookStep, hookTime } from './hook-steps.mjs';
import { MAX_STRING_CHARS } from './sanitize.mjs';

/** @typedef {import('../public/js/core/dialogs.js').Dialog} Dialog */

export const NTFY_SERVER = 'https://ntfy.sh';
/** A dialog's note waits this long; one answered meanwhile (often within seconds) needs none. */
export const DIALOG_DELAY_MS = 10_000;
/** Codex sends no idle_prompt: a Codex lead that stopped and heard nothing for this long is waiting for you. */
export const CODEX_IDLE_MS = 60_000;
const SAME_KIND_MS = 30_000;
const HOUR_MS = 3_600_000;
const HOURLY_LIMIT = 30;
/** A dialog that has had its note is forgotten this long after it opened: a crashed session sends no SessionEnd. */
const NOTED_MAX_AGE_MS = 30 * 60_000;
/** Open dialogs kept at once; the oldest give way. */
const MAX_DIALOGS = 100;
/** Every dialog note shares one 30 s limit, whatever it says. */
const DIALOG_RATE = 'dialog';
const SEND_TIMEOUT_MS = 5000;
/** A failure's text, for the stuck rules, is read this far: as far as the town gets it (sanitize.mjs). */
const ERROR_TEXT_CHARS = MAX_STRING_CHARS;
/** Limit windows remembered as noted (also in limit-notes.json, so a restart sends none again); the oldest give way. */
const MAX_NOTED_WINDOWS = 64;

/**
 * @typedef {object} Note
 * @property {string} kind
 * @property {string} title
 * @property {string} body
 * @property {'default'|'high'} priority
 * @property {string} tags   ntfy emoji tags
 */

/** Notes sent at once. @type {Readonly<Record<string, Omit<Note, 'kind'>>>} */
const NOTES = Object.freeze({
  waiting: { title: 'Andary', body: 'A crew is waiting for your next prompt.', priority: 'default', tags: 'hourglass' },
  limit: { title: 'Andary', body: 'Claude Code stopped: it hit a usage or rate limit.', priority: 'high', tags: 'warning' },
  stopped: { title: 'Andary', body: 'Claude Code stopped with an error.', priority: 'high', tags: 'warning' },
  test: { title: 'Andary', body: 'This is a test notification from your town.', priority: 'default', tags: 'tada' },
});

/**
 * What a note for open dialogs says, by their kind: for one crew, and for several. Dialogs of
 * several kinds share the plain one.
 * @type {Readonly<Record<string, { one: string, many: (crews: number) => string, tags: string }>>}
 */
const DIALOG_WORDS = Object.freeze({
  permission: { one: 'A crew needs your permission.', many: (n) => `${n} crews need your permission.`, tags: 'raised_hand' },
  question: { one: 'A crew has a question for you.', many: (n) => `${n} crews have a question for you.`, tags: 'question' },
  plan: { one: 'A crew has a plan for you to approve.', many: (n) => `${n} crews have a plan for you to approve.`, tags: 'clipboard' },
  mixed: { one: 'A crew needs you.', many: (n) => `${n} crews need you.`, tags: 'raised_hand' },
});

/** @param {string} kind @returns {Note} */
const noteOf = (kind) => ({ kind, ...NOTES[kind] });

/**
 * The note for an agent that seems stuck, in words that follow its rule and name no step.
 * @param {1|2|3} rule
 * @returns {Note}
 */
const stuckNote = (rule) => ({ kind: 'stuck', title: 'Andary', body: `A crew seems stuck: ${stuckWords(rule)}.`, priority: 'default', tags: 'repeat' });

/**
 * The note for a plan limit at 90% or more: "Claude's 5-hour limit is 91% used. It resets at
 * 15:40." It names the limit and its reset time, nothing about any crew; with two accounts or
 * more, also which one, by its config folder's name. Each kind of limit has its own 30 s turn, so
 * the 5-hour and the weekly limit never hold each other back.
 * @param {import('../public/js/core/limits.js').Limit} limit
 * @param {number} now
 * @param {string|null} [account]  the account's name, when there are several
 * @returns {Note}
 */
export function limitNote(limit, now, account = null) {
  const whose = account ? ` (${account})` : '';
  const body = `Claude's ${limitName(limit.kind).toLowerCase()}${whose} is ${usedWords(limit.percentUsed)}. It ${resetWords(limit.resetsAt, now)}.`;
  return { kind: `limit-high:${limit.kind}`, title: 'Andary', body, priority: 'default', tags: 'chart_with_upwards_trend' };
}

/**
 * The note a hook event deserves at once, or null. A dialog's note (a permission request, a
 * question, a plan) waits instead: see createNotifier.
 * @param {Record<string, any>} event  a raw hook payload
 * @returns {Note|null}
 */
export function noteFor(event) {
  const name = event?.hook_event_name;
  if (name === 'Notification' && event.notification_type === 'idle_prompt') return noteOf('waiting');
  if (name === 'StopFailure') return noteOf(/rate|limit|quota|overload/i.test(String(event.error ?? '')) ? 'limit' : 'stopped');
  return null;
}

/**
 * A private ntfy.sh topic, made once and kept in <home>/notify.json.
 * @param {string} home
 * @returns {string} the topic URL
 */
export function savedTopicUrl(home) {
  const file = join(home, 'notify.json');
  try {
    const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (typeof saved?.url === 'string' && /^https:\/\//.test(saved.url)) return saved.url;
  } catch {
    // made again below
  }
  const url = `${NTFY_SERVER}/andary-${randomBytes(18).toString('base64url')}`;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ url }, null, 2)}\n`, { mode: 0o600 });
  return url;
}

/**
 * Checks a --notify-url value: an http(s) URL with a topic path.
 * @param {string} raw
 * @returns {string|null}
 */
export function checkNotifyUrl(raw) {
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.pathname.length < 2 || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
const text = (value) => (typeof value === 'string' ? value : '');

/**
 * The note for some open dialogs: worded by their kind (a session's own permission notice reads
 * as a permission), counted by crew.
 * @param {Dialog[]} covered
 * @param {number} crews
 * @returns {Note}
 */
function dialogNote(covered, crews) {
  const kinds = new Set(covered.map((dialog) => (dialog.kind === 'unknown' ? 'permission' : dialog.kind)));
  const words = DIALOG_WORDS[kinds.size === 1 ? [...kinds][0] : 'mixed'];
  return { kind: DIALOG_RATE, title: 'Andary', body: crews === 1 ? words.one : words.many(crews), priority: 'high', tags: words.tags };
}

/** A Codex session's wait for your prompt ends only with one, or with the session. */
const WAIT_ENDS = new Set(['UserPromptSubmit', 'SessionStart', 'SessionEnd']);
/** A tool starting: someone works, the minute pauses. */
const TOOL_STARTS = new Set(['PreToolUse', 'PermissionRequest']);
/** A tool or a helper done: the minute starts again. */
const WORK_DONE = new Set(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'SubagentStop']);

/**
 * Codex sends no idle_prompt: its lead's finished turn (Stop, an interrupt included) starts the
 * minute here.
 * @param {Record<string, any>} event
 */
function isCodexLeadStop(event) {
  return event.hook_event_name === 'Stop' && event.andary_source === 'codex' && normalizeAgentId(event.agent_id) === null;
}

/** Hooks after which an agent starts afresh for the stuck rules: as the town's store has them. */
const FRESH_STARTS = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SubagentStop']);
/** Finished tool calls, for the stuck rules: a refusal is a failure too. */
const FINISHED_CALLS = new Set(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']);

/**
 * Whether an agent starts afresh after this hook: its turn ended, you sent a prompt or
 * interrupted it, it finished, or its session started again (a compaction carries on).
 * @param {Record<string, any>} event
 */
function startsAfresh(event) {
  const name = event.hook_event_name;
  if (FRESH_STARTS.has(name)) return true;
  // Without an agent id a teammate's idle says nothing about the lead's turn.
  if (name === 'TeammateIdle') return normalizeAgentId(event.agent_id) !== null;
  if (name === 'SessionStart') return event.source !== 'compact';
  return name === 'PostToolUseFailure' && event.is_interrupt === true;
}

/**
 * A failed call's error text ('' for a success), as much of it as the town gets.
 * @param {Record<string, any>} event
 */
function errorText(event) {
  if (event.hook_event_name === 'PostToolUse') return '';
  if (event.hook_event_name === 'PermissionDenied') return textOf(event.reason) || 'Permission denied';
  return clip(textOf(event.error), ERROR_TEXT_CHARS);
}

/**
 * What a hook means for the stuck rules (core/loops.js): a finished tool call, or a fresh start for
 * its agent or, when the session ends, for all of the session's agents.
 * @param {ReturnType<typeof createLoops>} loops
 * @param {Record<string, any>} event  a raw hook payload
 * @param {number} t
 * @returns {import('../public/js/core/loops.js').LoopChange[]}
 */
function loopChanges(loops, event, t) {
  const sessionId = text(event.session_id);
  const agent = agentKeyOf(sessionId, normalizeAgentId(event.agent_id));
  if (event.hook_event_name === 'SessionEnd') return loops.resetAll((key) => key.startsWith(`${sessionId}:`));
  if (startsAfresh(event)) return loops.reset(agent);
  if (!FINISHED_CALLS.has(event.hook_event_name)) return [];
  const input = isObject(event.tool_input) ? event.tool_input : {};
  return loops.record({ agent, folder: text(event.cwd), tool: text(event.tool_name), input, ok: event.hook_event_name === 'PostToolUse', error: errorText(event), at: t });
}

/** At most one note of a kind every 30 s, and 30 an hour; test notes never use up the hour. */
function createRateLimit() {
  /** @type {Map<string, number>} */
  const lastByKind = new Map();
  /** @type {number[]} */
  let sentTimes = [];
  return {
    /** When a note of this kind may go out next. @param {string} kind */
    opensAt: (kind) => (lastByKind.get(kind) ?? -Infinity) + SAME_KIND_MS,
    /** Whether the hour's limit leaves room for one more. @param {number} t */
    hourLeft(t) {
      sentTimes = sentTimes.filter((at) => t - at < HOUR_MS);
      return sentTimes.length < HOURLY_LIMIT;
    },
    /** @param {string} kind @param {number} t */
    record(kind, t) {
      lastByKind.set(kind, t);
      if (kind !== 'test') sentTimes.push(t);
    },
  };
}

/** Codex sessions waited on at once; the oldest wait gives way (a session gone quiet mid-tool). */
const MAX_WAITS = 100;

/**
 * Codex sessions whose lead stopped and has had no prompt since, each with the minute that ends
 * in its "waiting" note. Codex names a helper only on SubagentStart and SubagentStop, so a
 * helper's tool events look like the lead's: a tool starting pauses the minute, a result, a
 * helper's end or the lead's next Stop starts it again, and only a prompt, or the session
 * starting or ending, ends the wait. One note per Stop: once it is sent, the session is
 * forgotten until the lead's next Stop.
 * @param {(fn: () => void, ms: number) => any} setTimer
 * @param {(timer: any) => void} clearTimer
 * @param {() => void} onIdle
 */
function createIdleWatch(setTimer, clearTimer, onIdle) {
  /** @type {Map<string, { timer: any }>} oldest first */
  const waits = new Map();
  /** @param {{ timer: any }} wait */
  const pause = (wait) => {
    if (wait.timer !== null) clearTimer(wait.timer);
    wait.timer = null;
  };
  /** @param {string} sessionId @param {{ timer: any }} wait */
  const run = (sessionId, wait) => {
    pause(wait);
    wait.timer = setTimer(() => {
      waits.delete(sessionId);
      onIdle();
    }, CODEX_IDLE_MS);
    wait.timer?.unref?.();
  };
  const watch = {
    /** The lead's Stop: the wait starts, or starts again. @param {string} sessionId */
    stopped(sessionId) {
      const wait = waits.get(sessionId) ?? { timer: null };
      waits.delete(sessionId);
      waits.set(sessionId, wait);
      if (waits.size > MAX_WAITS) watch.end(waits.keys().next().value ?? '');
      run(sessionId, wait);
    },
    /** @param {string} sessionId */
    pause(sessionId) {
      const wait = waits.get(sessionId);
      if (wait) pause(wait);
    },
    /** @param {string} sessionId */
    resume(sessionId) {
      const wait = waits.get(sessionId);
      if (wait) run(sessionId, wait);
    },
    /** @param {string} sessionId */
    end(sessionId) {
      const wait = waits.get(sessionId);
      if (!wait) return;
      pause(wait);
      waits.delete(sessionId);
    },
    clear() {
      for (const wait of waits.values()) pause(wait);
      waits.clear();
    },
  };
  return watch;
}

/**
 * The windows that had their note, from limit-notes.json: account and kind → reset time. Windows
 * that have reset are left behind; a damaged file starts over.
 * @param {string|null} file
 * @param {number} now
 * @returns {Map<string, number>}
 */
function loadNotedWindows(file, now) {
  /** @type {Map<string, number>} */
  const noted = new Map();
  if (!file || !existsSync(file)) return noted;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    for (const item of Array.isArray(saved?.windows) ? saved.windows.slice(-MAX_NOTED_WINDOWS) : []) {
      if (Array.isArray(item) && typeof item[0] === 'string' && Number.isFinite(item[1]) && item[1] > now - SAME_WINDOW_MS) noted.set(item[0], item[1]);
    }
  } catch {
    // starts over: at worst one note again
  }
  return noted;
}

/**
 * Writes the noted windows atomically (0600); on failure they stay in memory.
 * @param {string|null} file
 * @param {Map<string, number>} noted
 */
function saveNotedWindows(file, noted) {
  if (!file) return;
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify({ v: 1, windows: [...noted] }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  } catch {
    // kept in memory
  }
}

/**
 * The 90% notes for plan limits: one per limit window (an account's limit of one kind, until its
 * reset time), sent when the rate limits let it go; one held back is tried with the next report.
 * @param {{ admit: (note: Note) => boolean, post: (note: Note) => void, now: () => number, file: string|null }} options
 *   admit: whether the rate limits let a note go now; file: where noted windows are kept
 * @returns {(account: import('../public/js/core/limits.js').AccountLimits, accounts: number) => void}
 */
function createLimitNotes({ admit, post, now, file }) {
  const noted = loadNotedWindows(file, now());
  return (account, accounts) => {
    const t = now();
    for (const limit of account.limits) {
      const key = `${account.account}|${limit.kind}`;
      const resetsAt = noted.get(key);
      if (limit.percentUsed < HIGH_PERCENT || (resetsAt !== undefined && Math.abs(resetsAt - limit.resetsAt) < SAME_WINDOW_MS)) continue;
      const note = limitNote(limit, t, accounts > 1 ? (account.label ?? 'default folder') : null);
      if (!admit(note)) continue;
      noted.delete(key);
      noted.set(key, limit.resetsAt);
      if (noted.size > MAX_NOTED_WINDOWS) noted.delete(noted.keys().next().value ?? '');
      saveNotedWindows(file, noted);
      post(note);
    }
  };
}

/**
 * Posts notes to the topic. A failure is logged once, until a post works again.
 * @param {string|null} url
 * @param {typeof fetch} fetchImpl
 * @param {(message: string) => void} log
 * @returns {(note: Note) => Promise<boolean>}
 */
function createPoster(url, fetchImpl, log) {
  let warned = false;
  return async (note) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetchImpl(/** @type {string} */ (url), {
        method: 'POST',
        body: note.body,
        headers: { Title: note.title, Priority: note.priority, Tags: note.tags },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      warned = false;
      return true;
    } catch (error) {
      if (!warned) log(`Could not send a phone notification (${/** @type {Error} */ (error).message ?? 'error'})`);
      warned = true;
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * @typedef {object} NotifierOptions
 * @property {string|null} url
 * @property {typeof fetch} [fetchImpl]
 * @property {() => number} [now]
 * @property {(message: string) => void} [log]
 * @property {number} [delayMs]  how long a dialog's note waits (DIALOG_DELAY_MS)
 * @property {boolean} [limitNotes]  a note when a plan limit reaches HIGH_PERCENT (off by default)
 * @property {string|null} [limitNotesFile]  where the windows that had their note are kept (null: memory only)
 * @property {(fn: () => void, ms: number) => any} [setTimer]
 * @property {(timer: any) => void} [clearTimer]
 */

/** @param {NotifierOptions} options */
export function createNotifier({ url, fetchImpl = globalThis.fetch, now = Date.now, log = () => {}, delayMs = DIALOG_DELAY_MS, limitNotes = false, limitNotesFile = null, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const rate = createRateLimit();
  const post = createPoster(url, fetchImpl, log);
  const dialogs = createDialogs({ max: MAX_DIALOGS });
  /** This notifier's part of each open dialog: when its note is due, and whether it went out. @type {Map<number, { due: number, noted: boolean }>} */
  const notes = new Map();
  const idle = createIdleWatch(setTimer, clearTimer, () => void send(noteOf('waiting')));
  /** The stuck rules' memory of this computer's agents (the town keeps its own, from the same rules). */
  const loops = createLoops();
  const noteLimits = createLimitNotes({ admit: (note) => admit(note), post: (note) => void post(note), now, file: limitNotesFile });
  /** @type {any} */
  let timer = null;
  let disposed = false;

  /**
   * Whether a note may go out now (not too soon after the same kind, the hour's limit not
   * reached); if so, it counts as sent from now.
   * @param {Note} note
   */
  function admit(note) {
    if (!url || disposed) return false;
    const t = now();
    if (t < rate.opensAt(note.kind) || (note.kind !== 'test' && !rate.hourLeft(t))) return false;
    rate.record(note.kind, t);
    return true;
  }

  /**
   * Sends a note unless the rate limits hold it back.
   * @param {Note} note
   * @returns {Promise<boolean>} whether it was sent
   */
  async function send(note) {
    return admit(note) ? post(note) : false;
  }

  /** One timer, for the first dialog due, or later while a dialog note went out under 30 s ago. */
  function schedule() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    const open = new Set(dialogs.list().map((dialog) => dialog.id));
    let next = Infinity;
    for (const [id, note] of notes) {
      // The oldest give way when too many are open: their part goes with them.
      if (!open.has(id)) notes.delete(id);
      else if (!note.noted) next = Math.min(next, note.due);
    }
    if (next === Infinity) return;
    timer = setTimer(flushDue, Math.max(0, Math.max(next, rate.opensAt(DIALOG_RATE)) - now()));
    timer?.unref?.();
  }

  /**
   * One note for the crews with a dialog due. It covers every dialog those crews have open, so a
   * crew's parallel requests make one note. Past the hour's limit they count as noted, unsent.
   */
  function flushDue() {
    timer = null;
    const t = now();
    const waiting = dialogs.list().flatMap((dialog) => {
      const note = notes.get(dialog.id);
      return note && !note.noted ? [{ dialog, note }] : [];
    });
    const crews = new Set(waiting.filter(({ note }) => note.due <= t).map(({ dialog }) => dialog.sessionId));
    if (crews.size > 0 && t >= rate.opensAt(DIALOG_RATE)) {
      const covered = waiting.filter(({ dialog }) => crews.has(dialog.sessionId));
      for (const { note } of covered) note.noted = true;
      if (rate.hourLeft(t)) {
        rate.record(DIALOG_RATE, t);
        void post(dialogNote(covered.map(({ dialog }) => dialog), crews.size));
      }
    }
    schedule();
  }

  /** Forgets dialogs that had their note half an hour ago or more. @param {number} t */
  function forgetNoted(t) {
    for (const dialog of [...dialogs.list()]) {
      if (!notes.get(dialog.id)?.noted || t - dialog.at < NOTED_MAX_AGE_MS) continue;
      dialogs.forget(dialog.id);
      notes.delete(dialog.id);
    }
  }

  /**
   * Opens or closes the dialogs this event concerns. A dialog's note is due ten seconds after its
   * hook was sent.
   * @param {Record<string, any>} event
   * @param {number} t  the hook's own time
   */
  function track(event, t) {
    const { opened, closed } = afterHook(dialogs, hookStep(event, t));
    if (!opened && closed.length === 0) return;
    for (const dialog of closed) notes.delete(dialog.id);
    if (opened) notes.set(opened.id, { due: t + delayMs, noted: false });
    schedule();
  }

  /**
   * The Codex waiting note (see createIdleWatch).
   * @param {Record<string, any>} event
   */
  function watchIdle(event) {
    const sessionId = text(event.session_id);
    const name = event.hook_event_name;
    if (WAIT_ENDS.has(name)) idle.end(sessionId);
    else if (isCodexLeadStop(event)) idle.stopped(sessionId);
    else if (TOOL_STARTS.has(name)) idle.pause(sessionId);
    else if (WORK_DONE.has(name)) idle.resume(sessionId);
  }

  return {
    get on() {
      return Boolean(url);
    },
    url,
    /** Whether plan limits at 90% send a note (--notify-limits); the topic never changes. */
    limitNotes: Boolean(url) && limitNotes,
    /**
     * An account's limits changed (the andary-limits mod reported, §4.14): one note per limit
     * window that reached 90%. A note the rate limits hold back is tried again with the next
     * report, which comes after the next turn.
     * @param {import('../public/js/core/limits.js').AccountLimits} account
     * @param {number} [accounts]  how many accounts report: with two or more, the note names its own
     */
    limitsChanged(account, accounts = 1) {
      if (url && !disposed && limitNotes) noteLimits(account, accounts);
    },
    /**
     * @param {Record<string, any>} event  a local town payload, before it is sanitized
     * @param {number} [ts]  when the agent sent it (the forwarder's time): its dialogs go by it
     */
    observe(event, ts) {
      if (!url || disposed || !isObject(event)) return;
      const t = now();
      forgetNoted(t);
      watchIdle(event);
      const at = hookTime(ts, t);
      track(event, at);
      // One note when an episode starts; a later one held back by the 30 s limit is dropped.
      const stuck = loopChanges(loops, event, at).find((change) => change.started)?.stuck;
      if (stuck) void send(stuckNote(stuck.rule));
      const note = noteFor(event);
      if (note) void send(note);
    },
    /**
     * Every change of an approval (the broker's onChange). A pending one links to its own dialog
     * by its call key, saying whether the town holds it (again for a release, which hands it to
     * the terminal; an expiry does too). Only a decision in the town proves anything here: an
     * expired or released approval went back to the terminal, where the agent still waits, and a
     * resolved one followed the same rules as this notifier, on an event it has already seen.
     * @param {import('./approvals.mjs').Approval} approval
     */
    approvalChanged(approval) {
      if (!url || disposed) return;
      if (approval.status === 'pending') {
        dialogs.link({ sessionId: approval.sessionId, agentId: approval.agentId, tools: [approval.toolName].filter(Boolean), input: approval.callKey ?? null }, approval.id, approval.held);
        return;
      }
      if (approval.status === 'expired') {
        dialogs.toTerminal(approval.id);
        return;
      }
      if (approval.status !== 'allowed' && approval.status !== 'denied') return;
      for (const dialog of dialogs.decided(approval.id)) notes.delete(dialog.id);
      schedule();
    },
    /** A test note, from the town's Settings. */
    test: () => send(noteOf('test')),
    /** Drops every note still waiting and sends none afterwards (server shutdown). */
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      for (const dialog of [...dialogs.list()]) dialogs.forget(dialog.id);
      notes.clear();
      idle.clear();
      loops.resetAll(() => true);
    },
  };
}
