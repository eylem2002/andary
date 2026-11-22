// The live event source (sources/types.js): the WebSocket link to the local Andary server
// (CONTRACTS §4.5).
// On `hello` the store is rebuilt from the server's history; afterwards every hook envelope and
// approval update is applied as it arrives. A dropped connection is retried with exponential
// backoff; before each retry `/api/hello` tells apart "server down" (Offline) from "this browser's
// token no longer valid" (Sign in — e.g. the server restarted with a new token). Both carry the
// page's sign-in (credentials.js): a header for fetch, a subprotocol for the WebSocket.
import { confirmSignIn, readCredentials, signInHeaders, signInProtocols } from './credentials.js';

/** @typedef {'connecting'|'live'|'offline'|'signin'} LinkStatus */

/**
 * @typedef {object} Hello
 * @property {string} app
 * @property {string} [version]
 * @property {boolean} authenticated
 * @property {{ remoteApprovals?: boolean, approvalTimeoutMs?: number }} [settings]
 */

const HELLO_TIMEOUT_MS = 3000;
const PING_MS = 25_000;
const SIGNIN_POLL_MS = 4000;
const OPEN = 1;

/**
 * @typedef {object} HelloOptions
 * @property {typeof fetch} [fetchImpl]
 * @property {string} [base]
 * @property {() => import('./credentials.js').Credentials} [credentials]
 * @property {(accepted: boolean) => void} [confirm]  settles a sign-in from the address bar
 */

/**
 * Asks the server who it is. Null when no Andary server answers (static hosting, server down).
 * A sign-in that came with the link is tried first, on its own, and kept only if the server
 * accepts it (credentials.js).
 * @param {HelloOptions} [options]
 * @returns {Promise<Hello|null>}
 */
export async function fetchHello({ fetchImpl = globalThis.fetch, base = globalThis.location?.href, credentials = () => readCredentials(), confirm = (accepted) => confirmSignIn(accepted) } = {}) {
  const current = credentials();
  if (current.candidate) {
    const trial = await askHello(fetchImpl, base, current.candidate);
    if (!trial) return null; // nobody answered: try the candidate again next time
    confirm(trial.authenticated);
    if (trial.authenticated) return trial;
  }
  return askHello(fetchImpl, base, current.candidate ? credentials() : current);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string|undefined} base
 * @param {import('./credentials.js').SignIn} signIn
 * @returns {Promise<Hello|null>}
 */
async function askHello(fetchImpl, base, signIn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HELLO_TIMEOUT_MS);
  try {
    const headers = { accept: 'application/json', ...signInHeaders(signIn) };
    const response = await fetchImpl(new URL('./api/hello', base), { cache: 'no-store', headers, signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    return body && body.app === 'andary' ? { ...body, authenticated: body.authenticated === true } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Delay before reconnect attempt `attempt` (0-based): 0.5 s doubling to a 10 s cap, ±20 % jitter
 * so several open tabs don't reconnect in lockstep.
 * @param {number} attempt
 * @param {() => number} [random]
 */
export function backoffDelay(attempt, random = Math.random) {
  const base = Math.min(10_000, 500 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * A server message, or null for anything that is not a JSON object.
 * @param {unknown} raw
 * @returns {Record<string, any>|null}
 */
export function parseMessage(raw) {
  try {
    const message = JSON.parse(String(raw));
    return message && typeof message === 'object' && !Array.isArray(message) ? message : null;
  } catch {
    return null;
  }
}

/** WebSocket URL for the page's origin: ws://host/ws (wss:// under https). @param {string} pageUrl */
export function socketUrl(pageUrl) {
  const url = new URL('./ws', pageUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.hash = '';
  url.search = '';
  return url.href;
}

/**
 * @typedef {object} LiveOptions
 * @property {{ ingest: (e: any) => any, setApproval: (a: any) => void, setUsage?: (u: unknown, days?: unknown) => void, reset: () => void }} store
 * @property {boolean} [authenticated]   false starts in "Sign in" and waits for a valid sign-in
 * @property {(status: LinkStatus) => void} [onStatus]
 * @property {(settings: object) => void} [onSettings]
 * @property {(message: string) => void} [onError]
 * @property {(progress: unknown) => void} [onProgress]  the town's growth and busy days (§4.9)
 * @property {(limits: unknown) => void} [onLimits]  plan limits from the andary-limits mod, owners only (§4.14)
 * @property {(ok: boolean) => void} [onNotifyTest]  the answer to notifyTest()
 * @property {(digest: unknown) => void} [onDigest]   the answer to requestDigest(): what each crew did
 * @property {(away: unknown, offset: number) => void} [onAway]  the latest time you were away, from hello and as it changes, with how far the server's clock is ahead of this browser's (from hello)
 * @property {(people: unknown[], me: string|null) => void} [onPeople]  a team town's people (§4.11), from hello (before its history) and as they change; me: who this browser plays
 * @property {(saved: { color: number, asked: number }) => void} [onProfile]  the answer to saveProfile(): the colour this person got
 * @property {new (url: string, protocols?: string[]) => WebSocket} [WebSocketImpl]
 * @property {() => import('./credentials.js').Credentials} [credentials]
 * @property {() => Promise<Hello|null>} [hello]
 * @property {string} [url]
 */

/**
 * @typedef {Required<Pick<LiveOptions, 'onSettings'|'onError'|'onProgress'|'onLimits'|'onNotifyTest'|'onDigest'|'onAway'|'onPeople'|'onProfile'>> & { store: LiveOptions['store'], ingest: (envelope: unknown) => void, clock: { offset: number }, me: { name: string|null } }} Sinks
 */

/**
 * What each server message does after hello (CONTRACTS §4.5), given where things go; any other
 * message is ignored.
 * @type {Readonly<Record<string, (message: Record<string, any>, to: Sinks) => void>>}
 */
const MESSAGES = Object.freeze({
  hook: (m, to) => {
    if (m.e) to.ingest(m.e);
  },
  approval: (m, to) => {
    if (m.a) to.store.setApproval(m.a);
  },
  settings: (m, to) => to.onSettings(m.settings ?? {}),
  usage: (m, to) => to.store.setUsage?.(m.u, m.days),
  progress: (m, to) => to.onProgress(m.p),
  limits: (m, to) => to.onLimits(m.limits),
  'notify-test': (m, to) => to.onNotifyTest(m.ok === true),
  digest: (m, to) => to.onDigest(m.d),
  away: (m, to) => to.onAway(m.away ?? null, to.clock.offset),
  people: (m, to) => to.onPeople(Array.isArray(m.people) ? m.people : [], to.me.name),
  profile: (m, to) => {
    if (m.ok === true && Number.isInteger(m.color)) to.onProfile({ color: m.color, asked: Number.isInteger(m.asked) ? m.asked : m.color });
  },
  error: (m, to) => to.onError(String(m.message ?? 'The server reported an error.')),
});

/**
 * Opens and keeps open the live connection.
 * @param {LiveOptions} options
 */
export function connectLive({
  store,
  authenticated = true,
  onStatus = () => {},
  onSettings = () => {},
  onError = () => {},
  onProgress = () => {},
  onLimits = () => {},
  onNotifyTest = () => {},
  onDigest = () => {},
  onAway = () => {},
  onPeople = () => {},
  onProfile = () => {},
  WebSocketImpl = globalThis.WebSocket,
  credentials = () => readCredentials(),
  hello = () => fetchHello({ credentials }),
  url = socketUrl(globalThis.location?.href ?? 'http://127.0.0.1/'),
}) {
  /** @type {WebSocket|null} */
  let socket = null;
  /** @type {LinkStatus} */
  let status = authenticated ? 'connecting' : 'signin';
  let attempt = 0;
  let closed = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let retryTimer = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let pingTimer = null;
  /** Where the server's messages go (MESSAGES). @type {Sinks} */
  const sinks = { store, ingest, onSettings, onError, onProgress, onLimits, onNotifyTest, onDigest, onAway, onPeople, onProfile, clock: { offset: 0 }, me: { name: null } };

  /** @param {LinkStatus} next */
  function setStatus(next) {
    if (status === next) return;
    status = next;
    onStatus(next);
  }

  function open() {
    const ws = new WebSocketImpl(url, signInProtocols(credentials()));
    socket = ws;
    ws.addEventListener('message', (event) => handle(event.data));
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      socket = null;
      stopPing();
      if (!closed) scheduleRetry(backoffDelay(attempt++));
    });
  }

  /** @param {number} delay */
  function scheduleRetry(delay) {
    if (status === 'live') setStatus('connecting');
    retryTimer = setTimeout(probe, delay);
  }

  /** Checks the server before reconnecting, so the status says why we are not live. */
  async function probe() {
    retryTimer = null;
    if (closed) return;
    const info = await hello();
    if (closed) return;
    if (!info) {
      setStatus('offline');
      scheduleRetry(backoffDelay(attempt++));
    } else if (!info.authenticated) {
      // The sign-in link may be opened in another tab; what it stores is shared with this one.
      setStatus('signin');
      retryTimer = setTimeout(probe, SIGNIN_POLL_MS);
    } else {
      setStatus('connecting');
      open();
    }
  }

  /** @param {unknown} raw */
  function handle(raw) {
    const message = parseMessage(raw);
    if (message?.t === 'hello') applyHello(message);
    else if (message && Object.hasOwn(MESSAGES, message.t)) MESSAGES[message.t](message, sinks);
  }

  /** `hello` carries the server's whole state, so the store is rebuilt from it. @param {Record<string, any>} message */
  function applyHello(message) {
    attempt = 0;
    store.reset();
    // The people first: their crews take their colours as the history is replayed.
    helloPeople(message, sinks);
    for (const envelope of message.history ?? []) ingest(envelope);
    for (const approval of message.approvals ?? []) store.setApproval(approval);
    const usage = message.usage ?? {};
    for (const record of Array.isArray(usage.agents) ? usage.agents : []) store.setUsage?.(record);
    if (Array.isArray(usage.days)) store.setUsage?.(null, usage.days);
    // Whole values, so nothing is left over from before a restart (a town that no longer hosts a team).
    onSettings({ ...(message.settings ?? {}), team: message.settings?.team ?? null, notifyUrl: typeof message.notifyUrl === 'string' ? message.notifyUrl : null });
    if (message.progress) onProgress(message.progress);
    // The server's clock against this one (for the catch-up's half hour; the trip is ignored).
    sinks.clock.offset = Number.isFinite(message.serverTime) ? message.serverTime - Date.now() : 0;
    // Always, so an absence from before a restart is not offered again.
    onAway(message.away ?? null, sinks.clock.offset);
    // Whole, so a restarted server's empty list replaces what the town showed before.
    onLimits(message.limits ?? null);
    setStatus('live');
    startPing();
  }

  /** One malformed event must not stop the stream. @param {unknown} envelope */
  function ingest(envelope) {
    try {
      store.ingest(envelope);
    } catch (error) {
      console.error('Andary: could not apply an event', error);
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => send({ t: 'ping' }), PING_MS);
  }

  function stopPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  }

  /** @param {object} message */
  function send(message) {
    if (!socket || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  if (authenticated) open();
  else retryTimer = setTimeout(probe, SIGNIN_POLL_MS);

  return {
    /** @type {'live'} */
    mode: 'live',
    get status() {
      return status;
    },
    ...requests(send),
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopPing();
      socket?.close();
      socket = null;
    },
  };
}

/**
 * Who lives in a team town, and who this browser plays, from `hello`.
 * @param {Record<string, any>} message @param {Sinks} sinks
 */
function helloPeople(message, sinks) {
  sinks.me.name = typeof message.me === 'string' ? message.me : null;
  sinks.onPeople(Array.isArray(message.people) ? message.people : [], sinks.me.name);
}

/**
 * What the browser can ask the server for (CONTRACTS §4.5); false when the socket is not open.
 * @param {(message: object) => boolean} send
 */
function requests(send) {
  return {
    /**
     * Answers a held permission request.
     * @param {string} id
     * @param {'allow'|'deny'} decision
     * @param {string} [message]  why, for a denial
     * @param {number} [always]   with an allow: the index of the suggestion to save ("Allow always")
     */
    decide(id, decision, message, always) {
      return send({ t: 'decide', id, decision, ...(message ? { message: String(message).slice(0, 500) } : {}), ...(always === undefined ? {} : { always }) });
    },
    /** Asks the server to send a test phone notification. */
    notifyTest() {
      return send({ t: 'notify-test' });
    },
    /**
     * Asks what each crew did since a time (the server's clock, ms); the answer comes to onDigest.
     * @param {number} since
     */
    requestDigest(since) {
      return send({ t: 'digest', since });
    },
    /** @param {boolean} on */
    setRemoteApprovals(on) {
      return send({ t: 'settings', settings: { remoteApprovals: Boolean(on) } });
    },
    /**
     * Saves this person's profile on the team host (§4.11); the answer comes to onProfile.
     * @param {import('../core/profile.js').Profile} profile
     */
    saveProfile(profile) {
      return send({ t: 'profile', p: profile });
    },
  };
}

