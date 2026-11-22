// Credentials: the hook secret (sent by the forwarder) and the UI token (kept by the browser in
// its storage for this town's origin, sent in a header or a WebSocket subprotocol; ADR 0015). Both
// are fresh random values on every server start.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Where a page sends the owner's sign-in token, and a team viewer's view token. */
export const UI_TOKEN_HEADER = 'x-andary-token';
export const VIEW_TOKEN_HEADER = 'x-andary-view';
/** The WebSocket subprotocol the town speaks; credentials ride along as `andary.token.<token>`. */
export const WS_PROTOCOL = 'andary';
export const TOKEN_PROTOCOL_PREFIX = 'andary.token.';
export const VIEW_PROTOCOL_PREFIX = 'andary.view.';
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
 * @returns {{ token: string|null, view: string|null }}
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

/** Requests that came in through the tunnel's own port (marked by the server, app.mjs). */
const TUNNELLED = new WeakSet();

/**
 * Marks a request as one from the internet through the Quick Tunnel (ADR 0018). The server does
 * this for every request on the loopback port it opened for cloudflared.
 * @param {import('node:http').IncomingMessage} req
 */
export function markTunnelled(req) {
  TUNNELLED.add(req);
}

/** Headers Cloudflare's edge adds to every request it forwards; a client cannot remove them. */
const CLOUDFLARE_HEADERS = ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry'];

/**
 * Whether a request came from the internet through a Cloudflare tunnel (ADR 0018). Such a request
 * reaches the server from cloudflared on this computer, so its socket is loopback: that says
 * nothing about who sent it. It is one if it arrived on the tunnel's port, or if it carries
 * Cloudflare's headers on any port (a tunnel someone pointed at the town's own port). A tunnelled
 * request is never the owner and never reaches the owner's routes.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isTunnelled(req) {
  if (TUNNELLED.has(req)) return true;
  if (CLOUDFLARE_HEADERS.some((name) => req.headers[name] !== undefined)) return true;
  return /\bcloudflare\b/i.test(String(req.headers['cdn-loop'] ?? ''));
}

/**
 * The Host names a request may use: a tunnelled one only the tunnel's own name (none until
 * cloudflared printed it), anything else the town's local and network names.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ allowedHosts: Set<string>, tunnelHosts: Set<string> }} hosts
 * @returns {Set<string>}
 */
export function allowedHostsFor(req, { allowedHosts, tunnelHosts }) {
  return isTunnelled(req) ? tunnelHosts : allowedHosts;
}

/**
 * Who a browser is: the owner (signed in), a teammate watching (view token), or nobody. The
 * owner's token counts only on this computer: through the tunnel it is ignored (ADR 0018).
 * @param {import('node:http').IncomingMessage} req
 * @param {string} uiToken
 * @param {string|null} view  the team's view token, null when this is not a team host
 * @returns {'owner'|'viewer'|null}
 */
export function browserRole(req, uiToken, view) {
  const credentials = browserCredentials(req);
  if (!isTunnelled(req) && safeEqual(credentials.token, uiToken)) return 'owner';
  if (view && safeEqual(credentials.view, view)) return 'viewer';
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
