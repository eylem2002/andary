// Phone notifications through ntfy (https://ntfy.sh): free, no account, an app for Android and
// iOS. Opt-in with `andary start --notify` (a random private topic on ntfy.sh, kept in
// <ANDARY_HOME>/notify.json) or `--notify-url <url>` (your own ntfy server or topic). Messages
// say only what happened ("A crew needs your permission"), never a project, a file, a command or
// a tool, because anyone who knows the topic can read them. At most one of a kind every 30
// seconds and 30 an hour (CONTRACTS §4.10).
//
// They follow the town's attention rules (docs/design/agent-health.md §2). Every agent that asks
// for permission is tracked here, from its request until something proves the dialog was
// answered: the same call reporting back, a prompt, the turn or the session ending, or a decision
// in the town. Its note waits PERMISSION_DELAY_MS and goes out unless that proof came first; a
// request that timed out in the town or went back to the terminal is no proof, because the agent
// still waits there. Notes due together become one ("3 crews need your permission."). A finished
// turn is no news by itself: Claude Code's idle_prompt says so a minute later if nobody answered,
// and for Codex, which sends no idle_prompt, the same minute is counted here.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeAgentId } from '../public/js/core/ids.js';
import { isObject, shellWords } from '../public/js/core/text.js';

export const NTFY_SERVER = 'https://ntfy.sh';
/** A permission note waits this long; a request answered meanwhile (often within seconds) needs none. */
export const PERMISSION_DELAY_MS = 10_000;
/** Codex sends no idle_prompt: a Codex lead that stopped and heard nothing for this long is waiting for you. */
export const CODEX_IDLE_MS = 60_000;
const SAME_KIND_MS = 30_000;
const HOUR_MS = 3_600_000;
const HOURLY_LIMIT = 30;
/** A dialog that has had its note is remembered this long at most: a crashed session sends no SessionEnd. */
const ASK_MAX_AGE_MS = 30 * 60_000;
/** Dialogs remembered at once; the oldest give way. */
const MAX_ASKING = 100;
const SEND_TIMEOUT_MS = 5000;

/**
 * @typedef {object} Note
 * @property {string} kind
 * @property {string} title
 * @property {string} body
 * @property {'default'|'high'} priority
 * @property {string} tags   ntfy emoji tags
 */

/** @type {Readonly<Record<string, Omit<Note, 'kind'>>>} */
const NOTES = Object.freeze({
  permission: { title: 'Andary', body: 'A crew needs your permission.', priority: 'high', tags: 'raised_hand' },
  waiting: { title: 'Andary', body: 'A crew is waiting for your next prompt.', priority: 'default', tags: 'hourglass' },
  limit: { title: 'Andary', body: 'Claude Code stopped: it hit a usage or rate limit.', priority: 'high', tags: 'warning' },
  stopped: { title: 'Andary', body: 'Claude Code stopped with an error.', priority: 'high', tags: 'warning' },
  test: { title: 'Andary', body: 'This is a test notification from your town.', priority: 'default', tags: 'tada' },
});

/** @param {string} kind @returns {Note} */
const noteOf = (kind) => ({ kind, ...NOTES[kind] });

/**
 * The note a hook event deserves, or null. A permission note is not sent at once: see
 * createNotifier.
 * @param {Record<string, any>} event  a raw hook payload
 * @returns {Note|null}
 */
export function noteFor(event) {
  const name = event?.hook_event_name;
  if (name === 'PermissionRequest') return noteOf('permission');
  if (name === 'Notification') {
    if (event.notification_type === 'permission_prompt') return noteOf('permission');
    if (event.notification_type === 'idle_prompt') return noteOf('waiting');
    return null;
  }
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

/**
 * One agent's permission dialog, from its PermissionRequest (or Claude Code's permission_prompt,
 * when the request never reached the town) until something proves it was answered.
 * @typedef {object} Ask
 * @property {string} sessionId
 * @property {number} since              when the dialog was first seen
 * @property {number} due                when its note goes out
 * @property {string[]|null} tool        the names its tool goes by; null when unknown
 * @property {string|null} inputHash     SHA-256 of the tool input (a big Write is not kept); null when unknown
 * @property {string|null} approvalId    the held approval the town made for it
 * @property {boolean} notified          its note went out (or the hour's limit dropped it)
 */

/**
 * Read like the approval broker reads ids, so a town decision finds its dialog.
 * @param {unknown} value
 */
const text = (value) => (typeof value === 'string' ? value : '');

/**
 * One dialog at a time per agent: "session\0agent".
 * @param {string} sessionId
 * @param {string|null} agentId  normalised (no "agent-" prefix), null for the lead
 */
const askKey = (sessionId, agentId) => `${sessionId}\0${agentId ?? 'main'}`;

/**
 * The names a tool call goes by: its own and, for a call an adapter renamed (Codex's apply_patch
 * shown as an Edit), the name it was asked under.
 * @param {Record<string, any>} event
 * @returns {string[]}
 */
function toolNames(event) {
  return [text(event.tool_name), text(event.andary_tool)].filter(Boolean);
}

/**
 * A tool input's fingerprint. Codex may send a shell command as a list; its adapter joins the list
 * in tool results but never in the request (the town shows a request as it came), so a list is
 * joined here on both sides.
 * @param {unknown} input
 * @returns {string}
 */
function inputHash(input) {
  const same = isObject(input) && Array.isArray(input.command) ? { ...input, command: shellWords(input.command) } : input;
  return createHash('sha256').update(JSON.stringify(same ?? null)).digest('base64url');
}

/**
 * @param {string} sessionId
 * @param {number} since
 * @param {number} due
 * @param {Record<string, any>|null} request  the PermissionRequest; null for a permission_prompt
 * @returns {Ask}
 */
function newAsk(sessionId, since, due, request) {
  const names = request ? toolNames(request) : [];
  const known = names.length > 0;
  return { sessionId, since, due, tool: known ? names : null, inputHash: known ? inputHash(request?.tool_input) : null, approvalId: null, notified: false };
}

/**
 * Whether a tool result proves the agent's dialog was answered: the same call reported back. A
 * parallel call with another input proves nothing. A call an adapter renamed (andary_tool) no
 * longer has the input it was asked with, so its name has to do; so does any result when the
 * dialog's tool is unknown.
 * @param {Record<string, any>} event  PostToolUse, PostToolUseFailure or PermissionDenied
 * @param {Ask|undefined} ask
 * @returns {boolean}
 */
function answers(event, ask) {
  if (!ask) return false;
  if (!ask.tool) return true;
  const { tool } = ask;
  if (!toolNames(event).some((name) => tool.includes(name))) return false;
  return Boolean(event.andary_tool) || inputHash(event.tool_input) === ask.inputHash;
}

/**
 * A permission note, for one crew or several.
 * @param {number} crews
 * @returns {Note}
 */
function permissionNote(crews) {
  const note = noteOf('permission');
  return crews === 1 ? note : { ...note, body: `${crews} crews need your permission.` };
}

/**
 * Codex sends no idle_prompt: its lead's finished turn (Stop, an interrupt included) starts the
 * minute here. Helpers have agent_id.
 * @param {Record<string, any>} event
 */
function isCodexLeadStop(event) {
  return event.hook_event_name === 'Stop' && event.andary_source === 'codex' && normalizeAgentId(event.agent_id) === null;
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

/**
 * Codex leads that stopped, each with the timer of its "waiting" note. Anything later from the
 * session (a prompt, a tool, its end) stops the timer.
 * @param {(fn: () => void, ms: number) => any} setTimer
 * @param {(timer: any) => void} clearTimer
 * @param {() => void} onIdle
 */
function createIdleWatch(setTimer, clearTimer, onIdle) {
  /** @type {Map<string, any>} */
  const timers = new Map();
  return {
    /** @param {string} sessionId */
    stop(sessionId) {
      if (!timers.has(sessionId)) return;
      clearTimer(timers.get(sessionId));
      timers.delete(sessionId);
    },
    /** @param {string} sessionId */
    start(sessionId) {
      const timer = setTimer(() => {
        timers.delete(sessionId);
        onIdle();
      }, CODEX_IDLE_MS);
      timer?.unref?.();
      timers.set(sessionId, timer);
    },
    clear() {
      for (const timer of timers.values()) clearTimer(timer);
      timers.clear();
    },
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
 * @property {number} [delayMs]  how long a permission note waits (PERMISSION_DELAY_MS)
 * @property {(fn: () => void, ms: number) => any} [setTimer]
 * @property {(timer: any) => void} [clearTimer]
 */

/** @param {NotifierOptions} options */
export function createNotifier({ url, fetchImpl = globalThis.fetch, now = Date.now, log = () => {}, delayMs = PERMISSION_DELAY_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const rate = createRateLimit();
  const post = createPoster(url, fetchImpl, log);
  /** Dialogs waiting for their proof, oldest first. @type {Map<string, Ask>} */
  const asking = new Map();
  const idle = createIdleWatch(setTimer, clearTimer, () => void send(noteOf('waiting')));
  /** @type {any} */
  let askTimer = null;
  let disposed = false;

  /**
   * Sends a note unless it is too soon after the same kind, or the hour's limit is reached.
   * @param {Note} note
   * @returns {Promise<boolean>} whether it was sent
   */
  async function send(note) {
    if (!url || disposed) return false;
    const t = now();
    if (t < rate.opensAt(note.kind) || (note.kind !== 'test' && !rate.hourLeft(t))) return false;
    rate.record(note.kind, t);
    return post(note);
  }

  /** One timer, for the first dialog due, or later while a permission note went out under 30 s ago. */
  function schedule() {
    if (askTimer !== null) clearTimer(askTimer);
    askTimer = null;
    const waiting = [...asking.values()].filter((ask) => !ask.notified);
    if (waiting.length === 0) return;
    const at = Math.max(Math.min(...waiting.map((ask) => ask.due)), rate.opensAt('permission'));
    askTimer = setTimer(flushDue, Math.max(0, at - now()));
    askTimer?.unref?.();
  }

  /** One note for the crews whose dialogs are due; past the hour's limit they count as noted, unsent. */
  function flushDue() {
    askTimer = null;
    const t = now();
    const due = [...asking.values()].filter((ask) => !ask.notified && ask.due <= t);
    if (due.length > 0 && t >= rate.opensAt('permission')) {
      for (const ask of due) ask.notified = true;
      if (rate.hourLeft(t)) {
        rate.record('permission', t);
        void post(permissionNote(new Set(due.map((ask) => ask.sessionId)).size));
      }
    }
    schedule();
  }

  /** @param {string} key @param {Ask} ask */
  function remember(key, ask) {
    asking.delete(key);
    asking.set(key, ask);
    for (const oldest of asking.keys()) {
      if (asking.size <= MAX_ASKING) break;
      asking.delete(oldest);
    }
  }

  /** @param {string} sessionId */
  function forgetSession(sessionId) {
    for (const [key, ask] of asking) if (ask.sessionId === sessionId) asking.delete(key);
  }

  /**
   * Starts, replaces or ends the dialog this event concerns.
   * @param {Record<string, any>} event
   * @param {number} t
   */
  function track(event, t) {
    const sessionId = text(event.session_id);
    const key = askKey(sessionId, normalizeAgentId(event.agent_id));
    switch (event.hook_event_name) {
      case 'PermissionRequest':
        // A new request from the same agent: its previous dialog was answered.
        remember(key, newAsk(sessionId, t, t + delayMs, event));
        break;
      case 'Notification':
        // Claude Code's own notice of a dialog: news only if its request never reached the town.
        if (event.notification_type !== 'permission_prompt' || [...asking.values()].some((ask) => ask.sessionId === sessionId)) return;
        remember(key, newAsk(sessionId, t, t + delayMs, null));
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'PermissionDenied':
        if (!answers(event, asking.get(key))) return;
        asking.delete(key);
        break;
      case 'Stop':
        // Codex's Interrupt arrives as an interrupted Stop: you are at that session's terminal.
        if (event.stop_reason === 'interrupted') forgetSession(sessionId);
        else asking.delete(key);
        break;
      case 'SubagentStop':
        asking.delete(key);
        break;
      case 'UserPromptSubmit':
      case 'SessionEnd':
        forgetSession(sessionId);
        break;
      default:
        return;
    }
    schedule();
  }

  return {
    get on() {
      return Boolean(url);
    },
    url,
    /** @param {Record<string, any>} event  a local town payload, before it is sanitized */
    observe(event) {
      if (!url || disposed || !isObject(event)) return;
      const t = now();
      for (const [key, ask] of asking) if (t - ask.since >= ASK_MAX_AGE_MS) asking.delete(key);
      const sessionId = text(event.session_id);
      idle.stop(sessionId);
      track(event, t);
      if (isCodexLeadStop(event)) idle.start(sessionId);
      const note = noteFor(event);
      if (note && note.kind !== 'permission') void send(note);
    },
    /**
     * Every change of an approval (the broker's onChange). Only a decision in the town proves a
     * dialog answered. An expired or released approval went back to the terminal, where the agent
     * still waits; a resolved one is the broker's guess, by tool name only, from the same tool
     * results observe() has already judged by their input.
     * @param {import('./approvals.mjs').Approval} approval
     */
    approvalChanged(approval) {
      if (!url || disposed) return;
      if (approval.status === 'pending') {
        // Only a held approval can be decided in the town. A release republishes one as pending
        // with held false: not a new dialog.
        const ask = asking.get(askKey(approval.sessionId, approval.agentId));
        if (approval.held && ask && ask.approvalId === null) ask.approvalId = approval.id;
        return;
      }
      if (approval.status !== 'allowed' && approval.status !== 'denied') return;
      for (const [key, ask] of asking) if (ask.approvalId === approval.id) asking.delete(key);
      schedule();
    },
    /** A test note, from the town's Settings. */
    test: () => send(noteOf('test')),
    /** Drops every note still waiting and sends none afterwards (server shutdown). */
    dispose() {
      disposed = true;
      if (askTimer !== null) clearTimer(askTimer);
      askTimer = null;
      asking.clear();
      idle.clear();
    },
  };
}
