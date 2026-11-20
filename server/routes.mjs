// HTTP routes (CONTRACTS §4.4). Every response carries the security headers; every request must
// name one of our own hosts.
import { HOOK_NONCE_HEADER, HOOK_SIGNATURE_HEADER, PROOF_HEADER, browserRole, hasHookSecret, proveServer, safeEqual, signHookReply } from './auth.mjs';
import { TEAM_HEADER, verifyMemberKey } from './team.mjs';
import { sourceOf } from './adapters/index.mjs';
import { ingestHook, ingestTeam } from './ingest.mjs';
import { APP_ID, LIMITS } from './config.mjs';
import { publicSettings } from './browsers.mjs';
import { BAD_TOKEN_PAGE, HttpError, readBody, sendHtml, sendJson, sendText } from './http-util.mjs';
import { isAllowedHost } from './security.mjs';
import { isObject } from '../public/js/core/text.js';

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
  // A teammate's relay may reach the host by any name (a LAN address, a VPN name); its key, not
  // the Host header, is what authenticates it, and no browser can send that header cross-site.
  const teamPost = Boolean(ctx.team) && req.method === 'POST' && req.url === '/api/team';
  if (!teamPost && !isAllowedHost(req.headers.host, ctx.allowedHosts)) {
    req.resume();
    sendText(res, 403, 'Forbidden: Andary does not answer to this host name. Open it at 127.0.0.1 or localhost (a team town also answers to its network address and to --team-host names).\n');
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
  if (req.method === 'GET' && url.searchParams.has('view') && isPagePath(url.pathname)) {
    handleViewLogin(ctx, res, url);
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
 * GET /?token=… (the sign-in link): checks the token, then redirects to the same page with the
 * token moved into the fragment (`#signin=…`). The page keeps it in its own storage, which no
 * other origin can read, and removes it from the address bar (ADR 0015). A fragment is never sent
 * to a server again, so the token appears in no later request line or Referer.
 * @param {TownContext} ctx
 * @param {Response} res
 * @param {URL} url
 */
function handleLogin(ctx, res, url) {
  if (!safeEqual(url.searchParams.get('token'), ctx.uiToken)) {
    sendHtml(res, 403, BAD_TOKEN_PAGE);
    return;
  }
  redirectWithFragment(res, url, 'token', `signin=${ctx.uiToken}`);
}

/**
 * GET /?view=… (a team host's view-only link): the same, with `#view=…`.
 * @param {TownContext} ctx
 * @param {Response} res
 * @param {URL} url
 */
function handleViewLogin(ctx, res, url) {
  if (!ctx.team || !safeEqual(url.searchParams.get('view'), ctx.team.view)) {
    sendHtml(res, 403, BAD_TOKEN_PAGE);
    return;
  }
  redirectWithFragment(res, url, 'view', `view=${ctx.team.view}`);
}

/**
 * Only the app reads a sign-in from the fragment; other pages (the lab pages) just lose the token,
 * so it never stays in their address.
 * @param {Response} res
 * @param {URL} url
 * @param {string} param   the query parameter to take out
 * @param {string} fragment
 */
function redirectWithFragment(res, url, param, fragment) {
  url.searchParams.delete(param);
  const query = url.searchParams.toString();
  const app = url.pathname === '/' || url.pathname === '/index.html';
  res.writeHead(302, {
    Location: `${url.pathname}${query ? `?${query}` : ''}${app ? `#${fragment}` : ''}`,
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
        authenticated: browserRole(req, ctx.uiToken, ctx.team?.view ?? null) !== null,
        settings: publicSettings(ctx),
      }),
  },
  '/api/proof': { methods: ['GET'], handle: handleProof },
  '/api/hook': { methods: ['POST'], handle: handleHook },
  '/api/team': { methods: ['POST'], handle: handleTeam },
};

/** Most events one teammate may send in one request. */
const TEAM_BATCH = 200;
/** Team uploads read at the same time, from everyone. */
const TEAM_UPLOADS = 4;

/**
 * POST /api/team from a teammate's Andary: authenticate the member, rate-limit, read, then ingest
 * each event as theirs (sanitized again: nothing from the network is trusted). Their permission
 * requests are shown, never held: only they can answer their own prompts.
 * @param {TownContext} ctx
 * @param {Request} req
 * @param {Response} res
 */
async function handleTeam(ctx, req, res) {
  const member = ctx.team ? verifyMemberKey(ctx.team.secret, req.headers[TEAM_HEADER]) : null;
  if (!member) {
    req.resume();
    sendJson(res, ctx.team ? 401 : 404, { error: ctx.team ? 'Missing or wrong team key' : 'Not found' });
    return;
  }
  const team = /** @type {NonNullable<TownContext['team']>} */ (ctx.team);
  const bucket = team.limiter(member);
  // One token before the body is read, and only a few uploads at a time: a key cannot be used to
  // keep many 2 MB uploads open at once.
  if (team.uploads >= TEAM_UPLOADS || !bucket.take(1)) {
    req.resume();
    sendJson(res, 429, { error: 'Too many team events' }, { 'Retry-After': '1' });
    return;
  }
  let events;
  team.uploads += 1;
  try {
    events = await readTeamEvents(req);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    sendJson(res, error.status, { error: error.message }, error.status === 413 ? { Connection: 'close' } : {});
    return;
  } finally {
    team.uploads -= 1;
  }
  if (events.length > 1 && !bucket.take(events.length - 1)) {
    sendJson(res, 429, { error: 'Too many team events' }, { 'Retry-After': '1' });
    return;
  }
  ingestTeam(ctx, member, events);
  ctx.team?.seen(member);
  sendJson(res, 200, { ok: true });
}

/**
 * Reads a teammate's batch: `{ v: 1, events: [{ ts, event }] }`, at most 200 well-formed items.
 * @param {Request} req
 * @returns {Promise<{ ts: number, event: Record<string, any> }[]>}
 */
async function readTeamEvents(req) {
  const raw = await readBody(req, LIMITS.teamBodyBytes);
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
  if (!isObject(body) || body.v !== 1 || !Array.isArray(body.events)) {
    throw new HttpError(400, 'Body must look like {"v":1,"events":[{"ts":<ms>,"event":{...}}]}');
  }
  return body.events.slice(0, TEAM_BATCH).filter((item) => isObject(item) && isObject(item.event));
}

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
 * GET /api/proof: the forwarder's challenge before it sends an event (or the hook secret). Only
 * the server that wrote server.json holds the response key, so a program that took over the port
 * of a dead server cannot answer it and receives nothing else (CONTRACTS §4.3).
 * @param {TownContext} ctx
 * @param {Request} req
 * @param {Response} res
 */
function handleProof(ctx, req, res) {
  const proof = proveServer(ctx.responseKey, req.headers[HOOK_NONCE_HEADER]);
  if (!proof) {
    sendJson(res, 400, { error: 'Missing or malformed nonce' });
    return;
  }
  sendJson(res, 200, { ok: true }, { [PROOF_HEADER]: proof });
}

/**
 * POST /api/hook from the forwarder: authenticate, rate-limit, read, ingest (ingest.mjs), and
 * answer: a permission request may be held for the town to decide.
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
  const request = ingestHook(ctx, body).find((envelope) => envelope.event.hook_event_name === 'PermissionRequest');
  if (request) {
    await answerPermissionRequest(ctx, req, res, request.event, shownInFull(body.event.tool_input, request.event.tool_input));
    return;
  }
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
 * Validates the forwarder's body: {"v":1,"ts":<ms>,"source"?:"codex","event":{…}}.
 * @param {Buffer} raw
 * @returns {{ ts: number, source: import('./adapters/index.mjs').Source, event: Record<string, any> }}
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
  return { ts: Number.isFinite(body.ts) ? body.ts : Date.now(), source: sourceOf(body.source), event: body.event };
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
  const wanted = ctx.settings.remoteApprovals && ctx.hub.owners > 0;
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
