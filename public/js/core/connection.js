// Live mode: the WebSocket link to the local Andary server (CONTRACTS §4.5).
// On `hello` the store is rebuilt from the server's history; afterwards every hook envelope and
// approval update is applied as it arrives. A dropped connection is retried with exponential
// backoff; before each retry `/api/hello` tells apart "server down" (Offline) from "this browser's
// token no longer valid" (Sign in — e.g. the server restarted with a new token).

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
 * Asks the server who it is. Null when no Andary server answers (static hosting, server down).
 * @param {{ fetchImpl?: typeof fetch, base?: string }} [options]
 * @returns {Promise<Hello|null>}
 */
export async function fetchHello({ fetchImpl = globalThis.fetch, base = globalThis.location?.href } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HELLO_TIMEOUT_MS);
  try {
    const response = await fetchImpl(new URL('./api/hello', base), { cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
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
 * @property {boolean} [authenticated]   false starts in "Sign in" and waits for a valid cookie
 * @property {(status: LinkStatus) => void} [onStatus]
 * @property {(settings: object) => void} [onSettings]
 * @property {(message: string) => void} [onError]
 * @property {new (url: string) => WebSocket} [WebSocketImpl]
 * @property {() => Promise<Hello|null>} [hello]
 * @property {string} [url]
 */

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
  WebSocketImpl = globalThis.WebSocket,
  hello = () => fetchHello(),
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

  /** @param {LinkStatus} next */
  function setStatus(next) {
    if (status === next) return;
    status = next;
    onStatus(next);
  }

  function open() {
    const ws = new WebSocketImpl(url);
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
      // The login link may be opened in another tab; the cookie it sets is shared with this one.
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
    if (!message) return;
    if (message.t === 'hello') applyHello(message);
    else if (message.t === 'hook' && message.e) ingest(message.e);
    else if (message.t === 'approval' && message.a) store.setApproval(message.a);
    else if (message.t === 'settings') onSettings(message.settings ?? {});
    else if (message.t === 'usage') store.setUsage?.(message.u, message.days);
    else if (message.t === 'error') onError(String(message.message ?? 'The server reported an error.'));
  }

  /** `hello` carries the server's whole state, so the store is rebuilt from it. @param {Record<string, any>} message */
  function applyHello(message) {
    attempt = 0;
    store.reset();
    for (const envelope of message.history ?? []) ingest(envelope);
    for (const approval of message.approvals ?? []) store.setApproval(approval);
    const usage = message.usage ?? {};
    for (const record of Array.isArray(usage.agents) ? usage.agents : []) store.setUsage?.(record);
    if (Array.isArray(usage.days)) store.setUsage?.(null, usage.days);
    onSettings(message.settings ?? {});
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
    get status() {
      return status;
    },
    /**
     * Answers a held permission request.
     * @param {string} id
     * @param {'allow'|'deny'} decision
     * @param {string} [message]
     */
    decide(id, decision, message) {
      return send({ t: 'decide', id, decision, ...(message ? { message: String(message).slice(0, 500) } : {}) });
    },
    /** @param {boolean} on */
    setRemoteApprovals(on) {
      return send({ t: 'settings', settings: { remoteApprovals: Boolean(on) } });
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopPing();
      socket?.close();
      socket = null;
    },
  };
}
