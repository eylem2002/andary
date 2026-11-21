// Plan limits from the opt-in andary-limits mod (CONTRACTS §4.14): the 5-hour and weekly limits
// (and a gateway's spend limit) that Claude Code reports to a mod after each turn, kept per Claude
// account, and each session's exact context. The mod sends numbers only; they come from a local
// program that holds the hook secret, but they are still read defensively and bounded, as
// everything that arrives over the wire.
//
// An account is told apart by the Claude config folder the session runs with (CLAUDE_CONFIG_DIR,
// or the default one): limits belong to an account, not to a session, and two accounts on one
// computer almost always mean two config folders. A report updates the limits it carries; one
// that carries none (an API key, or a session before its first answer) keeps what the account
// had, until each limit's reset time passes.
import { createHash } from 'node:crypto';
import { HttpError } from './http-util.mjs';
import { currentLimits } from '../public/js/core/limits.js';
import { isObject } from '../public/js/core/text.js';

/** @typedef {import('../public/js/core/limits.js').Limit} Limit */
/** @typedef {import('../public/js/core/limits.js').AccountLimits} AccountLimits */

/** A report is a few hundred bytes; anything much larger is not one. */
export const LIMITS_BODY_BYTES = 16 * 1024;
/** Limits in one report, accounts kept, sessions whose context is kept. */
const MAX_LIMITS = 8;
const MAX_ACCOUNTS = 8;
const MAX_SESSIONS = 100;
/** A context no model has: anything larger is not a reading. */
const MAX_TOKENS = 100_000_000;
const DAY_MS = 86_400_000;
/** A weekly limit resets within 7 days, a spend limit's period may be a month. */
const LATEST_RESET_MS = 32 * DAY_MS;

/**
 * @typedef {object} LimitsReport  a report as the server reads it
 * @property {string} account
 * @property {string|null} label
 * @property {string|null} sessionId
 * @property {string|null} claudeVersion
 * @property {{ kind: string, percentUsed: number, resetsAt: number }[]} limits
 * @property {{ tokens: number, window: number }|null} context
 */

/** @param {unknown} value @param {RegExp} pattern @param {number} max */
function textOrNull(value, pattern, max) {
  return typeof value === 'string' && value.length <= max && pattern.test(value) ? value : null;
}

/** @param {unknown} n @param {number} min @param {number} max */
function wholeIn(n, min, max) {
  return Number.isInteger(n) && /** @type {number} */ (n) >= min && /** @type {number} */ (n) <= max;
}

/**
 * The limits of a report: well-formed items only (a kind once), reset times that are plausible
 * (not more than a day in the past, at most 32 days ahead), percents within 0–100.
 * @param {unknown} raw
 * @param {number} now
 */
function readLimits(raw, now) {
  /** @type {LimitsReport['limits']} */
  const out = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, MAX_LIMITS) : []) {
    if (!isObject(item) || typeof item.kind !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(item.kind)) continue;
    if (out.some((limit) => limit.kind === item.kind)) continue;
    const percent = typeof item.percentUsed === 'number' && Number.isFinite(item.percentUsed) ? item.percentUsed : NaN;
    const resetsAt = typeof item.resetsAt === 'string' && item.resetsAt.length <= 40 ? Date.parse(item.resetsAt) : NaN;
    if (Number.isNaN(percent) || !Number.isFinite(resetsAt) || resetsAt < now - DAY_MS || resetsAt > now + LATEST_RESET_MS) continue;
    out.push({ kind: item.kind, percentUsed: Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10, resetsAt });
  }
  return out;
}

/**
 * The account a config folder stands for: "default" without one, else a key derived from it
 * (the path itself never leaves the server) and the folder's name as its label.
 * @param {unknown} configDir
 */
function accountOf(configDir) {
  // eslint-disable-next-line no-control-regex -- a NUL in a path is not a path
  if (typeof configDir !== 'string' || configDir === '' || configDir.length > 4096 || /\u0000/.test(configDir)) return { account: 'default', label: null };
  const folder = configDir.replace(/(.)[\\/]+$/, '$1');
  const name = folder.split(/[\\/]/).pop() || folder;
  return { account: `dir-${createHash('sha256').update(folder).digest('base64url').slice(0, 16)}`, label: name.slice(0, 40) };
}

/**
 * Validates the mod's body: {"v":1,"sessionId","claudeVersion","configDir","limits":[…],"context"}.
 * Fields that are missing or malformed read as null (or are left out of `limits`); a body that is
 * not a version-1 object is refused.
 * @param {Buffer} raw
 * @param {number} now
 * @returns {LimitsReport}
 */
export function parseLimitsReport(raw, now) {
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  if (!isObject(body) || body.v !== 1) throw new HttpError(400, 'Body must look like {"v":1,"limits":[...]}');
  const context = isObject(body.context) && wholeIn(body.context.tokens, 0, MAX_TOKENS) && wholeIn(body.context.window, 1, MAX_TOKENS) ? { tokens: body.context.tokens, window: body.context.window } : null;
  return {
    ...accountOf(body.configDir),
    sessionId: textOrNull(body.sessionId, /^[\w.:-]+$/, 200),
    claudeVersion: textOrNull(body.claudeVersion, /^\d+\.\d+\.\d+[\w.+-]*$/, 64),
    limits: readLimits(body.limits, now),
    context,
  };
}

/**
 * Keeps a Map's newest `max` entries: a key set again moves to the end.
 * @template T
 * @param {Map<string, T>} map
 * @param {string} key
 * @param {T} value
 * @param {number} max
 */
function keepNewest(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value ?? '');
}

/**
 * @typedef {object} LimitsSnapshot  what owners receive (hello `limits`, and each `limits` message)
 * @property {AccountLimits[]} accounts  newest first; limits whose window reset are left out
 * @property {Record<string, { tokens: number, window: number, at: number }>} contexts
 *   each session's newest exact context; the town does not show it yet (design §5 will)
 */

/**
 * @param {{ onChange?: (snapshot: LimitsSnapshot, account: AccountLimits) => void, now?: () => number }} [options]
 */
export function createLimitsTracker({ onChange = () => {}, now = Date.now } = {}) {
  /** @type {Map<string, { account: string, label: string|null, claudeVersion: string|null, at: number, limits: Map<string, Limit> }>} */
  const accounts = new Map();
  /** @type {Map<string, { tokens: number, window: number, at: number }>} */
  const contexts = new Map();

  /** @param {string} key @param {number} t @returns {AccountLimits} */
  function accountRecord(key, t) {
    const kept = /** @type {NonNullable<ReturnType<typeof accounts.get>>} */ (accounts.get(key));
    return { account: kept.account, label: kept.label, claudeVersion: kept.claudeVersion, at: kept.at, limits: currentLimits([...kept.limits.values()], t) };
  }

  /** @returns {LimitsSnapshot} */
  function snapshot() {
    const t = now();
    return { accounts: [...accounts.keys()].reverse().map((key) => accountRecord(key, t)), contexts: Object.fromEntries(contexts) };
  }

  return {
    /**
     * A report from the mod: its account's limits and its session's context.
     * @param {LimitsReport} report
     */
    observe(report) {
      const t = now();
      const kept = accounts.get(report.account) ?? { account: report.account, label: report.label, claudeVersion: null, at: t, limits: new Map() };
      for (const limit of report.limits) kept.limits.set(limit.kind, { ...limit, at: t });
      Object.assign(kept, { label: report.label, at: t, claudeVersion: report.claudeVersion ?? kept.claudeVersion });
      keepNewest(accounts, report.account, kept, MAX_ACCOUNTS);
      if (report.sessionId && report.context) keepNewest(contexts, report.sessionId, { ...report.context, at: t }, MAX_SESSIONS);
      onChange(snapshot(), accountRecord(report.account, t));
    },
    snapshot,
  };
}
