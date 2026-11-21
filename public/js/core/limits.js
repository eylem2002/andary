// Plan limits (the 5-hour and weekly limits, and a gateway's spend limit), as Claude Code reports
// them to the opt-in andary-limits mod (CONTRACTS §4.14): their names, the words the town and the
// phone use for them, and when the pace of use would run one out before it resets. Pure, so the
// server's phone note and the town say the same thing (docs/design/agent-health.md §9).
import { isObject } from './text.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The order the gauges are listed in; other kinds follow, by name. */
const KIND_ORDER = Object.freeze(['five_hour', 'seven_day', 'spend_limit']);

/** What Claude Code calls each limit it reports (`$.session.usage().rateLimits[].kind`). */
const NAMES = Object.freeze({ five_hour: '5-hour limit', seven_day: 'Weekly limit', spend_limit: 'Spend limit' });

/**
 * How long each window lasts. A window opens with the first request after the last one closed,
 * so it opened one length before it resets. A spend limit's period is not reported: no pace.
 */
const WINDOW_MS = Object.freeze({ five_hour: 5 * HOUR_MS, seven_day: 7 * DAY_MS });

/** No projection before this share of a window has passed: an early pace says little. */
const EARLIEST_PROJECTION = 0.1;

/** From here a gauge reads "warn", and from HIGH_PERCENT "high" (the optional phone note's mark). */
const WARN_PERCENT = 75;
export const HIGH_PERCENT = 90;
/**
 * Two reset times this close belong to one window (a window lasts five hours at the least), so a
 * few seconds' difference between two sessions' readings is the same window.
 */
export const SAME_WINDOW_MS = HOUR_MS;

const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

/**
 * @typedef {object} Limit          one limit as the server keeps it
 * @property {string} kind          five_hour, seven_day, spend_limit, or one a later Claude Code adds
 * @property {number} percentUsed   0–100
 * @property {number} resetsAt      ms
 * @property {number} at            when the reading that carried it arrived (ms)
 * @typedef {object} AccountLimits  one Claude account's limits (CONTRACTS §4.14)
 * @property {string} account       an opaque key: "default", or one per Claude config folder
 * @property {string|null} label    that folder's name, to tell accounts apart
 * @property {string|null} claudeVersion  the Claude Code that sent the newest reading
 * @property {number} at            the newest reading
 * @property {Limit[]} limits
 * @typedef {object} Gauge          what the town shows for one limit
 * @property {string} kind
 * @property {string} name          "5-hour limit"
 * @property {number} percent       0–100, whole, rounded down (the figure the meter draws)
 * @property {number} percentUsed   as reported (one decimal): the level and the order go by it
 * @property {'ok'|'warn'|'high'} level
 * @property {string} used          "42% used", "99.5% used", "used up"
 * @property {string} asOf          "as of 14:02"
 * @property {string} resets        "resets at 15:40"
 * @property {string|null} projection  "At this pace it runs out around 15:10, before it resets."
 */

/**
 * "5-hour limit", "Weekly limit", "Spend limit"; a kind a later Claude Code adds reads as itself
 * ("seven_day_opus" → "Seven day opus limit").
 * @param {string} kind
 */
export function limitName(kind) {
  if (Object.hasOwn(NAMES, kind)) return NAMES[/** @type {keyof typeof NAMES} */ (kind)];
  const words = String(kind).replace(/_/g, ' ').trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)} limit` : 'Limit';
}

/** "15:40": 24-hour, in this computer's time zone. @param {number} ms */
function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Which day a moment is on, seen from `now`: "" (today), "tomorrow", "yesterday", a weekday within
 * the week either side, else a date ("28 Nov").
 * @param {number} ms
 * @param {number} now
 */
function dayWords(ms, now) {
  const day = new Date(ms);
  const today = new Date(now);
  // Calendar days, not 24-hour steps: 23:50 and 00:10 are on two days.
  const days = Math.round((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
  if (days === 0) return '';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (Math.abs(days) < 7) return WEEKDAYS[day.getDay()];
  return `${day.getDate()} ${MONTHS[day.getMonth()]}`;
}

/**
 * When a limit resets: "resets at 15:40", "resets tomorrow at 09:00", "resets on Tue at 09:00".
 * @param {number} resetsAt
 * @param {number} now
 */
export function resetWords(resetsAt, now) {
  const day = dayWords(resetsAt, now);
  if (!day) return `resets at ${clock(resetsAt)}`;
  return day === 'tomorrow' ? `resets tomorrow at ${clock(resetsAt)}` : `resets on ${day} at ${clock(resetsAt)}`;
}

/**
 * When a reading was taken: "as of 14:02", "as of yesterday 14:02", "as of Tue 14:02".
 * @param {number} at
 * @param {number} now
 */
export function asOfWords(at, now) {
  const day = dayWords(at, now);
  return day ? `as of ${day} ${clock(at)}` : `as of ${clock(at)}`;
}

/**
 * When the pace of use would run a limit out before it resets, or null. The pace is the average
 * since the window opened (it opened one window length before it resets), as of the reading:
 * percent used ÷ time since it opened. A limit without a known length (a spend limit), one used
 * up, one read in the first tenth of its window, or one whose run-out time is past (no newer
 * reading came, so the pace slowed) gets none.
 * @param {Limit} limit
 * @param {number} now
 * @returns {number|null} ms
 */
export function runOutAt(limit, now) {
  const length = Object.hasOwn(WINDOW_MS, limit.kind) ? WINDOW_MS[/** @type {keyof typeof WINDOW_MS} */ (limit.kind)] : 0;
  if (!length || limit.percentUsed <= 0 || limit.percentUsed >= 100) return null;
  const opened = limit.resetsAt - length;
  const elapsed = limit.at - opened;
  if (elapsed < length * EARLIEST_PROJECTION || elapsed > length) return null;
  const runOut = opened + (elapsed * 100) / limit.percentUsed;
  return runOut < limit.resetsAt && runOut > now ? runOut : null;
}

/**
 * The figure for a percent used: rounded down, so 89.5 never reads as 90 while the phone note (at
 * 90) stays quiet, and with one decimal from 99, where a whole number would hide what is left.
 * "used up" only at 100.
 * @param {number} raw
 */
export function usedWords(raw) {
  if (raw >= 100) return 'used up';
  return raw >= 99 ? `${Math.floor(raw * 10) / 10}% used` : `${Math.floor(raw)}% used`;
}

/** @param {number} percent  as reported @returns {'ok'|'warn'|'high'} */
function levelOf(percent) {
  if (percent >= HIGH_PERCENT) return 'high';
  return percent >= WARN_PERCENT ? 'warn' : 'ok';
}

/**
 * The limits that still apply: a window that has reset says nothing about the next one (Claude
 * Code drops it too). In the order the town lists them.
 * @param {Limit[]} limits
 * @param {number} now
 */
export function currentLimits(limits, now) {
  const rank = (/** @type {string} */ kind) => (KIND_ORDER.includes(kind) ? KIND_ORDER.indexOf(kind) : KIND_ORDER.length);
  return limits.filter((limit) => limit.resetsAt > now).sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind));
}

/**
 * "around 15:20", "tomorrow around 09:10", "on Mon around 12:00".
 * @param {number} runOut
 * @param {number} now
 */
function runOutWhen(runOut, now) {
  const day = dayWords(runOut, now);
  if (!day) return `around ${clock(runOut)}`;
  return day === 'tomorrow' ? `tomorrow around ${clock(runOut)}` : `on ${day} around ${clock(runOut)}`;
}

/**
 * What the town shows for each limit that still applies.
 * @param {Limit[]} limits
 * @param {number} now
 * @returns {Gauge[]}
 */
export function limitGauges(limits, now) {
  return currentLimits(limits, now).map((limit) => {
    const runOut = runOutAt(limit, now);
    return {
      kind: limit.kind,
      name: limitName(limit.kind),
      percent: Math.floor(limit.percentUsed),
      percentUsed: limit.percentUsed,
      level: levelOf(limit.percentUsed),
      used: usedWords(limit.percentUsed),
      asOf: asOfWords(limit.at, now),
      resets: resetWords(limit.resetsAt, now),
      projection: runOut === null ? null : `At this pace it runs out ${runOutWhen(runOut, now)}, before it resets.`,
    };
  });
}

/**
 * The gauge for the Usage button: the most used limit of any account (the first to run out is
 * the one that stops work), or null when none applies.
 * @param {AccountLimits[]} accounts
 * @param {number} now
 * @returns {Gauge|null}
 */
export function busiestGauge(accounts, now) {
  /** @type {Gauge|null} */
  let busiest = null;
  for (const account of accounts) {
    for (const gauge of limitGauges(account.limits, now)) if (!busiest || gauge.percentUsed > busiest.percentUsed) busiest = gauge;
  }
  return busiest;
}

/** @param {unknown} n @returns {n is number} */
const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * One limit from the server, or null (it crosses the network, so it is read defensively).
 * @param {unknown} raw
 * @returns {Limit|null}
 */
function readLimit(raw) {
  if (!isObject(raw) || typeof raw.kind !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(raw.kind)) return null;
  if (!isNumber(raw.percentUsed) || !isNumber(raw.resetsAt) || !isNumber(raw.at)) return null;
  return { kind: raw.kind, percentUsed: Math.min(100, Math.max(0, raw.percentUsed)), resetsAt: raw.resetsAt, at: raw.at };
}

/**
 * The accounts in a `limits` message or the hello's `limits` (CONTRACTS §4.14), read defensively.
 * @param {unknown} raw
 * @returns {AccountLimits[]}
 */
export function readAccounts(raw) {
  const list = isObject(raw) && Array.isArray(raw.accounts) ? raw.accounts : [];
  return list.slice(0, 8).flatMap((item) => {
    if (!isObject(item) || typeof item.account !== 'string' || !isNumber(item.at)) return [];
    const limits = Array.isArray(item.limits) ? item.limits.slice(0, 8).map(readLimit).filter((limit) => limit !== null) : [];
    return [{
      account: item.account,
      label: typeof item.label === 'string' ? item.label.slice(0, 40) : null,
      claudeVersion: typeof item.claudeVersion === 'string' ? item.claudeVersion.slice(0, 64) : null,
      at: item.at,
      limits,
    }];
  });
}
