// Validation for command-line values. Bad input raises UsageError (exit code 2) with a message
// that says what was expected.
import { DEFAULT_PORT, MAX_APPROVAL_TIMEOUT_MS } from '../config.mjs';
import { SCOPES } from '../installer.mjs';

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
