// Credentials: the hook secret (sent by the forwarder) and the UI token (held by the browser in an
// HttpOnly cookie). Both are fresh random values on every server start.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const UI_COOKIE = 'andary_ui';
/** The team town's view-only cookie (server/team.mjs). */
export const VIEW_COOKIE = 'andary_view';
const HOOK_SECRET_HEADER = 'x-andary-secret';
/** The forwarder's per-request nonce, and the server's signature over nonce + reply body. */
export const HOOK_NONCE_HEADER = 'x-andary-nonce';
export const HOOK_SIGNATURE_HEADER = 'x-andary-signature';
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
 * Parses a Cookie header. The first occurrence of a name wins (browsers send the most specific
 * cookie first). Malformed pairs are skipped.
 * @param {string|undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const cookies = Object.create(null);
  if (typeof header !== 'string' || header === '') return cookies;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    cookies[name] = decodeCookieValue(pair.slice(eq + 1).trim());
  }
  return cookies;
}

/**
 * @param {string} raw
 * @returns {string}
 */
function decodeCookieValue(raw) {
  const unquoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

/**
 * The login cookie. No Max-Age: it lasts for the browser session, and the token changes on every
 * server start anyway. HttpOnly keeps it away from page scripts; SameSite=Strict keeps other sites
 * from riding on it.
 * @param {string} uiToken
 * @returns {string}
 */
export function loginCookie(uiToken) {
  return `${UI_COOKIE}=${uiToken}; HttpOnly; SameSite=Strict; Path=/`;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} uiToken
 * @returns {boolean}
 */
export function hasUiCookie(req, uiToken) {
  return safeEqual(parseCookies(req.headers.cookie)[UI_COOKIE], uiToken);
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
 * The view-only cookie for a team town: same protections as the sign-in cookie.
 * @param {string} token
 */
export function viewCookie(token) {
  return `${VIEW_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

/**
 * Who a browser is: the owner (signed in), a teammate watching (view cookie), or nobody.
 * @param {import('node:http').IncomingMessage} req
 * @param {string} uiToken
 * @param {string|null} view  the team's view token, null when this is not a team host
 * @returns {'owner'|'viewer'|null}
 */
export function browserRole(req, uiToken, view) {
  const cookies = parseCookies(req.headers.cookie);
  if (safeEqual(cookies[UI_COOKIE], uiToken)) return 'owner';
  if (view && safeEqual(cookies[VIEW_COOKIE], view)) return 'viewer';
  return null;
}

