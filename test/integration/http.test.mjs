import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Agent } from 'node:http';
import { connect } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { hookPayload, postHook, rawRequest, startTown } from './helpers.mjs';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;

before(async () => {
  town = await startTown();
});

after(async () => {
  await town?.stop();
});

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

describe('public endpoints', () => {
  it('answers /api/health and /api/hello without a login', async () => {
    const health = await rawRequest(town.port, { path: '/api/health' });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.text), { ok: true });
    const hello = JSON.parse((await rawRequest(town.port, { path: '/api/hello' })).text);
    assert.equal(hello.app, 'andary');
    assert.equal(hello.authenticated, false);
    assert.deepEqual(hello.settings, { remoteApprovals: false, approvalTimeoutMs: 120000, notify: false, notifyLimits: false });
    assert.match(hello.version, /^\d+\.\d+\.\d+/);
  });

  it('reports authenticated: true with the sign-in header, and never for a cookie', async () => {
    const hello = await rawRequest(town.port, { path: '/api/hello', headers: { 'x-andary-token': town.uiToken } });
    assert.equal(JSON.parse(hello.text).authenticated, true);
    const cookie = await rawRequest(town.port, { path: '/api/hello', headers: { cookie: `andary_ui=${town.uiToken}` } });
    assert.equal(JSON.parse(cookie.text).authenticated, false, 'a cookie for 127.0.0.1 reaches every port, so it signs nothing in');
  });

  it('sends the security headers on pages, APIs and errors', async () => {
    for (const path of ['/', '/api/health', '/nope.js', '/api/nope']) {
      const res = await rawRequest(town.port, { path });
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers[name], value, `${name} on ${path}`);
      const csp = String(res.headers['content-security-policy']);
      assert.match(csp, /default-src 'self'; script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/, path);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(String(res.headers['permissions-policy']), /camera=\(\)/);
    }
  });
});

describe('the forwarder\'s challenge', () => {
  it('proves the server holds the response key, and needs a well-formed nonce', async () => {
    const nonce = 'challenge-0123456789';
    const res = await rawRequest(town.port, { path: '/api/proof', headers: { 'x-andary-nonce': nonce } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-andary-proof'], createHmac('sha256', town.responseKey).update(`andary-proof\n${nonce}`).digest('base64url'));
    assert.equal((await rawRequest(town.port, { path: '/api/proof' })).status, 400);
    assert.equal((await rawRequest(town.port, { path: '/api/proof', method: 'POST' })).status, 405);
  });
});

describe('sign-in', () => {
  it('moves the token into the fragment for the page to keep, and sets no cookie', async () => {
    const res = await rawRequest(town.port, { path: `/?demo=1&token=${town.uiToken}&x=2` });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/?demo=1&x=2#signin=${town.uiToken}`);
    assert.equal(res.headers['set-cookie'], undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal((await rawRequest(town.port, { path: `/?token=${town.uiToken}` })).headers.location, `/#signin=${town.uiToken}`);
    // A page that does not read the fragment just loses the token.
    assert.equal((await rawRequest(town.port, { path: `/world-lab.html?token=${town.uiToken}&x=1` })).headers.location, '/world-lab.html?x=1');
  });

  it('answers a wrong token with a 403 page and no cookie', async () => {
    const res = await rawRequest(town.port, { path: '/?token=not-the-token' });
    assert.equal(res.status, 403);
    assert.equal(res.headers['set-cookie'], undefined);
    assert.match(res.text, /sign-in link is not valid/);
    assert.ok(!res.text.includes('not-the-token'), 'the page must not echo request data');
  });
});

describe('DNS-rebinding defence', () => {
  it('refuses requests whose Host is not ours', async () => {
    for (const host of ['evil.example', `evil.example:${town.port}`, `127.0.0.1:${town.port + 1}`, `0.0.0.0:${town.port}`]) {
      const res = await rawRequest(town.port, { path: '/api/hello', headers: { host } });
      assert.equal(res.status, 403, host);
      assert.equal(res.headers['x-frame-options'], 'DENY');
    }
  });

  it('accepts localhost and [::1] names', async () => {
    for (const host of [`localhost:${town.port}`, `[::1]:${town.port}`]) {
      assert.equal((await rawRequest(town.port, { path: '/api/health', headers: { host } })).status, 200, host);
    }
  });

  it('refuses hook posts with a foreign Host even with the secret', async () => {
    const body = JSON.stringify({ v: 1, ts: 1, event: hookPayload('Stop') });
    const res = await rawRequest(town.port, {
      method: 'POST',
      path: '/api/hook',
      headers: { host: 'attacker.example', 'x-andary-secret': town.secret, 'content-type': 'application/json' },
      body,
    });
    assert.equal(res.status, 403);
  });
});

describe('static files', () => {
  it('serves the app shell with the right type and caching', async () => {
    const res = await rawRequest(town.port, { path: '/' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(res.text, /<script type="importmap">/);
  });

  it('serves vendored modules as JavaScript, gzipped when accepted, with ETag revalidation', async () => {
    const path = '/vendor/three/three.module.js';
    const res = await rawRequest(town.port, { path, headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.match(gunzipSync(res.raw).toString('utf8'), /three/i);
    const again = await rawRequest(town.port, { path, headers: { 'accept-encoding': 'gzip', 'if-none-match': String(res.headers.etag) } });
    assert.equal(again.status, 304);
  });

  it('serves fonts as font/woff2 without compressing them', async () => {
    const res = await rawRequest(town.port, { path: '/vendor/fonts/overpass-latin-400-normal.woff2', headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'font/woff2');
    assert.equal(res.headers['content-encoding'], undefined);
  });

  it('never serves files outside public/ or dotfiles', async () => {
    const attempts = [
      '/../package.json',
      '/%2e%2e/package.json',
      '/vendor/..%2f..%2fpackage.json',
      '/..%5c..%5cpackage.json',
      '/%2e%2e%2f%2e%2e%2fserver/app.mjs',
      '/.git/config',
      '/.env',
      '/vendor/.hidden',
      '//etc/passwd',
    ];
    for (const path of attempts) {
      const res = await rawRequest(town.port, { path });
      assert.ok(res.status === 404 || res.status === 400, `${path} → ${res.status}`);
      assert.ok(!res.text.includes('"name": "andary"'), path);
    }
  });

  it('answers unknown paths with the 404 page and wrong methods with 405', async () => {
    const missing = await rawRequest(town.port, { path: '/no/such/file.js' });
    assert.equal(missing.status, 404);
    assert.match(missing.text, /Not found/);
    const post = await rawRequest(town.port, { method: 'POST', path: '/index.html', body: 'x' });
    assert.equal(post.status, 405);
    assert.equal((await rawRequest(town.port, { method: 'GET', path: '/api/hook' })).status, 405);
    assert.equal((await rawRequest(town.port, { path: '/ws' })).status, 426);
  });
});

describe('POST /api/hook', () => {
  it('requires the hook secret', async () => {
    assert.equal((await postHook(town, hookPayload('Stop'), { secret: null })).status, 401);
    assert.equal((await postHook(town, hookPayload('Stop'), { secret: 'wrong' })).status, 401);
    const ok = await postHook(town, hookPayload('Stop'));
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text), { output: null });
  });

  it('rejects malformed bodies with 400', async () => {
    assert.equal((await postHook(town, null, { rawBody: '{not json' })).status, 400);
    assert.equal((await postHook(town, null, { rawBody: JSON.stringify({ v: 1, event: 'Stop' }) })).status, 400);
  });

  it('rejects bodies over 1 MiB with 413, before reading them', async () => {
    // The server answers from the declared length and closes without reading the body, so the
    // client sends the headers only: a client still writing 1 MiB would race the close (EPIPE).
    const reply = await new Promise((resolve, reject) => {
      const socket = connect(town.port, '127.0.0.1', () => {
        socket.write(`POST /api/hook HTTP/1.1\r\nHost: 127.0.0.1:${town.port}\r\nx-andary-secret: ${town.secret}\r\ncontent-type: application/json\r\ncontent-length: ${1024 * 1024 + 1}\r\n\r\n`);
      });
      let text = '';
      socket.on('data', (chunk) => (text += chunk));
      socket.on('close', () => resolve(text));
      socket.on('error', reject);
    });
    assert.match(String(reply), /^HTTP\/1\.1 413 /);
    assert.match(String(reply), /Connection: close/i);
  });

  it('rate-limits floods with 429 (and only after authentication)', async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 64 });
    try {
      // Unauthenticated requests must not use up the real hooks' budget.
      const strangers = await Promise.all(Array.from({ length: 300 }, () => postHook(town, hookPayload('Stop'), { secret: 'wrong', agent })));
      assert.ok(strangers.every((r) => r.status === 401));
      // One burst well over the allowance (600 at once, then 300/s).
      const flood = await Promise.all(Array.from({ length: 1500 }, () => postHook(town, hookPayload('Notification', { message: 'flood' }), { agent })));
      const statuses = flood.map((r) => r.status);
      assert.ok(statuses.filter((status) => status === 200).length >= 590, 'the burst allowance is honoured');
      assert.ok(statuses.includes(429), 'requests beyond it are rate-limited');
      assert.ok(statuses.every((status) => status === 200 || status === 429));
      assert.equal(flood.find((r) => r.status === 429)?.headers['retry-after'], '1');
    } finally {
      agent.destroy();
    }
  });
});
