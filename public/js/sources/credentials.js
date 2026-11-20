// The browser's sign-in to its town (ADR 0015). The sign-in link arrives as `#signin=<token>` (a
// team viewer's as `#view=<token>`); it is moved into this origin's storage at once and taken out
// of the address bar. Page storage belongs to one origin, port included, so unlike a cookie for
// 127.0.0.1 no other local web server can receive it. Requests then carry it explicitly: a header
// for fetch, a subprotocol for the WebSocket. Read fresh every time, so signing in again in
// another tab (after a server restart) also signs in this one.

const STORAGE_KEY = 'andary:signin';
/** The subprotocol the town speaks; credentials ride along as `andary.token.<token>`. */
export const WS_PROTOCOL = 'andary';
/** Tokens are base64url; anything else is not ours and is never sent. */
const TOKEN = /^[\w-]{16,128}$/;

/** @typedef {{ token: string|null, view: string|null }} Credentials */

/** Credentials kept in memory when storage is unavailable. @type {Credentials|null} */
let memory = null;

/**
 * @typedef {object} Place
 * @property {{ hash: string, pathname: string, search: string }} location
 * @property {{ replaceState: (data: unknown, unused: string, url: string) => void }|null} history
 * @property {Pick<Storage, 'getItem'|'setItem'>|null} storage
 */

/** @returns {Place} */
function browserPlace() {
  return { location: globalThis.location ?? { hash: '', pathname: '/', search: '' }, history: globalThis.history ?? null, storage: safeStorage() };
}

/**
 * The credentials this page holds, after taking any sign-in link out of the address bar.
 * @param {Place} [place]
 * @returns {Credentials}
 */
export function readCredentials(place = browserPlace()) {
  takeSignInFromUrl(place);
  try {
    const saved = JSON.parse(place.storage?.getItem(STORAGE_KEY) ?? 'null');
    return { token: valid(saved?.token), view: valid(saved?.view) };
  } catch {
    return { token: null, view: null };
  }
}

/**
 * Moves `#signin=` / `#view=` from the address into storage and removes the fragment.
 * @param {Place} place
 */
export function takeSignInFromUrl({ location, history, storage }) {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const token = valid(fragment.get('signin'));
  const view = valid(fragment.get('view'));
  if (!token && !view) return;
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null') ?? {};
    storage?.setItem(STORAGE_KEY, JSON.stringify({ token: token ?? valid(saved.token), view: view ?? valid(saved.view) }));
  } catch {
    // Storage refused (private mode, quota): this page still signs in until it is reloaded.
    memory = { token, view };
  }
  history?.replaceState(null, '', `${location.pathname}${location.search}`);
}

/**
 * Headers that sign a fetch in.
 * @param {Credentials} credentials
 * @returns {Record<string, string>}
 */
export function signInHeaders(credentials) {
  const current = withMemory(credentials);
  return {
    ...(current.token ? { 'x-andary-token': current.token } : {}),
    ...(current.view ? { 'x-andary-view': current.view } : {}),
  };
}

/**
 * Subprotocols that sign a WebSocket in: `andary` first, then the credentials.
 * @param {Credentials} credentials
 * @returns {string[]}
 */
export function signInProtocols(credentials) {
  const current = withMemory(credentials);
  return [
    WS_PROTOCOL,
    ...(current.token ? [`${WS_PROTOCOL}.token.${current.token}`] : []),
    ...(current.view ? [`${WS_PROTOCOL}.view.${current.view}`] : []),
  ];
}

/** @param {Credentials} credentials @returns {Credentials} */
function withMemory(credentials) {
  return { token: credentials.token ?? memory?.token ?? null, view: credentials.view ?? memory?.view ?? null };
}

/** @param {unknown} value @returns {string|null} */
function valid(value) {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

/** @returns {Storage|null} */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
