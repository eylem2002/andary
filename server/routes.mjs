// HTTP routes (CONTRACTS §4.4). Every response carries the security headers; every request must
// name one of our own hosts.
import { HOOK_NONCE_HEADER, HOOK_SIGNATURE_HEADER, hasHookSecret, hasUiCookie, loginCookie, safeEqual, signHookReply } from './auth.mjs';
import { APP_ID, LIMITS } from './config.mjs';
import { publicSettings } from './browsers.mjs';
import { BAD_TOKEN_PAGE, HttpError, readBody, sendHtml, sendJson, sendText } from './http-util.mjs';
import { isAllowedHost } from './security.mjs';

/**
 * @typedef {import('./app.mjs').TownContext} TownContext
 * @typedef {import('node:http').IncomingMessage} Request
 * @typedef {import('node:http').ServerResponse} Response
 */

/**
 * @param {TownContext} ctx
 * @param {Request} req
 * @param {Response} res
 * @returns {Promise<void>}
 */
export async function handleRequest(ctx, req, res) {
  for (const [name, value] of Object.entries(ctx.headers)) res.setHeader(name, value);
  if (!isAllowedHost(req.headers.host, ctx.allowedHosts)) {
    req.resume();
    sendText(res, 403, 'Forbidden: Andary only answers to 127.0.0.1, localhost and [::1].\n');
    return;
  }
  const url = parseUrl(req.url);
  if (!url) {
    sendText(res, 400, 'Bad request\n');
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    await handleApi(ctx, req, res, url.pathname);
    return;
  }
  if (url.pathname === '/ws') {
    sendText(res, 426, 'This address is for WebSocket connections.\n', { Upgrade: 'websocket' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.resume();
    sendText(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
    return;
  }
  if (req.method === 'GET' && url.searchParams.has('token') && isPagePath(url.pathname)) {
    handleLogin(ctx, res, url);
    return;
  }
  await ctx.serveStatic(req, res, url.pathname);
}

/**
 * @param {string|undefined} raw
 * @returns {URL|null}
 */
function parseUrl(raw) {
  try {
    return new URL(raw ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

/**
 * Pages that accept a sign-in link: the app and the lab pages.
 * @param {string} pathname
 * @returns {boolean}
 */
function isPagePath(pathname) {
  return pathname === '/' || /^\/[\w-]+\.html$/.test(pathname);
}

/**
 * GET /?token=… stores the UI token in an HttpOnly cookie and redirects to the same page without
 * the token, so it does not linger in the address bar or history.
 * @param {TownContext} ctx
 * @param {Response} res
 * @param {URL} url
 */
function handleLogin(ctx, res, url) {
  if (!safeEqual(url.searchParams.get('token'), ctx.uiToken)) {
    sendHtml(res, 403, BAD_TOKEN_PAGE);
    return;
  }
  url.searchParams.delete('token');
  const query = url.searchParams.toString();
  res.writeHead(302, {
    'Set-Cookie': loginCookie(ctx.uiToken),
    Location: `${url.pathname}${query ? `?${query}` : ''}`,
    'Cache-Control': 'no-store',
    'Content-Length': '0',
  });
  res.end();
}

/** @type {Record<string, { methods: string[], handle: (ctx: TownContext, req: Request, res: Response) => void|Promise<void> }>} */
const API_ROUTES = {
  '/api/health': { methods: ['GET', 'HEAD'], handle: (_ctx, _req, res) => sendJson(res, 200, { ok: true }) },
  '/api/hello': {
    methods: ['GET', 'HEAD'],
    handle: (ctx, req, res) =>
      sendJson(res, 200, {
        app: APP_ID,
        version: ctx.version,
        authenticated: hasUiCookie(req, ctx.uiToken),
        settings: publicSettings(ctx),
      }),
  },
  '/api/hook': { methods: ['POST'], handle: handleHook },
};

/**
 * @param {TownContext} ctx
 * @param {Request} req
 * @param {Response} res
 * @param {string} pathname
 */
async function handleApi(ctx, req, res, pathname) {
  const route = Object.hasOwn(API_ROUTES, pathname) ? API_ROUTES[pathname] : null;
  if (!route) {
    req.resume();
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (!route.methods.includes(req.method ?? '')) {
    req.resume();
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: route.methods.join(', ') });
    return;
  }
  await route.handle(ctx, req, res);
}

/**
 * POST /api/hook from the forwarder: authenticate, rate-limit, read, then broadcast.
 * @param {TownContext} ctx
 * @param {Request} req
 * @param {Response} res
 */
async function handleHook(ctx, req, res) {
  // Authentication comes before the rate limit, so requests without the secret (for example
  // from a web page) cannot use up the budget of the real hooks.
  if (!hasHookSecret(req, ctx.secret)) {
    req.resume();
    sendJson(res, 401, { error: 'Missing or wrong hook secret' });
    return;
  }
  if (!ctx.hookLimiter.take()) {
    req.resume();
    sendJson(res, 429, { error: 'Too many hook events' }, { 'Retry-After': '1' });
    return;
  }
  let body;
  try {
    body = parseHookBody(await readBody(req, LIMITS.hookBodyBytes));
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    sendJson(res, error.status, { error: error.message }, error.status === 413 ? { Connection: 'close' } : {});
    return;
  }
  ctx.usage.observe(body.event);
  const envelope = ctx.ingest(body);
  if (envelope.event.hook_event_name === 'PermissionRequest') {
    await answerPermissionRequest(ctx, req, res, envelope.event, shownInFull(body.event.tool_input, envelope.event.tool_input));
    return;
  }
  ctx.broker.observe(envelope.event);
  sendHookReply(ctx, req, res, null);
}

/**
 * Answers the forwarder, signed with the response key so it can tell our answer from one made up
 * by whatever listens on a stale port (CONTRACTS §4.3).
 * @param {TownContext} ctx
 * @param {Request} req
 * @param {Response} res
 * @param {object|null} output
 */
function sendHookReply(ctx, req, res, output) {
  if (res.headersSent || res.destroyed) return;
  const text = JSON.stringify({ output });
  const signature = signHookReply(ctx.responseKey, req.headers[HOOK_NONCE_HEADER], text);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...(signature ? { [HOOK_SIGNATURE_HEADER]: signature } : {}),
  });
  res.end(text);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates the forwarder's body: {"v":1,"ts":<ms>,"event":{…}}.
 * @param {Buffer} raw
 * @returns {{ ts: number, event: Record<string, any> }}
 */
export function parseHookBody(raw) {
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  if (!isObject(body) || body.v !== 1 || !isObject(body.event)) {
    throw new HttpError(400, 'Body must look like {"v":1,"ts":<ms>,"event":{...}}');
  }
  return { ts: Number.isFinite(body.ts) ? body.ts : Date.now(), event: body.event };
}

/** Why a request the town could otherwise answer goes to the terminal (Approval.message). */
const NOT_SHOWN_IN_FULL = 'The town cannot show this request in full (it is very long or holds credentials)';

/**
 * Whether sanitizing left a tool input exactly as Claude Code sent it. Redaction and truncation
 * hide text, and hidden text can run: `TOKEN="$(curl … | sh)"` is shown as `TOKEN=[redacted]`, and
 * a command padded past 2,000 characters loses its tail. Such a request must not be approved from
 * a card that does not show it.
 * @param {unknown} raw
 * @param {unknown} sanitized
 * @returns {boolean}
 */
function shownInFull(raw, sanitized) {
  return JSON.stringify(raw ?? null) === JSON.stringify(sanitized ?? null);
}

/**
 * Holds the response for the town to decide when remote approvals are on and someone is
 * watching; otherwise answers null at once and the terminal prompt appears as usual.
 * @param {TownContext} ctx
 * @param {Request} req
 * @param {Response} res
 * @param {Record<string, any>} event
 * @param {boolean} exact the tool input reached the town unchanged (see shownInFull)
 */
async function answerPermissionRequest(ctx, req, res, event, exact) {
  const wanted = ctx.settings.remoteApprovals && ctx.hub.size > 0;
  const hold = wanted && exact;
  const { approval, response } = ctx.broker.create(event, { hold, message: wanted && !exact ? NOT_SHOWN_IN_FULL : undefined });
  if (hold) {
    // The forwarder went away (Claude Code cancelled the hook): Claude asks in the terminal now.
    res.on('close', () => {
      if (!res.writableEnded) ctx.broker.release(approval.id);
    });
  }
  sendHookReply(ctx, req, res, await response);
}
