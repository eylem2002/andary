// Phone notifications through ntfy (https://ntfy.sh): free, no account, an app for Android and
// iOS. Opt-in with `andary start --notify` (a random private topic on ntfy.sh, kept in
// <ANDARY_HOME>/notify.json) or `--notify-url <url>` (your own ntfy server or topic). Messages
// say only what happened ("A crew needs your permission"), never a project, a file or a command,
// because anyone who knows the topic can read them. At most one of a kind every 30 seconds and
// 30 an hour (CONTRACTS §4.10).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const NTFY_SERVER = 'https://ntfy.sh';
const SAME_KIND_MS = 30_000;
const HOURLY_LIMIT = 30;
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
  waiting: { title: 'Andary', body: 'Claude is waiting for your next prompt.', priority: 'default', tags: 'hourglass' },
  finished: { title: 'Andary', body: 'A crew finished its turn.', priority: 'default', tags: 'white_check_mark' },
  limit: { title: 'Andary', body: 'Claude Code stopped: it hit a usage or rate limit.', priority: 'high', tags: 'warning' },
  stopped: { title: 'Andary', body: 'Claude Code stopped with an error.', priority: 'high', tags: 'warning' },
  test: { title: 'Andary', body: 'This is a test notification from your town.', priority: 'default', tags: 'tada' },
});

/**
 * The note a hook event deserves, or null. Only the main agent's turn ending counts as finished.
 * @param {Record<string, any>} event  a raw hook payload
 * @returns {Note|null}
 */
export function noteFor(event) {
  const name = event?.hook_event_name;
  /** @param {string} kind */
  const note = (kind) => ({ kind, ...NOTES[kind] });
  if (name === 'PermissionRequest') return note('permission');
  if (name === 'Notification') {
    if (event.notification_type === 'permission_prompt') return note('permission');
    if (event.notification_type === 'idle_prompt') return note('waiting');
    return null;
  }
  if (name === 'Stop' && !event.agent_id) return note('finished');
  if (name === 'StopFailure') return note(/rate|limit|quota|overload/i.test(String(event.error ?? '')) ? 'limit' : 'stopped');
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
 * @typedef {object} NotifierOptions
 * @property {string|null} url
 * @property {typeof fetch} [fetchImpl]
 * @property {() => number} [now]
 * @property {(message: string) => void} [log]
 */

/** @param {NotifierOptions} options */
export function createNotifier({ url, fetchImpl = globalThis.fetch, now = Date.now, log = () => {} }) {
  /** @type {Map<string, number>} */
  const lastByKind = new Map();
  /** @type {number[]} */
  let sentTimes = [];
  let warned = false;

  /**
   * Sends a note unless it is too soon after the same kind, or the hour's limit is reached.
   * @param {Note} note
   * @returns {Promise<boolean>} whether it was sent
   */
  async function send(note) {
    if (!url) return false;
    const t = now();
    if (t - (lastByKind.get(note.kind) ?? -Infinity) < SAME_KIND_MS) return false;
    sentTimes = sentTimes.filter((at) => t - at < 3_600_000);
    // Tests (at most one every 30 s) never use up the hour's budget for real notes.
    const counted = note.kind !== 'test';
    if (counted && sentTimes.length >= HOURLY_LIMIT) return false;
    lastByKind.set(note.kind, t);
    if (counted) sentTimes.push(t);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
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
  }

  return {
    get on() {
      return Boolean(url);
    },
    url,
    /** @param {Record<string, any>} event */
    observe(event) {
      const note = noteFor(event);
      if (note) void send(note);
    },
    /** A test note, from the town's Settings. */
    test: () => send({ kind: 'test', ...NOTES.test }),
  };
}
