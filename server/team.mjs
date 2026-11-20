// The team town (CONTRACTS §4.11). One person hosts (`andary start --team`); each teammate's own
// Andary relays its sanitized hook events there (`--share-to <url> --team-key <key>`), so the
// host's town shows everyone's crews, each marked with its member's name. Teammates can watch
// the shared town with a view-only link: they never get the host's sign-in, so they cannot answer
// permission prompts or change settings. Keys are HMACs of one team secret kept in
// <ANDARY_HOME>/team.json; `andary team reset` makes a new secret, which revokes every key and link.
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { safeEqual } from './auth.mjs';
import { createTokenBucket } from './rate-limit.mjs';

export const TEAM_HEADER = 'x-andary-team';
const MAX_NAME_CHARS = 24;

/**
 * A member's name as it is shown and keyed: letters, digits, spaces, dots, dashes and
 * underscores, at most 24 characters. Null when nothing is left.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function cleanMemberName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(name).slice(0, MAX_NAME_CHARS).join('').trim();
  return chars || null;
}

/**
 * The team secret, made on first use.
 * @param {string} home
 * @param {{ create?: boolean, fresh?: boolean }} [options]  fresh: replace it (revokes every key)
 * @returns {string|null}
 */
export function teamSecret(home, { create = true, fresh = false } = {}) {
  const file = join(home, 'team.json');
  if (!fresh && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof saved?.secret === 'string' && saved.secret.length >= 32) return saved.secret;
    } catch {
      // made again below
    }
  }
  if (!create && !fresh) return null;
  const secret = randomBytes(32).toString('base64url');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ secret }, null, 2)}\n`, { mode: 0o600 });
  return secret;
}

/** @param {string} secret @param {string} purpose */
function mac(secret, purpose) {
  return createHmac('sha256', secret).update(purpose).digest('base64url').slice(0, 32);
}

/**
 * A teammate's key: their name, a dot, and an HMAC of the name. Names are percent-encoded so a
 * dot in a name cannot be confused with the separator.
 * @param {string} secret
 * @param {string} name  already cleaned
 */
export function memberKey(secret, name) {
  return `${encodeURIComponent(name)}.${mac(secret, `member:${name}`)}`;
}

/**
 * The member a key belongs to, or null.
 * @param {string} secret
 * @param {unknown} key
 * @returns {string|null}
 */
export function verifyMemberKey(secret, key) {
  if (typeof key !== 'string' || key.length > 200) return null;
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return null;
  let name;
  try {
    name = decodeURIComponent(key.slice(0, dot));
  } catch {
    return null;
  }
  if (cleanMemberName(name) !== name) return null;
  return safeEqual(key.slice(dot + 1), mac(secret, `member:${name}`)) ? name : null;
}

/**
 * The view-only token of the team's shared town.
 * @param {string} secret
 */
export function viewToken(secret) {
  return mac(secret, 'view');
}

/**
 * This computer's addresses on its local networks (IPv4, not loopback), for the invite and for
 * the Host check when the server listens on every interface.
 * @returns {string[]}
 */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

/**
 * Teammates one town keeps track of; more keys still work, they just share one rate limit.
 * Rates count events, not requests (one request carries up to 200).
 */
const MAX_MEMBERS = 50;

/**
 * The host side of a team town: the secret, the view token, a rate limit per member and the list
 * of members seen since the server started.
 * @param {{ secret: string, onMember?: (members: string[]) => void, ratePerSecond?: number, burst?: number }} options
 */
export function createTeamHost({ secret, onMember = () => {}, ratePerSecond = 300, burst = 600 }) {
  /** @type {Map<string, import('./rate-limit.mjs').TokenBucket>} */
  const buckets = new Map();
  const overflow = createTokenBucket({ ratePerSecond, burst });
  /** @type {string[]} */
  const members = [];
  return {
    secret,
    view: viewToken(secret),
    /** @param {string} member */
    limiter(member) {
      let bucket = buckets.get(member);
      if (!bucket) {
        if (buckets.size >= MAX_MEMBERS) return overflow;
        bucket = createTokenBucket({ ratePerSecond, burst });
        buckets.set(member, bucket);
      }
      return bucket;
    },
    /** @param {string} member */
    seen(member) {
      if (members.includes(member) || members.length >= MAX_MEMBERS) return;
      members.push(member);
      onMember([...members]);
    },
    members: () => [...members],
  };
}

/**
 * @typedef {object} RelayOptions
 * @property {string} url         the host's base URL, e.g. http://192.168.1.20:4747
 * @property {string} key         this member's key
 * @property {typeof fetch} [fetchImpl]
 * @property {(message: string) => void} [log]
 * @property {number} [flushMs]
 */

const MAX_QUEUE = 1000;
const MAX_BATCH = 100;

/**
 * Sends this computer's (sanitized) hook events to the team's host, in small batches. If the host
 * is away the queue keeps the latest 1,000 and retries with a growing pause (up to 30 s).
 * @param {RelayOptions} options
 */
export function createTeamRelay({ url, key, fetchImpl = globalThis.fetch, log = () => {}, flushMs = 500 }) {
  const endpoint = new URL('/api/team', url).href;
  /** @type {{ ts: number, event: object }[]} */
  let queue = [];
  let backoff = 0;
  let sending = false;
  let failing = false;
  /** @type {NodeJS.Timeout|null} */
  let timer = null;

  function schedule(ms = flushMs) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
    timer.unref?.();
  }

  async function flush() {
    if (sending || queue.length === 0) return;
    sending = true;
    const batch = queue.slice(0, MAX_BATCH);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [TEAM_HEADER]: key },
        body: JSON.stringify({ v: 1, events: batch }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      queue = queue.slice(batch.length);
      backoff = 0;
      if (failing) log('Sharing with the team town again');
      failing = false;
    } catch (error) {
      backoff = Math.min(30_000, backoff ? backoff * 2 : 1000);
      if (!failing) log(`Could not reach the team town (${/** @type {Error} */ (error).message ?? 'error'}); retrying`);
      failing = true;
    } finally {
      sending = false;
    }
    if (queue.length) schedule(backoff || flushMs);
  }

  return {
    /** @param {{ ts: number, event: object }} envelope  sanitized */
    send(envelope) {
      queue.push({ ts: envelope.ts, event: envelope.event });
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      schedule(backoff || flushMs);
    },
    get pending() {
      return queue.length;
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
