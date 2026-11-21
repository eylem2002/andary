// Plan limits from the opt-in andary-limits mod (CONTRACTS §4.14): the 5-hour and weekly limits
// (and a gateway's spend limit) that Claude Code reports to a mod after each turn, kept per Claude
// account, and each session's exact context. The mod sends numbers only; they come from a local
// program that holds the hook secret, but they are still read defensively and bounded, as
// everything that arrives over the wire.
//
// An account is told apart by the Claude config folder the session runs with (CLAUDE_CONFIG_DIR,
// or the default ~/.claude, also when CLAUDE_CONFIG_DIR names it): limits belong to an account,
// not to a session, and two accounts on one computer almost always mean two config folders. A
// report updates the limits it carries; one that carries none (an API key, or a session before its
// first answer) keeps what the account had, until each limit's reset time passes. Every session
// of an account reports what it saw last, so within one window the higher reading stands: use
// only grows until the reset.
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from './http-util.mjs';
import { SAME_WINDOW_MS, currentLimits } from '../public/js/core/limits.js';
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
 * @property {string|null} configDir  CLAUDE_CONFIG_DIR as the session had it (null: the default)
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

/** A folder without trailing separators (the root keeps its one). @param {string} path */
const trimmed = (path) => path.replace(/(.)[\\/]+$/, '$1');

/**
 * The account a config folder stands for: "default" without one or for the default folder
 * itself, else a key derived from it (the path never leaves the server) and the folder's name as
 * its label.
 * @param {string|null} configDir
 * @param {string} defaultDir  the folder Claude Code uses without CLAUDE_CONFIG_DIR
 */
export function accountOf(configDir, defaultDir) {
  const folder = configDir === null ? null : trimmed(configDir);
  if (folder === null || folder === trimmed(defaultDir)) return { account: 'default', label: null };
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
  // eslint-disable-next-line no-control-regex -- a NUL in a path is not a path
  const configDir = typeof body.configDir === 'string' && body.configDir !== '' && body.configDir.length <= 4096 && !/\u0000/.test(body.configDir) ? body.configDir : null;
  return {
    configDir,
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
 * Whether a reading should replace the one kept: always for a new window (its reset time moved
 * on), within one window only when it is not lower, as another session may have seen less.
 * @param {Limit|undefined} kept
 * @param {{ percentUsed: number, resetsAt: number }} incoming
 */
function replaces(kept, incoming) {
  if (!kept || Math.abs(kept.resetsAt - incoming.resetsAt) >= SAME_WINDOW_MS) return true;
  return incoming.percentUsed >= kept.percentUsed;
}

/**
 * @param {{ onChange?: (snapshot: LimitsSnapshot, account: AccountLimits) => void, now?: () => number, defaultConfigDir?: string }} [options]
 *   defaultConfigDir: the folder Claude Code uses without CLAUDE_CONFIG_DIR (~/.claude)
 */
export function createLimitsTracker({ onChange = () => {}, now = Date.now, defaultConfigDir = join(homedir(), '.claude') } = {}) {
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
      const { account, label } = accountOf(report.configDir, defaultConfigDir);
      const kept = accounts.get(account) ?? { account, label, claudeVersion: null, at: t, limits: new Map() };
      for (const limit of report.limits) if (replaces(kept.limits.get(limit.kind), limit)) kept.limits.set(limit.kind, { ...limit, at: t });
      Object.assign(kept, { label, at: t, claudeVersion: report.claudeVersion ?? kept.claudeVersion });
      keepNewest(accounts, account, kept, MAX_ACCOUNTS);
      if (report.sessionId && report.context) keepNewest(contexts, report.sessionId, { ...report.context, at: t }, MAX_SESSIONS);
      onChange(snapshot(), accountRecord(account, t));
    },
    snapshot,
  };
}
