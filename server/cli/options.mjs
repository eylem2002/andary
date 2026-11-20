// Validation for command-line values. Bad input raises UsageError (exit code 2) with a message
// that says what was expected.
import { DEFAULT_PORT, MAX_APPROVAL_TIMEOUT_MS } from '../config.mjs';
import { SCOPES } from '../installer.mjs';
import { checkNotifyUrl } from '../notify.mjs';
import { cleanMemberName } from '../team.mjs';

export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * --port, else ANDARY_PORT, else 4747. 0 asks the OS for a free port.
 * @param {string|undefined} value
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
export function parsePort(value, env) {
  const raw = value ?? env.ANDARY_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Port must be a whole number from 0 to 65535 (got "${raw}").`);
  }
  return port;
}

/**
 * --approval-timeout in seconds → milliseconds, capped below the hook's own 150 s timeout.
 * @param {string|undefined} value
 * @param {(warning: string) => void} warn
 * @returns {number|undefined}
 */
export function parseApprovalTimeout(value, warn) {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new UsageError(`--approval-timeout takes a number of seconds greater than 0 (got "${value}").`);
  }
  const ms = Math.round(seconds * 1000);
  if (ms > MAX_APPROVAL_TIMEOUT_MS) {
    warn(`--approval-timeout is capped at ${MAX_APPROVAL_TIMEOUT_MS / 1000} s: Claude Code stops waiting for the hook at 150 s.`);
    return MAX_APPROVAL_TIMEOUT_MS;
  }
  return ms;
}

/**
 * @param {string|undefined} value
 * @returns {number}
 */
export function parseSpeed(value) {
  if (value === undefined) return 1;
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 1000) {
    throw new UsageError(`--speed takes a number greater than 0, up to 1000 (got "${value}").`);
  }
  return speed;
}

/**
 * @param {string|undefined} value
 * @returns {number|undefined}
 */
export function parseSeed(value) {
  if (value === undefined) return undefined;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed)) throw new UsageError(`--seed takes a whole number (got "${value}").`);
  return seed;
}

/**
 * @param {string|undefined} value
 * @returns {'user'|'project'|'local'}
 */
export function parseScope(value) {
  const scope = value ?? 'user';
  if (!SCOPES.includes(scope)) throw new UsageError(`--scope must be user, project or local (got "${scope}").`);
  return /** @type {'user'|'project'|'local'} */ (scope);
}

/**
 * --notify-url (or ANDARY_NOTIFY_URL): an http(s) ntfy topic URL, or null when not given.
 * @param {string|undefined} value
 * @returns {string|null}
 */
export function parseNotifyUrl(value) {
  if (value === undefined || value === '') return null;
  const url = checkNotifyUrl(value);
  if (!url) throw new UsageError(`--notify-url takes an ntfy topic URL such as https://ntfy.sh/my-private-topic (got "${value}").`);
  return url;
}


/**
 * A team host's base URL (for --share-to and `team invite --url`): http or https, no path.
 * @param {string} value
 * @param {string} flag  for the message
 * @returns {string} the origin, e.g. http://192.168.1.20:4747
 */
export function parseTeamUrl(value, flag) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new UsageError(`${flag} takes the team town's address, such as http://192.168.1.20:4747 (got "${value}").`);
  }
  return url.origin;
}

/**
 * --share-to and --team-key (or ANDARY_SHARE_TO and ANDARY_TEAM_KEY): both or neither.
 * @param {string|undefined} url
 * @param {string|undefined} key
 * @returns {{ url: string, key: string, member: string }|null}
 */
export function parseShareTo(url, key) {
  if (!url && !key) return null;
  if (!url || !key) throw new UsageError('Sharing with a team town needs both --share-to <address> and --team-key <key> (from "andary team invite" on the host).');
  const dot = key.lastIndexOf('.');
  const member = dot > 0 ? memberFromKey(key.slice(0, dot)) : null;
  if (!member || !/^[A-Za-z0-9_-]{32}$/.test(key.slice(dot + 1))) {
    throw new UsageError('--team-key does not look like a key from "andary team invite" (name.32-characters).');
  }
  return { url: parseTeamUrl(url, '--share-to'), key, member };
}

/** @param {string} encoded @returns {string|null} */
function memberFromKey(encoded) {
  try {
    return cleanMemberName(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}
