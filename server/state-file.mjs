// server.json in ANDARY_HOME: how the forwarder and the CLI find the running server.
// It holds the hook secret and the UI token, so it is written with mode 0600 inside a 0700 folder.
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ID } from './config.mjs';
import { connectHost, hostWithPort } from './security.mjs';

export const STATE_FILE = 'server.json';

/**
 * @typedef {object} ServerState
 * @property {number} pid
 * @property {number} port
 * @property {string} host
 * @property {string} secret      authenticates hooks
 * @property {string} uiToken     authenticates browsers
 * @property {string} version
 * @property {number} startedAt
 * @property {number} approvalTimeoutMs
 */

/**
 * @param {string} home
 * @returns {string}
 */
export function stateFilePath(home) {
  return join(home, STATE_FILE);
}

/**
 * Creates the home folder, private to the user.
 * @param {string} home
 */
export function ensureHome(home) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
}

/**
 * Writes server.json atomically (temp file + rename) with mode 0600.
 * @param {string} home
 * @param {ServerState} state
 * @returns {string} the file path
 */
export function writeStateFile(home, state) {
  ensureHome(home);
  const target = stateFilePath(home);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  // The mode passed to writeFileSync is filtered by the umask; set it explicitly.
  chmodSync(temp, 0o600);
  renameSync(temp, target);
  return target;
}

/**
 * @param {string} home
 * @returns {ServerState|null} null when missing, unreadable or malformed
 */
export function readStateFile(home) {
  try {
    const state = JSON.parse(readFileSync(stateFilePath(home), 'utf8'));
    return isServerState(state) ? state : null;
  } catch {
    return null;
  }
}

/**
 * @param {any} value
 * @returns {value is ServerState}
 */
function isServerState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    value.port < 65536 &&
    typeof value.secret === 'string' &&
    typeof value.uiToken === 'string'
  );
}

/**
 * Removes server.json if it still belongs to us: same pid and, when given, the same secret (a
 * newer server may have replaced the file).
 * @param {string} home
 * @param {{ pid?: number, secret?: string }} [owner]
 * @returns {boolean} whether the file was removed
 */
export function removeStateFileIfOwned(home, { pid = process.pid, secret } = {}) {
  const state = readStateFile(home);
  if (!state || state.pid !== pid || (secret !== undefined && state.secret !== secret)) return false;
  try {
    unlinkSync(stateFilePath(home));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Pick<ServerState, 'host'|'port'>} state
 * @returns {string} e.g. http://127.0.0.1:4747
 */
export function serverOrigin(state) {
  return `http://${hostWithPort(connectHost(state.host), state.port)}`;
}

/**
 * The sign-in link: opening it stores the UI token in a cookie and redirects to the town.
 * @param {Pick<ServerState, 'host'|'port'|'uiToken'>} state
 * @param {Record<string, string>} [params] extra query parameters, e.g. { demo: '1' }
 * @returns {string}
 */
export function loginUrl(state, params = {}) {
  const query = new URLSearchParams({ token: state.uiToken, ...params });
  return `${serverOrigin(state)}/?${query}`;
}

/**
 * Asks a server for /api/hello; resolves with the reply if it is an Andary server.
 * @param {Pick<ServerState, 'host'|'port'>} state
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, any>|null>}
 */
export async function probeServer(state, timeoutMs = 1500) {
  try {
    const res = await fetch(`${serverOrigin(state)}/api/hello`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const hello = await res.json();
    return hello?.app === APP_ID ? hello : null;
  } catch {
    return null;
  }
}

/**
 * The state of a live server for this home, or null (no file, stale file, or not answering).
 * @param {string} home
 * @returns {Promise<ServerState|null>}
 */
export async function findRunningServer(home) {
  const state = readStateFile(home);
  if (!state) return null;
  return (await probeServer(state)) ? state : null;
}
