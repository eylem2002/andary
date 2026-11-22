// server.json in ANDARY_HOME: how the forwarder and the CLI find the running server.
// It holds the hook secret and the UI token, so it is written with mode 0600 inside a 0700 folder.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UI_TOKEN_HEADER } from './auth.mjs';
import { APP_ID } from './config.mjs';
import { connectHost, hostWithPort } from './security.mjs';

const STATE_FILE = 'server.json';

/**
 * @typedef {object} ServerState
 * @property {number} pid
 * @property {number} port
 * @property {string} host
 * @property {string} secret      authenticates hooks
 * @property {string} uiToken     authenticates browsers
 * @property {string} [responseKey] signs the replies to the forwarder (never sent over the wire)
 * @property {string} version
 * @property {number} startedAt
 * @property {number} approvalTimeoutMs
 * @property {boolean} [team]     hosts a team town (§4.11)
 * @property {boolean} [tls]      serves HTTPS to the network (ADR 0016)
 * @property {string[]} [teamHosts]  names a team host is reached by (--team-host)
 * @property {{ url: string|null, pid?: number, port?: number, error?: string }} [tunnel]  a team
 *   host's Quick Tunnel (--tunnel, ADR 0019): its address, cloudflared's pid and the loopback port
 *   it forwards to while it runs; url null with the reason once it stopped
 */

/**
 * @param {string} home
 * @returns {string}
 */
function stateFilePath(home) {
  return join(home, STATE_FILE);
}

/**
 * Creates the home folder, private to the user, and checks one that already exists. It holds the
 * secrets and hook.mjs, which Claude Code runs for every event: a folder someone else owns or can
 * write to would let them swap either, so it is refused (another owner) or made private again.
 * Windows has no uid; the user profile's permissions protect the folder there.
 * @param {string} home
 * @param {{ uid?: number }} [owner] the expected owner (default: this process's user)
 */
export function ensureHome(home, { uid = process.getuid?.() } = {}) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (uid === undefined) return;
  const stat = statSync(home);
  if (stat.uid !== uid) {
    throw Object.assign(new Error(`${home} belongs to another user, so Andary will not keep its secrets there. Set ANDARY_HOME to a folder of your own.`), {
      code: 'EUNSAFEHOME',
    });
  }
  if ((stat.mode & 0o077) !== 0) chmodSync(home, 0o700);
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
  // Random and exclusive, so nothing already in the folder (a stale file, a link) is written through.
  const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
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
 * The sign-in link: opening it hands the UI token to the town's page, which keeps it for its own
 * origin only (ADR 0015).
 * @param {Pick<ServerState, 'host'|'port'|'uiToken'>} state
 * @param {Record<string, string>} [params] extra query parameters, e.g. { demo: '1' }
 * @returns {string}
 */
export function loginUrl(state, params = {}) {
  const query = new URLSearchParams({ token: state.uiToken, ...params });
  return `${serverOrigin(state)}/?${query}`;
}

/**
 * Whether a process with this pid runs as us (signal 0 only checks; EPERM means another user's).
 * @param {unknown} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || /** @type {number} */ (pid) <= 0) return false;
  try {
    process.kill(/** @type {number} */ (pid), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks a server for /api/hello; resolves with the reply if it is an Andary server. With `token`,
 * only a server that accepts that UI token counts, i.e. the one that wrote this server.json.
 * @param {Pick<ServerState, 'host'|'port'>} state
 * @param {number} [timeoutMs]
 * @param {{ token?: string }} [options]
 * @returns {Promise<Record<string, any>|null>}
 */
export async function probeServer(state, timeoutMs = 1500, { token } = {}) {
  try {
    const headers = token ? { [UI_TOKEN_HEADER]: token } : undefined;
    const res = await fetch(`${serverOrigin(state)}/api/hello`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const hello = await res.json();
    if (hello?.app !== APP_ID) return null;
    return token && hello.authenticated !== true ? null : hello;
  } catch {
    return null;
  }
}

/**
 * The state of a live server for this home, or null (no file, stale file, or not answering). A
 * stale file can name a pid the system has since given to another program, and its port can be
 * taken by something else, so both are checked: `stop` sends that pid a signal.
 * @param {string} home
 * @returns {Promise<ServerState|null>}
 */
export async function findRunningServer(home) {
  const state = readStateFile(home);
  if (!state || !isProcessAlive(state.pid)) return null;
  return (await probeServer(state, 1500, { token: state.uiToken })) ? state : null;
}
