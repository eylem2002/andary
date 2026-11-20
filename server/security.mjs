// Browser-facing defences: the response headers (CSP and friends) and the Host/Origin checks that
// stop DNS-rebinding and cross-site WebSocket hijacking.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const IMPORT_MAP = /<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * Returns the text of every `<script type="importmap">` in an HTML document, byte for byte (the
 * CSP hash covers exactly the element's text).
 * @param {string} html
 * @returns {string[]}
 */
export function extractImportMaps(html) {
  return Array.from(html.matchAll(IMPORT_MAP), (match) => match[1]);
}

/**
 * CSP source expression for an inline script: 'sha256-<base64 digest>'.
 * @param {string} scriptText
 * @returns {string}
 */
export function cspHash(scriptText) {
  return `'sha256-${createHash('sha256').update(scriptText, 'utf8').digest('base64')}'`;
}

/**
 * Hashes the import map of every `public/*.html` page. The pages share one byte-identical import
 * map, so this is normally a single hash; different maps simply add more.
 * @param {string} publicDir
 * @returns {string[]} unique CSP source expressions, in a stable order
 */
export function computeImportMapHashes(publicDir) {
  /** @type {string[]} */
  let pages;
  try {
    pages = readdirSync(publicDir).filter((name) => name.endsWith('.html')).sort();
  } catch {
    return [];
  }
  const hashes = new Set();
  for (const page of pages) {
    const html = readFileSync(join(publicDir, page), 'utf8');
    for (const map of extractImportMaps(html)) hashes.add(cspHash(map));
  }
  return [...hashes];
}

/**
 * @param {string[]} scriptHashes CSP source expressions for the allowed inline import maps
 * @returns {string}
 */
export function buildCsp(scriptHashes) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes].join(' '),
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Headers sent on every response, including errors and redirects.
 * @param {string} csp
 * @returns {Record<string, string>}
 */
export function securityHeaders(csp) {
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

/** Addresses that mean "every interface": a browser can't use them as a Host. */
const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);

/**
 * @param {string|undefined} host
 * @returns {boolean}
 */
export function isWildcardHost(host) {
  return WILDCARD_HOSTS.has(host ?? '');
}

/**
 * True for 127.0.0.0/8, ::1 and localhost: addresses other machines cannot reach.
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const bare = stripBrackets(host).toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare);
}

/**
 * @param {string} host
 * @returns {string}
 */
function stripBrackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Formats host:port for URLs and Host headers (IPv6 literals need brackets).
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
export function hostWithPort(host, port) {
  const bare = stripBrackets(host);
  return `${bare.includes(':') ? `[${bare}]` : bare}:${port}`;
}

/**
 * The address a local client should connect to: loopback when the server listens everywhere.
 * @param {string|undefined} boundHost
 * @returns {string}
 */
export function connectHost(boundHost) {
  return isWildcardHost(boundHost) ? '127.0.0.1' : stripBrackets(String(boundHost));
}

/**
 * Host header values the server answers to. Loopback names always; the bound host too when the
 * user chose a specific non-loopback address with --host; and any extra names (a team host's LAN
 * addresses when it listens on every interface).
 * @param {number} port
 * @param {string} [boundHost]
 * @param {string[]} [extra]
 * @returns {Set<string>} lower-case host:port strings
 */
export function allowedHostHeaders(port, boundHost, extra = []) {
  const names = ['127.0.0.1', 'localhost', '::1', ...extra];
  if (boundHost && !isWildcardHost(boundHost)) names.push(boundHost);
  const allowed = new Set();
  for (const name of names) {
    allowed.add(hostWithPort(name, port).toLowerCase());
    // Browsers leave out the default port.
    if (port === 80) allowed.add(hostWithPort(name, port).toLowerCase().replace(/:80$/, ''));
  }
  return allowed;
}

/**
 * DNS-rebinding defence: a page on evil.example that rebinds its name to 127.0.0.1 still sends
 * "Host: evil.example", so only our own names are accepted.
 * @param {string|undefined} hostHeader
 * @param {Set<string>} allowed from allowedHostHeaders
 * @returns {boolean}
 */
export function isAllowedHost(hostHeader, allowed) {
  return typeof hostHeader === 'string' && allowed.has(hostHeader.trim().toLowerCase());
}

/**
 * Cross-site WebSocket hijacking defence. Browsers always send Origin on WebSocket handshakes, so
 * a foreign page is refused; non-browser clients (the doctor, tests) may leave it out.
 * @param {string|undefined} originHeader
 * @param {Set<string>} allowedHosts from allowedHostHeaders
 * @returns {boolean}
 */
export function isAllowedOrigin(originHeader, allowedHosts) {
  if (originHeader === undefined) return true;
  if (typeof originHeader !== 'string') return false;
  const match = /^http:\/\/([^/]+)$/i.exec(originHeader.trim());
  return match !== null && allowedHosts.has(match[1].toLowerCase());
}
