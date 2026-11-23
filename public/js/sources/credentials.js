// The browser's sign-in to its town (ADR 0015). The sign-in link arrives as `#signin=<token>` (a
// team viewer's as `#view=<token>`, a teammate's personal link as `#me=<token>`); it is taken out
// of the address bar at once and kept in this
// origin's storage. Page storage belongs to one origin, port included, so unlike a cookie for
// 127.0.0.1 no other local web server can receive it. Requests then carry it explicitly: a header
// for fetch, a subprotocol for the WebSocket. Read fresh every time, so signing in again in
// another tab (after a server restart) also signs in this one.
//
// A token from the address is only a candidate until the server accepts it (confirmSignIn):
// anyone can link to `…/#signin=junk`, and that must not replace a sign-in that works.

const STORAGE_KEY = 'andary:signin';
/** The subprotocol the town speaks; credentials ride along as `andary.token.<token>`. */
export const WS_PROTOCOL = 'andary';
/** Tokens are base64url; anything else is not ours and is never sent. */
const TOKEN = /^[\w-]{16,128}$/;
/** A personal link: the percent-encoded name, a dot, and 32 base64url characters. */
const PERSON_TOKEN = /^[\w.%-]{1,200}\.[\w-]{32}$/;

/** @typedef {{ token: string|null, view: string|null, person?: string|null }} SignIn */
/** @typedef {SignIn & { candidate?: SignIn|null }} Credentials */
/** @typedef {{ token?: string|null, view?: string|null, person?: string|null, candidate?: { token?: string|null, view?: string|null, person?: string|null }|null }} Saved */

/**
 * @typedef {object} Place
 * @property {{ hash: string, pathname: string, search: string }} location
 * @property {{ replaceState: (data: unknown, unused: string, url: string) => void }|null} history
 * @property {Pick<Storage, 'getItem'|'setItem'>|null} storage
 */

/** What is kept when this page cannot use storage (blocked site data, private mode). @type {Saved} */
let memory = {};
let storageFailed = false;

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
  const saved = load(place.storage);
  const candidate = saved.candidate ? signIn(saved.candidate) : null;
  return { ...signIn(saved), candidate: candidate && (candidate.token || candidate.view || candidate.person) ? candidate : null };
}

/**
 * The valid fields of a saved sign-in.
 * @param {{ token?: unknown, view?: unknown, person?: unknown }} saved
 * @returns {SignIn}
 */
function signIn(saved) {
  return { token: valid(saved.token), view: valid(saved.view), person: valid(saved.person, PERSON_TOKEN) };
}

/**
 * Moves `#signin=` / `#view=` / `#me=` from the address into storage, as a candidate, and
 * removes the fragment.
 * @param {Place} place
 */
export function takeSignInFromUrl({ location, history, storage }) {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const found = { token: valid(fragment.get('signin')), view: valid(fragment.get('view')), person: valid(fragment.get('me'), PERSON_TOKEN) };
  if (!found.token && !found.view && !found.person) return;
  const saved = load(storage);
  const before = signIn(saved.candidate ?? {});
  save(storage, { ...saved, candidate: { token: found.token ?? before.token, view: found.view ?? before.view, person: found.person ?? before.person } });
  history?.replaceState(null, '', `${location.pathname}${location.search}`);
}

/**
 * Settles a candidate: kept as the sign-in when the server accepted it, dropped otherwise.
 * @param {boolean} accepted
 * @param {Place} [place]
 */
export function confirmSignIn(accepted, place = browserPlace()) {
  const saved = load(place.storage);
  const candidate = saved.candidate;
  if (!candidate) return;
  const now = signIn(saved);
  const offered = signIn(candidate);
  const next = accepted
    ? { token: offered.token ?? now.token, view: offered.view ?? now.view, person: offered.person ?? now.person }
    : now;
  save(place.storage, next);
}

/**
 * Headers that sign a fetch in.
 * @param {SignIn} credentials
 * @returns {Record<string, string>}
 */
export function signInHeaders(credentials) {
  return {
    ...(credentials.token ? { 'x-andary-token': credentials.token } : {}),
    ...(credentials.view ? { 'x-andary-view': credentials.view } : {}),
    ...(credentials.person ? { 'x-andary-person': credentials.person } : {}),
  };
}

/**
 * Subprotocols that sign a WebSocket in: `andary` first, then the credentials.
 * @param {SignIn} credentials
 * @returns {string[]}
 */
export function signInProtocols(credentials) {
  return [
    WS_PROTOCOL,
    ...(credentials.token ? [`${WS_PROTOCOL}.token.${credentials.token}`] : []),
    ...(credentials.view ? [`${WS_PROTOCOL}.view.${credentials.view}`] : []),
    ...(credentials.person ? [`${WS_PROTOCOL}.person.${credentials.person}`] : []),
  ];
}

/**
 * @param {Pick<Storage, 'getItem'>|null} storage
 * @returns {Saved}
 */
function load(storage) {
  if (!storage || storageFailed) return memory;
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return memory;
  }
}

/**
 * @param {Pick<Storage, 'setItem'>|null} storage
 * @param {Saved} saved
 */
function save(storage, saved) {
  memory = saved;
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    storageFailed = false;
  } catch {
    // Quota or blocked storage: this page keeps the sign-in in memory until it is reloaded.
    storageFailed = true;
  }
}

/** @param {unknown} value @param {RegExp} [pattern] @returns {string|null} */
function valid(value, pattern = TOKEN) {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/** @returns {Storage|null} */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
