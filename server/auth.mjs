// Credentials: the hook secret (sent by the forwarder) and the UI token (kept by the browser in
// its storage for this town's origin, sent in a header or a WebSocket subprotocol; ADR 0015). Both
// are fresh random values on every server start.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Where a page sends the owner's sign-in token, a team viewer's view token and a teammate's personal link. */
export const UI_TOKEN_HEADER = 'x-andary-token';
export const VIEW_TOKEN_HEADER = 'x-andary-view';
const PERSON_HEADER = 'x-andary-person';
/** The WebSocket subprotocol the town speaks; credentials ride along as `andary.token.<token>`. */
export const WS_PROTOCOL = 'andary';
export const TOKEN_PROTOCOL_PREFIX = 'andary.token.';
export const VIEW_PROTOCOL_PREFIX = 'andary.view.';
const PERSON_PROTOCOL_PREFIX = 'andary.person.';
const HOOK_SECRET_HEADER = 'x-andary-secret';
/** The forwarder's per-request nonce, and the server's signature over nonce + reply body. */
export const HOOK_NONCE_HEADER = 'x-andary-nonce';
export const HOOK_SIGNATURE_HEADER = 'x-andary-signature';
/** The server's answer to the forwarder's challenge (GET /api/proof). */
export const PROOF_HEADER = 'x-andary-proof';
const MAX_NONCE_CHARS = 128;

/**
 * 32 random bytes, base64url (43 characters, safe in URLs, cookies and headers).
 * @returns {string}
 */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Compares two secrets in constant time. Both sides are hashed first so the comparison takes the
 * same time whatever the lengths: an early length check would tell an attacker the secret's length.
 * @param {unknown} supplied
 * @param {unknown} expected
 * @returns {boolean}
 */
export function safeEqual(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || expected === '') return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * The browser credentials a request carries (ADR 0015). Pages send them in headers; a WebSocket,
 * which cannot set headers, offers them as subprotocols next to the `andary` protocol. Nothing is a
 * cookie: a cookie for 127.0.0.1 goes to every port on it, so another local web server opened in
 * the same browser would receive it. Page storage is per origin (port included).
 * @param {import('node:http').IncomingMessage} req
 * @returns {{ token: string|null, view: string|null, person: string|null }}
 */
export function browserCredentials(req) {
  const header = (/** @type {string} */ name) => {
    const value = req.headers[name];
    return typeof value === 'string' && value !== '' ? value : null;
  };
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((part) => part.trim());
  const fromProtocol = (/** @type {string} */ prefix) => offered.find((part) => part.startsWith(prefix))?.slice(prefix.length) || null;
  return {
    token: header(UI_TOKEN_HEADER) ?? fromProtocol(TOKEN_PROTOCOL_PREFIX),
    view: header(VIEW_TOKEN_HEADER) ?? fromProtocol(VIEW_PROTOCOL_PREFIX),
    person: header(PERSON_HEADER) ?? fromProtocol(PERSON_PROTOCOL_PREFIX),
  };
}

/**
 * Whether a WebSocket handshake offered the `andary` subprotocol, which the server then names in
 * its answer (a browser that offers subprotocols drops a connection whose answer names none).
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function offersAndaryProtocol(req) {
  return String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .some((part) => part.trim() === WS_PROTOCOL);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} secret
 * @returns {boolean}
 */
export function hasHookSecret(req, secret) {
  return safeEqual(req.headers[HOOK_SECRET_HEADER], secret);
}

/**
 * Signs a /api/hook reply for the forwarder: HMAC-SHA256(responseKey, nonce + "\n" + body),
 * base64url. The response key is only in server.json (never on the wire), so a process that took
 * over the port of a dead server can read requests but cannot forge an answer Claude Code obeys.
 * @param {string} responseKey
 * @param {unknown} nonce the request's x-andary-nonce header
 * @param {string} body the exact reply text
 * @returns {string|null} null when the request carried no usable nonce
 */
export function signHookReply(responseKey, nonce, body) {
  if (typeof nonce !== 'string' || nonce === '' || nonce.length > MAX_NONCE_CHARS) return null;
  return createHmac('sha256', responseKey).update(`${nonce}\n${body}`).digest('base64url');
}

/**
 * Who a browser is: the owner (signed in), a teammate with their personal link, someone watching
 * with the view link, or nobody. The owner's sign-in wins over the others.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} uiToken
 * @param {{ view: string, personOf: (token: string|null) => string|null }|null} team
 *   a team host's view token, and the roster name a personal link belongs to (null: none)
 * @returns {{ role: 'owner'|'person'|'viewer', person: string|null }|null}
 */
export function browserRole(req, uiToken, team) {
  const credentials = browserCredentials(req);
  if (safeEqual(credentials.token, uiToken)) return { role: 'owner', person: null };
  if (!team) return null;
  const person = credentials.person ? team.personOf(credentials.person) : null;
  if (person) return { role: 'person', person };
  if (safeEqual(credentials.view, team.view)) return { role: 'viewer', person: null };
  return null;
}

/**
 * Proves to the forwarder, before it sends anything, that this is the server that wrote
 * server.json: HMAC-SHA256(responseKey, "andary-proof\n" + nonce), base64url. The prefix keeps a
 * proof from ever doubling as a signed reply (those sign nonce + "\n" + a JSON body).
 * @param {string} responseKey
 * @param {unknown} nonce the forwarder's x-andary-nonce header: base64url, 16 to 128 characters
 * @returns {string|null} null for a missing or malformed nonce
 */
export function proveServer(responseKey, nonce) {
  if (typeof nonce !== 'string' || !/^[\w-]{16,128}$/.test(nonce)) return null;
  return createHmac('sha256', responseKey).update(`andary-proof\n${nonce}`).digest('base64url');
}
