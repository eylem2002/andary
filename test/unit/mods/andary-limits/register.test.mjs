// The andary-limits mod's hooks module (mods/andary-limits/hooks/register.js), run in Node with a
// fake `$` and `on`. The fake server answers the proof with the real server's own code
// (server/auth.mjs), so the module's HMAC, built on SHA-256 digests, is checked against it.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { proveServer } from '../../../../server/auth.mjs';
import { register, settled } from '../../../../mods/andary-limits/hooks/register.js';

const RESPONSE_KEY = 'k3y-from-server-json_0123456789abcdefABCDEF';
const SERVER = { pid: 1, port: 4747, host: '127.0.0.1', secret: 'hook-secret', responseKey: RESPONSE_KEY };
const USAGE = {
  startedAt: '2026-11-21T10:00:00.000Z',
  context: { tokens: 182_340, window: 1_000_000, percent: 18 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-21T15:40:00.000Z' },
    { kind: 'seven_day', percentUsed: 12.5, resetsAt: '2026-11-25T09:00:00.000Z' },
  ],
  cost: { usd: 3.21 },
};

/** The hook register() adds, captured by a fake `on`. */
function measureHook() {
  /** @type {[string, Function][]} */
  const hooks = [];
  register((/** @type {string} */ event, /** @type {Function} */ hook) => hooks.push([event, hook]));
  assert.deepEqual(hooks.map(([event]) => event), ['session.measure']);
  return hooks[0][1];
}

/**
 * A fake mods API: environment variables, files and a server that proves itself as Andary does.
 * @param {{ env?: Record<string, string>, files?: Record<string, string>, usage?: unknown, answer?: (url: string, init: any) => any }} [options]
 */
function fakeMods({ env = { HOME: '/home/u' }, files = { '/home/u/.andary/server.json': JSON.stringify(SERVER) }, usage = USAGE, answer } = {}) {
  /** @type {{ url: string, init: any }[]} */
  const fetches = [];
  const reads = [];
  const $ = {
    env: { get: async (/** @type {string} */ name) => env[name] },
    fs: {
      read: async (/** @type {string} */ path) => {
        reads.push(path);
        if (!(path in files)) throw new Error(`ENOENT: ${path}`);
        return files[path];
      },
    },
    session: { usage: async () => usage, id: async () => 'session-7', version: async () => ({ version: '2.1.330', builtAt: '2026-11-20T17:34:37Z' }) },
    http: {
      fetch: async (/** @type {string} */ url, /** @type {any} */ init) => {
        fetches.push({ url, init });
        if (answer) return answer(url, init);
        if (url.endsWith('/api/proof')) return { status: 200, ok: true, headers: { 'x-andary-proof': proveServer(RESPONSE_KEY, init.headers['x-andary-nonce']) }, text: '{"ok":true}' };
        return { status: 200, ok: true, headers: {}, text: '{"ok":true}' };
      },
    },
  };
  return { $, fetches, reads };
}

/** What `next(e)` resolves to: the hook must hand it back unchanged. */
const NEXT_RESULT = Object.freeze({ changed: ['rateLimits'] });
const next = async () => NEXT_RESULT;

describe('the andary-limits mod', () => {
  afterEach(() => settled());

  it('sends the limits, the exact context, the session and the version after proving the server', async () => {
    const { $, fetches, reads } = fakeMods({ env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/home/u/.claude-work' } });
    assert.equal(await measureHook()($, Object.freeze({ changed: ['rateLimits'] }), next), NEXT_RESULT);
    await settled();
    assert.deepEqual(reads, ['/home/u/.andary/server.json']);
    assert.deepEqual(fetches.map((f) => f.url), ['http://127.0.0.1:4747/api/proof', 'http://127.0.0.1:4747/api/limits']);
    // The challenge carries a fresh nonce and nothing else, not the secret.
    assert.match(fetches[0].init.headers['x-andary-nonce'], /^[\w-]{22}$/);
    assert.deepEqual(Object.keys(fetches[0].init.headers), ['x-andary-nonce']);
    const post = fetches[1].init;
    assert.equal(post.method, 'POST');
    assert.deepEqual(post.headers, { 'content-type': 'application/json', 'x-andary-secret': 'hook-secret' });
    // Numbers only: no cost, no start time, nothing from the conversation.
    assert.deepEqual(JSON.parse(post.body), {
      v: 1,
      sessionId: 'session-7',
      claudeVersion: '2.1.330',
      configDir: '/home/u/.claude-work',
      limits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-21T15:40:00.000Z' },
        { kind: 'seven_day', percentUsed: 12.5, resetsAt: '2026-11-25T09:00:00.000Z' },
      ],
      context: { tokens: 182_340, window: 1_000_000 },
    });
  });

  it('sends nothing, not even the secret, to a server that cannot prove it wrote server.json', async () => {
    for (const answer of [
      () => ({ status: 200, ok: true, headers: { 'x-andary-proof': proveServer('another-key', 'nonce-of-someone-else') }, text: '' }),
      () => ({ status: 200, ok: true, headers: {}, text: '' }),
      (/** @type {string} */ _url, /** @type {any} */ init) => ({ status: 403, ok: false, headers: { 'x-andary-proof': proveServer(RESPONSE_KEY, init.headers['x-andary-nonce']) }, text: '' }),
      () => ({ status: 200, ok: true, headers: { 'x-andary-proof': 'not base64url!' }, text: '' }),
    ]) {
      const { $, fetches } = fakeMods({ answer });
      await measureHook()($, {}, next);
      await settled();
      assert.deepEqual(fetches.map((f) => f.url), ['http://127.0.0.1:4747/api/proof']);
    }
  });

  it('survives Andary not running: no server.json, a broken one, or nobody on the port', async () => {
    const down = [
      fakeMods({ files: {} }),
      fakeMods({ files: { '/home/u/.andary/server.json': '{"port":' } }),
      fakeMods({ files: { '/home/u/.andary/server.json': JSON.stringify({ port: 4747 }) } }),
      fakeMods({ answer: () => Promise.reject(new Error('ECONNREFUSED')) }),
    ];
    const unhandled = [];
    const onUnhandled = (/** @type {unknown} */ reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const { $ } of down) {
        assert.equal(await measureHook()($, {}, next), NEXT_RESULT);
        await settled();
      }
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.deepEqual(unhandled, []);
    // Without server.json it reads one file and fetches nothing.
    assert.equal(down[0].fetches.length, 0);
    assert.equal(down[2].fetches.length, 0);
  });

  it('never throws into the session, whatever the mods API does', async () => {
    const thrower = () => {
      throw new Error('refused by a policy mod');
    };
    const broken = { env: { get: thrower }, fs: { read: thrower }, session: { usage: thrower }, http: { fetch: thrower } };
    for (const api of [broken, {}, undefined]) {
      assert.equal(await measureHook()(/** @type {any} */ (api), {}, next), NEXT_RESULT);
      await settled();
    }
    // A refused usage() ends the report after the proof; nothing is posted.
    const refused = fakeMods();
    refused.$.session.usage = async () => {
      throw new Error('session.usage refused');
    };
    assert.equal(await measureHook()(refused.$, {}, next), NEXT_RESULT);
    await settled();
    assert.deepEqual(refused.fetches.map((f) => f.url), ['http://127.0.0.1:4747/api/proof']);
  });

  it('returns at once while Andary is slow, and sends one more report of the newest numbers afterwards', async () => {
    /** @type {() => void} */
    let release = () => {};
    const slow = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    let usage = USAGE;
    const { $, fetches } = fakeMods({
      answer: async (url, init) => {
        if (url.endsWith('/api/proof')) {
          if (fetches.length === 1) await slow; // the first proof hangs, as a stalled server would
          return { status: 200, ok: true, headers: { 'x-andary-proof': proveServer(RESPONSE_KEY, init.headers['x-andary-nonce']) }, text: '' };
        }
        return { status: 200, ok: true, headers: {}, text: '' };
      },
    });
    $.session.usage = async () => usage;
    const measure = measureHook();
    // Fails, instead of hanging, when the hook waits for the stalled report.
    const hook = async (/** @type {any[]} */ ...args) => {
      /** @type {NodeJS.Timeout|undefined} */
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('the hook waited for Andary')), 1000);
      });
      try {
        return await Promise.race([measure(...args), late]);
      } finally {
        clearTimeout(timer);
      }
    };
    const started = performance.now();
    // Well inside the 10-second limit: the hook does not wait for Andary at all.
    assert.equal(await hook($, {}, next), NEXT_RESULT);
    usage = { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 43, resetsAt: '2026-11-21T15:40:00.000Z' }] };
    assert.equal(await hook($, {}, next), NEXT_RESULT);
    usage = { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 44, resetsAt: '2026-11-21T15:40:00.000Z' }] };
    assert.equal(await hook($, {}, next), NEXT_RESULT);
    assert.ok(performance.now() - started < 500, 'the hook returned without waiting');
    // Readings that came while one report waited make one more report, not two.
    assert.equal(fetches.length, 1);
    release();
    await settled();
    const posts = fetches.filter((f) => f.url.endsWith('/api/limits')).map((f) => JSON.parse(f.init.body).limits[0].percentUsed);
    assert.deepEqual(posts, [44, 44]);
  });

  it('finds Andary through ANDARY_HOME or USERPROFILE, and reaches a wildcard host at 127.0.0.1', async () => {
    const custom = fakeMods({ env: { ANDARY_HOME: '/srv/andary/', HOME: '/home/u' }, files: { '/srv/andary/server.json': JSON.stringify({ ...SERVER, host: '0.0.0.0', port: 5000 }) } });
    await measureHook()(custom.$, {}, next);
    await settled();
    assert.equal(custom.fetches.at(-1)?.url, 'http://127.0.0.1:5000/api/limits');
    const windows = fakeMods({ env: { USERPROFILE: 'C:\\Users\\u' }, files: { 'C:\\Users\\u/.andary/server.json': JSON.stringify({ ...SERVER, host: '::1' }) } });
    await measureHook()(windows.$, {}, next);
    await settled();
    assert.equal(windows.fetches.at(-1)?.url, 'http://[::1]:4747/api/limits');
  });

  it('reports only to a town on this computer: a loopback address, localhost or a wildcard', async () => {
    for (const [host, url] of [['localhost', 'http://localhost:4747/api/proof'], ['127.0.0.2', 'http://127.0.0.2:4747/api/proof'], ['[::1]', 'http://[::1]:4747/api/proof'], ['::', 'http://127.0.0.1:4747/api/proof']]) {
      const { $, fetches } = fakeMods({ files: { '/home/u/.andary/server.json': JSON.stringify({ ...SERVER, host }) } });
      await measureHook()($, {}, next);
      await settled();
      assert.equal(fetches[0]?.url, url, host);
    }
    for (const host of ['192.168.1.20', 'andary.example', '127.0.0.1.example', '10.0.0.1']) {
      const { $, fetches } = fakeMods({ files: { '/home/u/.andary/server.json': JSON.stringify({ ...SERVER, host }) } });
      await measureHook()($, {}, next);
      await settled();
      assert.deepEqual(fetches, [], host);
    }
  });

  it('starts a new report for a reading that comes after the last one ended', async () => {
    const { $, fetches } = fakeMods();
    const hook = measureHook();
    await hook($, {}, next);
    await settled();
    await hook($, {}, next);
    await settled();
    assert.equal(fetches.filter((f) => f.url.endsWith('/api/limits')).length, 2);
  });

  it('sends only well-formed limits, and no context before the first answer', async () => {
    const { $, fetches } = fakeMods({ usage: { context: { window: 1_000_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 'lots', resetsAt: 'x' }, { kind: 'spend_limit', percentUsed: 7, resetsAt: '2026-12-01T00:00:00.000Z', usedUsd: 70 }, 'junk'] } });
    await measureHook()($, {}, next);
    await settled();
    const body = JSON.parse(fetches[1].init.body);
    assert.deepEqual(body.limits, [{ kind: 'spend_limit', percentUsed: 7, resetsAt: '2026-12-01T00:00:00.000Z' }]);
    assert.equal(body.context, null);
    assert.equal(body.configDir, null);
  });
});
