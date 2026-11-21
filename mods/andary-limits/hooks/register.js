// The andary-limits mod (CONTRACTS §4.14): an opt-in Claude Code plugin whose hooks module runs
// inside Claude Code (v2.1.287 or newer). After each turn, and when a plan limit's percent used
// changes, Claude Code raises `session.measure`; the module reads `$.session.usage()` and sends
// the numbers only (each limit's kind, percent used and reset time, the exact context tokens and
// window, the session id and Claude Code's version) to the Andary server on this computer.
// It never takes over the status line: that would hide some of Claude Code's footer hints and
// would have to run the user's own status line command for it.
//
// It must never get in the session's way. The hook returns at once and the report goes out on
// its own (no waiting on Andary, well inside the hook's 10-second limit); nothing it does can
// throw into the session; with no Andary running it reads one small file and stops.
//
// It proves itself to the server exactly as the hook forwarder does (hooks/hook.mjs, §4.3): it
// reads server.json, which only this user can read, asks the server to prove it holds that file's
// response key (HMAC-SHA256 over a fresh nonce, built here on crypto.subtle.digest, the one part of
// Web Crypto the hooks sandbox has) before it sends anything, and
// then sends the hook secret with the report. A stale server.json whose port someone else now
// holds learns neither the numbers nor the secret.
//
// A hooks module has no Node.js APIs and no timers; it reaches files and the network only
// through `$`, and Claude Code checks statically that every `$` call is written in full. So the
// functions that take `$` are declared at the top of this file and never store it.

/**
 * The part of Claude Code's mods API this module uses (`$`).
 * @typedef {object} ModsApi
 * @property {{ usage: () => Promise<any>, id: () => Promise<unknown>, version: () => Promise<any> }} session
 * @property {{ get: (name: string) => Promise<unknown> }} env
 * @property {{ read: (path: string) => Promise<string> }} fs
 * @property {{ fetch: (url: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) => Promise<{ status: number, ok: boolean, headers: Record<string, string>, text: string }> }} http
 */

const PROOF_PREFIX = 'andary-proof\n';
/** Limits in one report: Claude Code reports up to three today. */
const MAX_LIMITS = 8;

/**
 * Whether a report is on its way, and whether another reading came meanwhile: readings that come
 * while one is sent make one more report, of the newest numbers, so reports never pile up.
 * @type {{ busy: boolean, again: boolean, done: Promise<void> }}
 */
const flight = { busy: false, again: false, done: Promise.resolve() };

/**
 * Called by Claude Code when the module loads.
 * @param {(event: string, hook: (...args: any[]) => any) => unknown} on
 */
export function register(on) {
  on('session.measure', measured);
}

/**
 * The `session.measure` hook: starts a report and passes the event on at once.
 * @param {ModsApi} $
 * @param {unknown} e
 * @param {(e: unknown) => unknown} next
 */
async function measured($, e, next) {
  if (flight.busy) {
    flight.again = true;
  } else {
    flight.busy = true;
    flight.done = reportAll($).then(() => {
      flight.busy = false;
    });
  }
  return next(e);
}

/**
 * The report under way, for tests: resolves once nothing is being sent.
 * @returns {Promise<void>}
 */
export function settled() {
  return flight.done;
}

/**
 * Sends reports until no newer reading has come. Never rejects: Andary not running, a refused
 * call or a network error ends that report and nothing else.
 * @param {ModsApi} $
 */
async function reportAll($) {
  do {
    flight.again = false;
    try {
      await reportOnce($);
    } catch {
      // nothing to do: the next turn reports again
    }
  } while (flight.again);
}

/**
 * One report: find the server, check its proof, read the numbers, post them.
 * @param {ModsApi} $
 */
async function reportOnce($) {
  const state = await readServerState($);
  if (!state) return;
  const base = baseUrl(state);
  if (!(await serverProves($, base, state.responseKey))) return;
  const report = await readReport($);
  await $.http.fetch(`${base}/api/limits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-andary-secret': state.secret },
    body: JSON.stringify(report),
  });
}

/**
 * Andary's folder: ANDARY_HOME, or ~/.andary (as the forwarder finds it).
 * @param {ModsApi} $
 * @returns {Promise<string|null>}
 */
async function andaryHome($) {
  const set = await $.env.get('ANDARY_HOME');
  if (typeof set === 'string' && set !== '') return set.replace(/[\\/]+$/, '');
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'));
  return typeof home === 'string' && home !== '' ? `${home.replace(/[\\/]+$/, '')}/.andary` : null;
}

/**
 * The running server's port, address and keys from server.json, or null when there is none.
 * @param {ModsApi} $
 * @returns {Promise<{ port: number, host: string, secret: string, responseKey: string }|null>}
 */
async function readServerState($) {
  const home = await andaryHome($);
  if (!home) return null;
  let state;
  try {
    state = JSON.parse(await $.fs.read(`${home}/server.json`));
  } catch {
    return null;
  }
  const valid = Number.isInteger(state?.port) && state.port > 0 && state.port < 65536 && typeof state.secret === 'string' && typeof state.responseKey === 'string' && state.responseKey !== '';
  return valid ? { port: state.port, host: typeof state.host === 'string' ? state.host : '', secret: state.secret, responseKey: state.responseKey } : null;
}

/**
 * Where this computer reaches the server: a wildcard address means 127.0.0.1.
 * @param {{ port: number, host: string }} state
 */
function baseUrl({ port, host }) {
  const name = !host || host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host.replace(/^\[|\]$/g, '');
  return `http://${name.includes(':') ? `[${name}]` : name}:${port}`;
}

/** @param {Uint8Array} bytes */
function toBase64Url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text @returns {Uint8Array|null} */
function fromBase64Url(text) {
  if (!/^[\w-]{1,200}$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** SHA-256's block size, for HMAC. */
const BLOCK_BYTES = 64;

/** @param {Uint8Array<ArrayBuffer>} bytes @returns {Promise<Uint8Array<ArrayBuffer>>} */
async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * HMAC-SHA256 (RFC 2104), built on SHA-256: Claude Code's hooks sandbox offers crypto.subtle's
 * digest() and nothing else of it (no importKey, sign or verify).
 * @param {Uint8Array<ArrayBuffer>} key
 * @param {Uint8Array<ArrayBuffer>} message
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function hmacSha256(key, message) {
  const short = key.length > BLOCK_BYTES ? await sha256(key) : key;
  const inner = new Uint8Array(BLOCK_BYTES + message.length);
  const outer = new Uint8Array(BLOCK_BYTES + 32);
  for (let i = 0; i < BLOCK_BYTES; i += 1) {
    const byte = short[i] ?? 0;
    inner[i] = byte ^ 0x36;
    outer[i] = byte ^ 0x5c;
  }
  inner.set(message, BLOCK_BYTES);
  outer.set(await sha256(inner), BLOCK_BYTES);
  return sha256(outer);
}

/**
 * Compares two byte strings without stopping at the first difference.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Whether the server on that port is the one that wrote server.json: it must answer
 * GET /api/proof with HMAC-SHA256(responseKey, "andary-proof\n" + nonce) for a fresh nonce
 * (the server keys the HMAC with the key's text, as the forwarder does). Nothing else is sent
 * first, not even the hook secret.
 * @param {ModsApi} $
 * @param {string} base
 * @param {string} responseKey
 */
async function serverProves($, base, responseKey) {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const answer = await $.http.fetch(`${base}/api/proof`, { method: 'GET', headers: { 'x-andary-nonce': nonce } });
  const proof = answer?.status === 200 ? fromBase64Url(String(answer.headers?.['x-andary-proof'] ?? '')) : null;
  if (!proof) return false;
  const encoder = new TextEncoder();
  return sameBytes(proof, await hmacSha256(encoder.encode(responseKey), encoder.encode(`${PROOF_PREFIX}${nonce}`)));
}

/**
 * Each limit's kind, percent used and reset time, as Claude Code gives them.
 * @param {unknown} list
 */
function limitsOf(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_LIMITS)
    .filter((item) => typeof item?.kind === 'string' && Number.isFinite(item.percentUsed) && typeof item.resetsAt === 'string')
    .map((item) => ({ kind: item.kind, percentUsed: item.percentUsed, resetsAt: item.resetsAt }));
}

/**
 * The exact context in use and the window it fills, or null before the first answer (Claude
 * Code then gives the window alone).
 * @param {any} context
 */
function contextOf(context) {
  return Number.isFinite(context?.tokens) && Number.isFinite(context?.window) ? { tokens: Math.round(context.tokens), window: Math.round(context.window) } : null;
}

/**
 * The report: numbers and identifiers only. The config folder tells two Claude accounts on this
 * computer apart (the server keeps limits per account); the server keeps only a key made from it
 * and the folder's name.
 * @param {ModsApi} $
 */
async function readReport($) {
  const usage = await $.session.usage();
  const sessionId = await $.session.id().catch(() => null);
  const version = await $.session.version().catch(() => null);
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => null);
  return {
    v: 1,
    sessionId: typeof sessionId === 'string' ? sessionId : null,
    claudeVersion: typeof version?.version === 'string' ? version.version : null,
    configDir: typeof configDir === 'string' && configDir !== '' ? configDir : null,
    limits: limitsOf(usage?.rateLimits),
    context: contextOf(usage?.context),
  };
}
