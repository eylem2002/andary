// Browsers connect over /ws (CONTRACTS §4.5). This module accepts them (after the Host, Origin and
// sign-in checks), sends the hello snapshot, and handles their decide/note/settings/digest/profile/ping
// messages. On a team host (§4.11) a browser is the owner (signed in on this computer, and the
// host's own person), a teammate with their personal link (a person: they may set their own
// profile and move their character, nothing else), or someone watching with the view link (a
// viewer). People and viewers get the town and its people, but not the owner's prompts, costs,
// settings or topic.
import { WS_PROTOCOL, allowedHostsFor, browserRole, isTunnelled, offersAndaryProtocol } from './auth.mjs';
import { validateProfile } from '../public/js/core/profile.js';
import { LOTS } from '../public/js/core/town-map.js';
import { LIMITS } from './config.mjs';
import { createTokenBucket } from './rate-limit.mjs';
import { isAllowedHost, isAllowedOrigin, isTunnelOrigin } from './security.mjs';
import { acceptUpgrade, rejectUpgrade, validateUpgradeRequest } from './websocket.mjs';
import { CLOSE_CODE } from './ws-frame.mjs';

/** @typedef {'owner'|'person'|'viewer'} BrowserRole */
/** @typedef {{ role: BrowserRole, person: string|null }} Who  person: the roster name (the host's for the owner on a team host) */

/** Places kept free for the owner and the people: viewers can never fill the town's last few connections. */
const OWNER_RESERVE = 4;
/** Connections one person may hold at once (say a laptop and a phone). */
const PERSON_CONNECTIONS = 2;

/**
 * The set of connected browsers and who each one is.
 * @param {number} maxClients
 */
export function createHub(maxClients) {
  /** @type {Map<import('./websocket.mjs').WsConnection, Who>} */
  const clients = new Map();
  const count = (/** @type {(who: Who) => boolean} */ test) => [...clients.values()].filter(test).length;
  return {
    get size() {
      return clients.size;
    },
    /** Signed-in browsers: only they can answer prompts. */
    get owners() {
      return count((who) => who.role === 'owner');
    },
    /** @param {BrowserRole} [role] @param {string|null} [person] */
    full(role = 'owner', person = null) {
      if (clients.size >= maxClients) return true;
      if (role === 'person') return count((who) => who.role === 'person' && who.person === person) >= PERSON_CONNECTIONS;
      return role === 'viewer' && count((who) => who.role === 'viewer') >= maxClients - OWNER_RESERVE;
    },
    /**
     * @param {import('./websocket.mjs').WsConnection} connection
     * @param {BrowserRole} [role]
     * @param {string|null} [person]
     */
    add(connection, role = 'owner', person = null) {
      clients.set(connection, { role, person });
      connection.once('close', () => clients.delete(connection));
    },
    /** @param {import('./websocket.mjs').WsConnection} connection */
    roleOf(connection) {
      return clients.get(connection)?.role ?? null;
    },
    /** The roster name a connection plays, or null. @param {import('./websocket.mjs').WsConnection} connection */
    personOf(connection) {
      return clients.get(connection)?.person ?? null;
    },
    /** Whether anyone is connected as this person. @param {string} name */
    online(name) {
      return count((who) => who.person === name) > 0;
    },
    /** @param {(connection: import('./websocket.mjs').WsConnection, role: BrowserRole) => void} fn */
    each(fn) {
      for (const [connection, who] of clients) fn(connection, who.role);
    },
    /** @param {object} message for signed-in browsers only (prompts, costs, settings) */
    broadcastOwners(message) {
      if (clients.size === 0) return;
      const text = JSON.stringify(message);
      for (const [connection, who] of clients) if (who.role === 'owner') connection.send(text);
    },
    /**
     * @param {import('./websocket.mjs').WsConnection} connection
     * @param {object} message
     */
    send(connection, message) {
      connection.send(JSON.stringify(message));
    },
    /** @param {object} message serialised once for every browser */
    broadcast(message) {
      if (clients.size === 0) return;
      this.broadcastText(JSON.stringify(message));
    },
    /** @param {string} text an already serialised message */
    broadcastText(text) {
      for (const connection of clients.keys()) connection.send(text);
    },
    /**
     * @param {number} code
     * @param {string} reason
     */
    closeAll(code, reason) {
      for (const connection of clients.keys()) connection.close(code, reason);
    },
    terminateAll() {
      for (const connection of clients.keys()) connection.terminate();
    },
  };
}

/** @typedef {ReturnType<typeof createHub>} Hub */

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @returns {{ remoteApprovals: boolean, approvalTimeoutMs: number, notify: boolean, notifyLimits: boolean }}
 */
export function publicSettings(ctx) {
  // Whether phone notifications are on, never the topic: /api/hello answers without signing in.
  return { remoteApprovals: ctx.settings.remoteApprovals, approvalTimeoutMs: ctx.settings.approvalTimeoutMs, notify: ctx.notifier.on, notifyLimits: ctx.notifier.limitNotes };
}

/**
 * The team part of a browser's settings, null when this server is not a team host.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {BrowserRole} role
 */
export function teamSettings(ctx, role) {
  return ctx.team ? { role, members: ctx.team.members() } : null;
}

/**
 * The people of a team town as every browser sees them, with who is online now; empty when this
 * server is not a team host.
 * @param {import('./app.mjs').TownContext} ctx
 * @returns {(import('./people.mjs').PersonView & { online: boolean })[]}
 */
export function peopleView(ctx) {
  const team = ctx.team;
  return team ? team.people.list().map((person) => ({ ...person, ...team.presence.view(person.name) })) : [];
}

/**
 * An error for one person's browsers only (a queued walk that was dropped).
 * @param {import('./app.mjs').TownContext} ctx @param {string} name @param {string} message
 */
export function tellPerson(ctx, name, message) {
  const text = JSON.stringify({ t: 'error', message });
  ctx.hub.each((connection) => {
    if (ctx.hub.personOf(connection) === name) connection.send(text);
  });
}

/**
 * Tells every browser where some people are now (a walk, someone came or went, a duty or the
 * lights changed); presence.mjs batches these at 10 Hz at most.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {string[]} names
 */
export function announcePresence(ctx, names) {
  const team = ctx.team;
  if (!team) return;
  const people = names.filter((name) => team.people.has(name)).map((name) => ({ name, ...team.presence.view(name) }));
  if (people.length) ctx.hub.broadcast({ t: 'presence', people });
}

/**
 * Tells every browser who lives in the town (a profile, the roster or someone's presence changed).
 * @param {import('./app.mjs').TownContext} ctx
 */
export function announcePeople(ctx) {
  if (ctx.team) ctx.hub.broadcast({ t: 'people', people: peopleView(ctx) });
}

/**
 * Closes the connections of people taken off the roster (`andary team remove`).
 * @param {import('./app.mjs').TownContext} ctx
 */
export function dropRemovedPeople(ctx) {
  const team = ctx.team;
  if (!team) return;
  const gone = [];
  ctx.hub.each((connection, role) => {
    const name = ctx.hub.personOf(connection);
    if (role === 'person' && name && !team.people.has(name)) gone.push(connection);
  });
  for (const connection of gone) connection.close(CLOSE_CODE.POLICY_VIOLATION, 'Removed from the team');
  const names = new Set(team.people.list().map((person) => person.name));
  team.presence.forgetAllBut(names);
}

/**
 * Settings as one browser may see them: a viewer or a teammate never sees the owner's approval or phone settings.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {BrowserRole} role
 */
function settingsFor(ctx, role) {
  const settings = role === 'owner' ? publicSettings(ctx) : { remoteApprovals: false, approvalTimeoutMs: ctx.settings.approvalTimeoutMs, notify: false, notifyLimits: false };
  return ctx.team ? { ...settings, team: teamSettings(ctx, role) } : settings;
}

/**
 * Tells every browser who is in the team town (a teammate's first events just arrived).
 * @param {import('./app.mjs').TownContext} ctx
 */
export function announceTeam(ctx) {
  ctx.hub.each((connection, role) => ctx.hub.send(connection, { t: 'settings', settings: { team: teamSettings(ctx, role) } }));
}

/**
 * Handles an HTTP upgrade request on the server.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head
 */
export function handleUpgrade(ctx, req, socket, head) {
  socket.on('error', () => socket.destroy());
  // This runs in the server's 'upgrade' event: anything thrown here would end the process.
  try {
    upgrade(ctx, req, socket, head);
  } catch (error) {
    ctx.log(`Could not open a browser connection (${error?.code ?? error?.name ?? 'unknown'})`);
    socket.destroy();
  }
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:stream').Duplex} socket
 * @param {Buffer} head
 */
function upgrade(ctx, req, socket, head) {
  const who = browserRole(req, ctx.uiToken, ctx.team);
  const verdict = checkUpgrade(ctx, req, who);
  if (!verdict.ok) {
    rejectUpgrade(socket, verdict.status, verdict.message, verdict.headers);
    return;
  }
  const connection = acceptUpgrade(socket, verdict.key, head, {
    protocol: offersAndaryProtocol(req) ? WS_PROTOCOL : null,
    maxMessageBytes: LIMITS.wsMessageBytes,
    maxBufferedBytes: LIMITS.wsBufferedBytes,
    heartbeatMs: LIMITS.wsHeartbeatMs,
  });
  // checkUpgrade refuses a browser without a role.
  const { role, person } = /** @type {NonNullable<typeof who>} */ (who);
  // On a team host the owner plays the host's own person.
  attachBrowser(ctx, connection, role, role === 'owner' ? (ctx.team?.people.host ?? null) : person);
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {ReturnType<typeof browserRole>} who
 * @returns {import('./websocket.mjs').UpgradeVerdict}
 */
function checkUpgrade(ctx, req, who) {
  // Through the tunnel only its own name, as Host and as Origin (ADR 0019).
  const hosts = allowedHostsFor(req, ctx);
  if (!isAllowedHost(req.headers.host, hosts)) return { ok: false, status: 403, message: 'Forbidden host' };
  if (pathOf(req.url) !== '/ws') return { ok: false, status: 404, message: 'Not found' };
  const handshake = validateUpgradeRequest(req);
  if (!handshake.ok) return handshake;
  const origin = isTunnelled(req) ? isTunnelOrigin(req.headers.origin, hosts) : isAllowedOrigin(req.headers.origin, hosts);
  if (!origin) return { ok: false, status: 403, message: 'Forbidden origin' };
  if (!who) return { ok: false, status: 401, message: 'Sign in with the link printed by andary start' };
  if (ctx.hub.full(who.role, who.person)) return { ok: false, status: 503, message: 'Too many browser connections' };
  return handshake;
}

/**
 * @param {string|undefined} rawUrl
 * @returns {string|null}
 */
function pathOf(rawUrl) {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return null;
  }
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {BrowserRole} role
 * @param {string|null} person  the roster name this browser plays
 */
function attachBrowser(ctx, connection, role, person) {
  ctx.hub.add(connection, role, person);
  const owner = role === 'owner';
  if (owner) cancelRelease(ctx);
  ctx.log(`${BROWSER_LOG[role]} connected (${ctx.hub.size} open)`);
  // Online before the hello, so it already says so.
  if (person) ctx.team?.presence.connect(person);
  ctx.hub.send(connection, {
    t: 'hello',
    version: ctx.version,
    serverTime: Date.now(),
    settings: settingsFor(ctx, role),
    history: ctx.history.list(),
    approvals: owner ? ctx.broker.list() : [],
    notes: owner ? ctx.notes.list() : [],
    usage: owner ? ctx.usage.snapshot() : { agents: [], days: [] },
    limits: owner ? ctx.limits.snapshot() : { accounts: [], contexts: {} },
    git: owner ? (ctx.git?.snapshot() ?? []) : [],
    progress: ctx.progress.snapshot(),
    notifyUrl: owner ? ctx.notifier.url : null,
    // The latest time the owner was away: a page opened after one offers to catch up.
    away: owner ? ctx.digest.away() : null,
    people: peopleView(ctx),
    me: person,
  });
  const limiter = createTokenBucket({ ratePerSecond: LIMITS.wsMessagesPerSecond, burst: LIMITS.wsMessageBurst });
  connection.on('message', (text) => {
    if (!limiter.take()) {
      connection.close(CLOSE_CODE.POLICY_VIOLATION, 'Too many messages');
      return;
    }
    handleBrowserMessage(ctx, connection, text);
  });
  connection.on('close', () => {
    ctx.log(`${BROWSER_LOG[role]} disconnected (${ctx.hub.size} open)`);
    if (ctx.hub.owners === 0) scheduleRelease(ctx);
    if (person) ctx.team?.presence.disconnect(person);
  });
}

/** How the log names each kind of browser (never who). */
const BROWSER_LOG = Object.freeze({ owner: 'Browser', person: 'Teammate', viewer: 'Team viewer' });

/** What each role may send besides the owner's full set: a viewer only pings. */
const ALLOWED = Object.freeze({ person: new Set(['profile', 'walk', 'emote', 'phrase', 'look', 'ping']), viewer: new Set(['ping']) });

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {string} text
 */
function handleBrowserMessage(ctx, connection, text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    sendError(ctx, connection, 'Messages must be JSON');
    return;
  }
  const role = ctx.hub.roleOf(connection);
  if (role && role !== 'owner' && !ALLOWED[role].has(message?.t)) {
    sendError(ctx, connection, role === 'viewer'
      ? 'Viewers can only watch: the team town\'s host answers prompts and changes settings.'
      : 'Teammates can change their own character only: the team town\'s host answers prompts and changes settings.');
    return;
  }
  switch (message?.t) {
    case 'decide': {
      const result = ctx.broker.decide(message.id, message.decision, message.message, message.always, message.stop);
      if (!result.ok) sendError(ctx, connection, result.error);
      return;
    }
    case 'note':
      sendNote(ctx, connection, message);
      return;
    case 'settings':
      applySettings(ctx, connection, message.settings);
      return;
    case 'notify-test':
      void ctx.notifier.test().then((ok) => ctx.hub.send(connection, { t: 'notify-test', ok }));
      return;
    case 'digest':
      sendDigest(ctx, connection, message.since);
      return;
    case 'profile':
      applyProfile(ctx, connection, message.p);
      return;
    case 'walk':
    case 'emote':
    case 'phrase':
    case 'look':
      applyPresence(ctx, connection, message);
      return;
    case 'ping':
      return;
    default:
      sendError(ctx, connection, 'Unknown message type');
  }
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {any} settings
 */
function applySettings(ctx, connection, settings) {
  if (typeof settings?.remoteApprovals !== 'boolean') {
    sendError(ctx, connection, 'settings.remoteApprovals must be true or false');
    return;
  }
  if (ctx.settings.remoteApprovals !== settings.remoteApprovals) {
    ctx.settings.remoteApprovals = settings.remoteApprovals;
    ctx.log(`Remote approvals turned ${settings.remoteApprovals ? 'on' : 'off'} from the town`);
  }
  ctx.hub.broadcastOwners({ t: 'settings', settings: publicSettings(ctx) });
  // Nobody may answer from the town any more: give waiting prompts back to the terminal.
  if (!settings.remoteApprovals) ctx.broker.releaseAll();
}

/**
 * Saves `{ t: 'profile', p }` for the person this browser plays, after validateProfile, and tells
 * everyone. The sender learns which colour it got (another may hold the one it asked for).
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {unknown} raw
 */
function applyProfile(ctx, connection, raw) {
  const name = ctx.hub.personOf(connection);
  if (!ctx.team || !name) {
    sendError(ctx, connection, 'Only the people of a team town have a character.');
    return;
  }
  const check = validateProfile(raw);
  if (!check.ok) {
    sendError(ctx, connection, `Profile not saved: ${check.error}.`);
    return;
  }
  const result = ctx.team.people.setProfile(name, check.profile);
  if (!result) sendError(ctx, connection, 'You are no longer on the team.');
  else if ('wait' in result) sendError(ctx, connection, 'Wait a few seconds before changing your character again.');
  else if ('error' in result) sendError(ctx, connection, `Profile not saved: ${result.error}.`);
  else ctx.hub.send(connection, { t: 'profile', ok: true, color: result.color, asked: check.profile.color });
}

/**
 * `walk`, `emote`, `phrase` and `look` from the person this browser plays (never a name from the
 * message): checked by presence.mjs, then shown to everyone, or a look only to its target.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {Record<string, any>} message
 */
function applyPresence(ctx, connection, message) {
  const name = ctx.hub.personOf(connection);
  const team = ctx.team;
  if (!team || !name) {
    sendError(ctx, connection, 'Only the people of a team town have a character.');
    return;
  }
  if (message.t === 'walk') {
    const result = team.presence.walk(name, message.to);
    if (!result.ok) sendError(ctx, connection, /** @type {string} */ (result.error));
    return;
  }
  if (message.t === 'look') {
    lookAsk(ctx, connection, name, message);
    return;
  }
  const result = team.presence.say(name, message.t, message.id);
  if (result.ok) ctx.hub.broadcast({ t: message.t, name, id: message.id });
  else sendError(ctx, connection, /** @type {string} */ (result.error));
}

/**
 * "Come look": goes only to the target person's browsers, as `look-ask`.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {string} from
 * @param {Record<string, any>} message
 */
function lookAsk(ctx, connection, from, message) {
  const at = lookTarget(message.at);
  const to = typeof message.to === 'string' ? message.to : '';
  // An agent must be one the town has seen: a look never carries a made-up key to a teammate.
  const known = at && (!('agent' in at) || ctx.team?.presence.knowsAgent(at.agent));
  if (!known || !ctx.team?.people.has(to)) {
    sendError(ctx, connection, 'look.to is a teammate, and look.at an agent or a building');
    return;
  }
  const result = ctx.team.presence.look(from, to);
  if (!result.ok) {
    sendError(ctx, connection, /** @type {string} */ (result.error));
    return;
  }
  const text = JSON.stringify({ t: 'look-ask', from, at });
  ctx.hub.each((other) => {
    if (ctx.hub.personOf(other) === to) other.send(text);
  });
}

/**
 * What a look points at: an agent key (as the town knows it) or a building.
 * @param {unknown} at
 * @returns {{ agent: string }|{ building: string }|null}
 */
function lookTarget(at) {
  if (!at || typeof at !== 'object') return null;
  const value = /** @type {Record<string, unknown>} */ (at);
  if (typeof value.agent === 'string' && value.agent.length > 0 && value.agent.length <= 200 && Object.keys(value).length === 1) return { agent: value.agent };
  if (typeof value.building === 'string' && Object.hasOwn(LOTS, value.building) && Object.keys(value).length === 1) return { building: value.building };
  return null;
}

/**
 * Answers `{ t: 'digest', since }` with what each of the owner's crews did since then, to the
 * browser that asked only (a viewer never gets this far). `since` is a time in milliseconds on
 * the server's clock; 0 asks for everything kept.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {unknown} since
 */
function sendDigest(ctx, connection, since) {
  if (typeof since !== 'number' || !Number.isFinite(since) || since < 0) {
    sendError(ctx, connection, 'digest.since must be a time in milliseconds');
    return;
  }
  ctx.hub.send(connection, { t: 'digest', d: ctx.digest.summary(since) });
}

/**
 * Answers `{ t: 'note', ref?, sessionId, agentId?, text }` (CONTRACTS §4.15): the owner's note for
 * one of this computer's agents, queued for its next step. Viewers never get this far; a
 * teammate's agent is refused (server/notes.mjs). Notes that would be queued have a budget of
 * their own, besides the socket's. The browser that sent it gets `{ t: 'note-reply', ref, ok,
 * error? }` with its own `ref`, so it keeps the text until the note is queued, and keeps it with
 * the reason when it is refused.
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {Record<string, unknown>} message
 */
function sendNote(ctx, connection, message) {
  const result = ctx.notes.send(message, () => ctx.noteLimiter.take());
  const ref = typeof message.ref === 'string' && /^[\w-]{1,64}$/.test(message.ref) ? message.ref : null;
  ctx.hub.send(connection, 'error' in result ? { t: 'note-reply', ref, ok: false, error: `The note was not sent: ${result.error}.` } : { t: 'note-reply', ref, ok: true, id: result.note.id });
}

/**
 * @param {import('./app.mjs').TownContext} ctx
 * @param {import('./websocket.mjs').WsConnection} connection
 * @param {string} message
 */
function sendError(ctx, connection, message) {
  ctx.hub.send(connection, { t: 'error', message });
}

/**
 * With no browser left, held prompts would block Claude until the timeout. A short grace period
 * lets a reloading page reconnect before they are handed back to the terminal.
 * @param {import('./app.mjs').TownContext} ctx
 */
function scheduleRelease(ctx) {
  if (ctx.broker.heldCount() === 0 || ctx.graceTimer) return;
  ctx.graceTimer = setTimeout(() => {
    ctx.graceTimer = null;
    if (ctx.hub.owners === 0) ctx.broker.releaseAll();
  }, LIMITS.browserGraceMs);
  ctx.graceTimer.unref?.();
}

/** @param {import('./app.mjs').TownContext} ctx */
function cancelRelease(ctx) {
  if (ctx.graceTimer) clearTimeout(ctx.graceTimer);
  ctx.graceTimer = null;
}
