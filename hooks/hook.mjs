#!/usr/bin/env node
// Andary hook forwarder (CONTRACTS §4.3). Claude Code (or Codex, which runs it with the argument
// `codex`) runs this for every registered hook event: it passes the event to the local Andary
// server and, for PermissionRequest, prints the decision the town returned. Both agents read the
// same decision format.
//
// It must never get in Claude's way: it prints nothing but that decision object, it always exits
// 0, and when no server is running it exits at once. Before sending anything (the event, or the
// hook secret) it asks the server to prove it holds the key from server.json, so a program that
// took over the port of a server that is gone receives nothing. Self-contained (Node built-ins only),
// because `andary install` copies it to <ANDARY_HOME>/hook.mjs and the plugin runs it in
// place from its own folder.
//
// The decision is rebuilt, never copied: an allow, or a deny with a message. An allow may also
// save one permission rule ("Allow always"), but only a rule Claude Code itself suggested in this
// very hook's input, only an allow rule for this project (only you) or this session, and it is
// printed from that input, never from the server's reply.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// When the agent started this hook: the time this process started, which no import or start-up
// work below can delay. Two hooks started a millisecond apart keep their order this way (the
// clock read here would not: Node's start-up time varies by more than that).
const ts = Math.floor(performance.timeOrigin);
/** Who runs this hook: Codex passes `codex`; Claude Code passes nothing. */
const SOURCE = process.argv[2] === 'codex' ? 'codex' : null;
const EVENT_TIMEOUT_MS = 1500;
const APPROVAL_GRACE_MS = 5000;
const STDIN_TIMEOUT_MS = 3000;
const MAX_STDIN_BYTES = 16 * 1024 * 1024;
/** The server refuses larger bodies (413), so oversized payloads are trimmed first. */
const MAX_BODY_BYTES = 1024 * 1024 - 1024;
const RAW_PREVIEW_CHARS = 4000;
/** A deny reason is at most 500 characters plus our prefix; anything longer did not come from us. */
const MAX_DENY_MESSAGE_CHARS = 1000;
/**
 * What this forwarder does, so the server knows what to trust: `truncated`, it marks a body it
 * shortened (a server holds a request for the town only from a forwarder that does).
 */
const CAPS = Object.freeze(['truncated']);
/** Where an allow may save a rule: `.claude/settings.local.json` (this project, only you) or the session. */
const LOCAL_DESTINATIONS = new Set(['localSettings', 'session']);

/**
 * Exits 0, after flushing `text` to stdout if there is any.
 * @param {string} [text]
 */
function finish(text) {
  if (text) process.stdout.write(text, () => process.exit(0));
  else process.exit(0);
}

/**
 * ANDARY_HOME if set; otherwise the folder this script was installed into (it sits next to
 * server.json); otherwise ~/.andary (the plugin copy, which lives inside the plugin).
 * @returns {string}
 */
function locateHome() {
  if (process.env.ANDARY_HOME) return resolve(process.env.ANDARY_HOME);
  const own = dirname(fileURLToPath(import.meta.url));
  if (existsSync(join(own, 'server.json'))) return own;
  return join(homedir(), '.andary');
}

/**
 * @typedef {{ pid: number, port: number, host?: string, secret: string, responseKey?: string, approvalTimeoutMs?: number }} State
 */

/**
 * @param {string} home
 * @returns {State | null}
 */
function readState(home) {
  try {
    const state = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'));
    const valid = Number.isInteger(state?.port) && Number.isInteger(state.pid) && typeof state.secret === 'string';
    return valid ? state : null;
  } catch {
    return null;
  }
}

/**
 * True when the server that wrote server.json still runs as us. A server that crashed, was killed
 * or did not survive a reboot leaves server.json behind; another local user could then listen on
 * its port and receive every prompt and command. Signal 0 only checks: ESRCH means the process is
 * gone, EPERM that the pid now belongs to someone else. Either way the file is stale.
 * @param {number} pid
 * @returns {boolean}
 */
function serverAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads stdin to the end (or until it stalls; a terminal gives no input at all).
 * @returns {Promise<string>}
 */
function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolveText) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    const done = () => resolveText(Buffer.concat(chunks).toString('utf8'));
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    timer.unref();
    // No encoding is set, so stdin delivers Buffers.
    process.stdin.on('data', (/** @type {Buffer} */ chunk) => {
      size += chunk.length;
      if (size <= MAX_STDIN_BYTES) chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

/**
 * @param {string} text
 * @returns {Record<string, any>}
 */
function parsePayload(text) {
  try {
    const payload = JSON.parse(text);
    if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  } catch {
    // fall through: the town still learns that something arrived
  }
  return { hook_event_name: 'Unknown', raw: text.slice(0, RAW_PREVIEW_CHARS) };
}

/**
 * Shortens long strings and arrays (the server would cut them anyway) so the body fits. A body
 * shortened this way says so (`truncated: true`): the server cannot see what was cut (a list
 * ends at 50 items either way), and must never let the town approve a request it cannot show.
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function shrink(value, depth = 0) {
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…[+${value.length - 2000} chars]` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 8) return '[nested too deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => shrink(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shrink(item, depth + 1)]));
}

/**
 * @param {Record<string, any>} event
 * @returns {string}
 */
function buildBody(event) {
  const head = { v: 1, ts, ...(SOURCE ? { source: SOURCE } : {}), caps: CAPS };
  const body = JSON.stringify({ ...head, event });
  if (Buffer.byteLength(body) <= MAX_BODY_BYTES) return body;
  const shortened = /** @type {Record<string, unknown>} */ (shrink(event));
  const smaller = JSON.stringify({ ...head, event: { ...shortened, truncated: true } });
  if (Buffer.byteLength(smaller) <= MAX_BODY_BYTES) return smaller;
  // Still too big (a huge object): keep the identifying fields only.
  const essentials = Object.entries(event).filter(([, value]) => typeof value !== 'object');
  return JSON.stringify({ ...head, event: { ...Object.fromEntries(essentials.map(([k, v]) => [k, shrink(v)])), truncated: true } });
}

/**
 * @param {string|undefined} host
 * @returns {string}
 */
function connectHost(host) {
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1';
  return host.replace(/^\[|\]$/g, '');
}

/**
 * Asks the server on the recorded port to prove it is the one that wrote server.json: it must
 * answer GET /api/proof with HMAC(responseKey, "andary-proof\n" + nonce). Nothing else is sent
 * first, not even the hook secret.
 * @param {State} state
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function serverProves(state, timeoutMs) {
  if (typeof state.responseKey !== 'string' || state.responseKey === '') return Promise.resolve(false);
  const key = state.responseKey;
  const nonce = randomBytes(16).toString('base64url');
  const host = connectHost(state.host);
  return new Promise((resolveProof) => {
    const req = request(
      { host, port: state.port, path: '/api/proof', method: 'GET', agent: false, headers: { host: `${host.includes(':') ? `[${host}]` : host}:${state.port}`, 'x-andary-nonce': nonce } },
      (res) => {
        res.resume();
        const given = Buffer.from(String(res.headers['x-andary-proof'] ?? ''), 'base64url');
        const expected = createHmac('sha256', key).update(`andary-proof\n${nonce}`).digest();
        resolveProof(res.statusCode === 200 && given.length === expected.length && timingSafeEqual(given, expected));
      },
    );
    const timer = setTimeout(() => req.destroy(), timeoutMs);
    // The first answer counts: after a proof, the closing connection changes nothing.
    req.on('close', () => {
      clearTimeout(timer);
      resolveProof(false);
    });
    req.on('error', () => resolveProof(false));
    req.end();
  });
}

/**
 * POSTs the body; resolves with the response text and its signature on HTTP 200, otherwise null.
 * @param {State} state
 * @param {string} body
 * @param {string} nonce sent so the server can sign this very answer
 * @param {number} timeoutMs
 * @returns {Promise<{ text: string, signature: string } | null>}
 */
function post(state, body, nonce, timeoutMs) {
  const host = connectHost(state.host);
  return new Promise((resolveText) => {
    const req = request(
      {
        host,
        port: state.port,
        path: '/api/hook',
        method: 'POST',
        agent: false,
        headers: {
          host: `${host.includes(':') ? `[${host}]` : host}:${state.port}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-andary-secret': state.secret,
          'x-andary-nonce': nonce,
        },
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        const signature = String(res.headers['x-andary-signature'] ?? '');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolveText(res.statusCode === 200 ? { text: Buffer.concat(chunks).toString('utf8'), signature } : null));
        res.on('error', () => resolveText(null));
      },
    );
    const timer = setTimeout(() => req.destroy(), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => resolveText(null));
    req.end(body);
  });
}

/**
 * Whether the reply was signed by the server that wrote server.json. The hook secret travels in
 * every request, so it cannot vouch for an answer; the response key never leaves server.json.
 * @param {State} state
 * @param {string} nonce
 * @param {{ text: string, signature: string }} reply
 * @returns {boolean}
 */
function signedByServer(state, nonce, reply) {
  if (typeof state.responseKey !== 'string' || state.responseKey === '') return false;
  const expected = createHmac('sha256', state.responseKey).update(`${nonce}\n${reply.text}`).digest();
  const given = Buffer.from(reply.signature, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * A value as JSON text with the keys of every object in sorted order, so two values that differ
 * only in the order of their keys give the same text.
 * @param {unknown} value  parsed JSON
 * @returns {string}
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const object = /** @type {Record<string, unknown>} */ (value);
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

/**
 * Whether a permission update adds allow rules for this project (only you) or this session.
 * Rules for the shared project settings or every project, modes and folders are never saved.
 * @param {any} update
 * @returns {boolean}
 */
function isLocalAllowRule(update) {
  return update?.type === 'addRules' && update.behavior === 'allow' && LOCAL_DESTINATIONS.has(update.destination);
}

/**
 * The permission rule an allow may save: the reply's updatedPermissions must hold exactly one
 * update, equal (whatever the order of keys) to one of the suggestions in this hook's own input,
 * and that suggestion must be a local allow rule. Returns that suggestion from the input, never
 * the reply's copy; null for anything else, which saves nothing.
 * @param {unknown} updates      the reply's decision.updatedPermissions
 * @param {unknown} suggestions  this hook's own permission_suggestions
 * @returns {object|null}
 */
function savedRule(updates, suggestions) {
  if (!Array.isArray(updates) || updates.length !== 1 || !Array.isArray(suggestions)) return null;
  try {
    const wanted = canonicalJson(updates[0]);
    const own = suggestions.find((suggestion) => canonicalJson(suggestion) === wanted);
    return own !== undefined && isLocalAllowRule(own) ? own : null;
  } catch {
    // Nested too deeply to compare (the stack ran out): save nothing.
    return null;
  }
}

/**
 * The PermissionRequest decision from a signed reply, rebuilt from the shapes the town sends
 * (allow, allow that saves one rule, or deny with a message), as JSON; '' for anything else.
 * Fields such as updatedInput or additionalContext are never passed on: the town does not send
 * them, so their presence means the answer did not come from it. updatedPermissions passes only
 * as one of this hook's own suggestions (savedRule); any other value gives a plain allow.
 * @param {State} state
 * @param {string} nonce
 * @param {{ text: string, signature: string } | null} reply
 * @param {Record<string, any>} event  this hook's own input
 * @returns {string}
 */
function decisionFrom(state, nonce, reply, event) {
  if (!reply || !signedByServer(state, nonce, reply)) return '';
  let output;
  try {
    output = JSON.parse(reply.text)?.output;
  } catch {
    return '';
  }
  const specific = output?.hookSpecificOutput;
  const decision = specific?.decision;
  if (specific?.hookEventName !== 'PermissionRequest') return '';
  if (decision?.behavior === 'allow') {
    const rule = savedRule(decision.updatedPermissions, event.permission_suggestions);
    const allow = rule ? { behavior: 'allow', updatedPermissions: [rule] } : { behavior: 'allow' };
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: allow } });
  }
  if (decision?.behavior !== 'deny' || typeof decision.message !== 'string') return '';
  const message = decision.message.slice(0, MAX_DENY_MESSAGE_CHARS);
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message } } });
}

async function main() {
  const state = readState(locateHome());
  if (!state || !serverAlive(state.pid)) return '';
  const event = parsePayload(await readStdin());
  const isPermission = event.hook_event_name === 'PermissionRequest';
  const approvalMs = Number.isFinite(state.approvalTimeoutMs) ? Number(state.approvalTimeoutMs) : 120_000;
  const timeoutMs = isPermission ? approvalMs + APPROVAL_GRACE_MS : EVENT_TIMEOUT_MS;
  // Last line of defence: whatever happens, never outlive the request budget.
  setTimeout(() => finish(), EVENT_TIMEOUT_MS + timeoutMs + 1000).unref();
  if (!(await serverProves(state, EVENT_TIMEOUT_MS))) return '';
  const nonce = randomBytes(16).toString('base64url');
  const reply = await post(state, buildBody(event), nonce, timeoutMs);
  // Only a permission prompt takes an answer from the town; other events print nothing.
  return isPermission ? decisionFrom(state, nonce, reply, event) : '';
}

process.on('uncaughtException', () => finish());
main().then(finish, () => finish());
