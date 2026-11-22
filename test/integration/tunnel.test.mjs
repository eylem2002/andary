// `andary start --team --tunnel` with a fake cloudflared on the PATH (no network): it prints a
// Quick Tunnel's address like the real one and stays up; the tests then play cloudflared's part,
// sending requests from 127.0.0.1 to the town's tunnel port with the tunnel's Host header.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ROOT_DIR } from '../../server/config.mjs';
import { isProcessAlive, readStateFile } from '../../server/state-file.mjs';
import { createTeamRelay, memberKey, teamSecret, viewToken } from '../../server/team.mjs';
import { connectWebSocket } from '../../server/ws-client.mjs';
import { closeBrowser, hookPayload, rawRequest, startTown, waitForMessage } from './helpers.mjs';

const CLI = join(ROOT_DIR, 'cli', 'andary.mjs');
const TUNNEL = 'https://seasonal-deck-organisms-sf.trycloudflare.com';
const TUNNEL_HOST = 'seasonal-deck-organisms-sf.trycloudflare.com';
// Cloudflare's edge adds these; cloudflared passes them on with the tunnel's Host.
const FROM_CLOUDFLARE = { host: TUNNEL_HOST, 'cf-connecting-ip': '203.0.113.9', 'cf-ray': '8f0e1d2c3b4a-AMS', 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' };

// A stand-in for cloudflared: `tunnel --help` lists --allowed-mail unless FAKE_NO_MAIL is set;
// `tunnel …` writes its arguments to FAKE_LOG, prints the address (unless FAKE_SILENT) like
// cloudflared 2026.11.1, and runs until it is stopped.
const FAKE = `#!${process.execPath}
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(process.env.FAKE_NO_MAIL ? '   --url value   URL' : '   --allowed-mail value   Email addresses or wildcard domains');
  process.exit(0);
}
if (process.env.FAKE_LOG) writeFileSync(process.env.FAKE_LOG, JSON.stringify({ args, pid: process.pid, andaryEnv: Object.keys(process.env).filter((name) => name.startsWith('ANDARY_')) }));
process.stderr.write('2026-11-22T19:11:16Z INF Requesting new quick Tunnel on trycloudflare.com...\\n');
if (!process.env.FAKE_SILENT) {
  process.stderr.write('2026-11-22T19:11:17Z INF +----------------------------------------------------------+\\n');
  process.stderr.write('2026-11-22T19:11:17Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\\n');
  process.stderr.write('2026-11-22T19:11:17Z INF |  ${TUNNEL}                                      |\\n');
}
setInterval(() => {}, 1000);
process.on('SIGTERM', () => process.exit(0));
`;

/** @type {string} */
let scratch;
/** @type {string} */
let fakeBin;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tt-tunnel-'));
  fakeBin = join(scratch, 'bin');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'cloudflared'), FAKE);
  chmodSync(join(fakeBin, 'cloudflared'), 0o755);
});
after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * The environment for a town with the fake cloudflared first on the PATH and a HOME of its own
 * (cloudflared's ~/.cloudflared/config.yml lives there).
 * @param {string} name
 * @param {Record<string, string>} [extra]
 */
function tunnelEnv(name, extra = {}) {
  const home = join(scratch, name, 'user-home');
  mkdirSync(home, { recursive: true });
  return { PATH: `${fakeBin}${delimiter}${process.env.PATH}`, HOME: home, FAKE_LOG: join(scratch, name, 'cloudflared.json'), ...extra };
}

/**
 * Runs the CLI to its end.
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {Promise<{ code: number|null, output: string, home: string }>}
 */
function runCli(args, env) {
  return new Promise((resolve) => {
    const root = mkdtempSync(join(scratch, 'cli-'));
    const child = spawn(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, ANDARY_HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'claude'), ...env } });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output, home: join(root, 'home') });
    });
  });
}

/**
 * A request as cloudflared delivers it: from 127.0.0.1, to the tunnel port.
 * @param {number} port
 * @param {Parameters<typeof rawRequest>[1]} [options]
 */
function viaTunnel(port, options = {}) {
  return rawRequest(port, { ...options, headers: { ...FROM_CLOUDFLARE, ...options.headers } });
}

/**
 * A WebSocket through the tunnel, offering `protocols`, from a page at the tunnel's address.
 * @param {number} port
 * @param {string} protocols
 * @param {Record<string, string>} [headers]
 */
function socketViaTunnel(port, protocols, headers = {}) {
  return connectWebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { ...FROM_CLOUDFLARE, Origin: TUNNEL, 'Sec-WebSocket-Protocol': protocols, ...headers } });
}

describe('Team town on the internet (--tunnel)', { skip: process.platform === 'win32' ? 'the fake cloudflared is a script with a shebang' : false }, () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  /** @type {number} */
  let tunnelPort;
  /** @type {string} */
  let secret;
  /** @type {Record<string, any>} */
  let launched;

  before(async () => {
    const env = tunnelEnv('main');
    town = await startTown({ args: ['--team', '--tunnel'], env });
    launched = JSON.parse(readFileSync(env.FAKE_LOG, 'utf8'));
    tunnelPort = Number(new URL(launched.args[launched.args.indexOf('--url') + 1]).port);
    secret = /** @type {string} */ (teamSecret(town.home, { create: false }));
  });
  after(() => town?.stop());

  it('starts cloudflared at a loopback port of its own and records the address', () => {
    assert.deepEqual(launched.args.slice(0, 3), ['tunnel', '--no-autoupdate', '--url']);
    assert.match(launched.args[3], /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(tunnelPort, town.port);
    assert.deepEqual(launched.andaryEnv, [], "Andary's settings and secrets stay out of cloudflared's environment");
    const state = readStateFile(town.home);
    assert.deepEqual(state?.tunnel, { url: TUNNEL, pid: launched.pid });
    // The town itself stays on this computer: teammates come through the tunnel.
    assert.equal(state?.host, '127.0.0.1');
    const output = town.output();
    assert.match(output, /WARNING: --tunnel puts the team town on the internet/);
    assert.match(output, /team reset/);
    assert.match(output, new RegExp(`Teammates watch \\(view only\\) at ${TUNNEL}/\\?view=${viewToken(secret)}`));
    assert.match(output, /changes when Andary restarts/);
  });

  it("refuses the owner's sign-in and routes through the tunnel, even from 127.0.0.1", async () => {
    // The sign-in link, with the right token.
    const login = await viaTunnel(tunnelPort, { path: `/?token=${town.uiToken}` });
    assert.equal(login.status, 403);
    assert.match(login.text, /Sign in on your own computer/);
    assert.equal(login.headers.location, undefined);
    // Without Cloudflare's headers too: the tunnel's port alone makes a request remote.
    assert.equal((await rawRequest(tunnelPort, { path: `/?token=${town.uiToken}`, headers: { host: TUNNEL_HOST } })).status, 403);
    // The forwarder's and the limits mod's routes, with the right hook secret.
    const event = JSON.stringify({ v: 1, ts: Date.now(), caps: ['truncated'], event: hookPayload('Stop') });
    for (const path of ['/api/hook', '/api/limits']) {
      const answer = await viaTunnel(tunnelPort, { method: 'POST', path, headers: { 'x-andary-secret': town.secret, 'content-type': 'application/json', 'content-length': Buffer.byteLength(event) }, body: event });
      assert.equal(answer.status, 403, path);
    }
    assert.equal((await viaTunnel(tunnelPort, { path: '/api/proof', headers: { 'x-andary-nonce': 'n'.repeat(22) } })).status, 403);
    // hello: the owner's token does not count, and it tells nothing of the owner's settings.
    const hello = JSON.parse((await viaTunnel(tunnelPort, { path: '/api/hello', headers: { 'x-andary-token': town.uiToken } })).text);
    assert.equal(hello.authenticated, false);
    assert.equal(hello.settings.remoteApprovals, false);
    assert.equal(hello.settings.notify, false);
    // The owner's WebSocket sign-in.
    await assert.rejects(socketViaTunnel(tunnelPort, `andary, andary.token.${town.uiToken}`), /401/);
  });

  it("refuses requests with Cloudflare's headers on the town's own port, even from 127.0.0.1", async () => {
    // As if a tunnel had been pointed at the town's own port.
    assert.equal((await rawRequest(town.port, { path: `/?token=${town.uiToken}`, headers: { 'cf-connecting-ip': '203.0.113.9' } })).status, 403);
    assert.equal((await rawRequest(town.port, { path: `/?token=${town.uiToken}`, headers: FROM_CLOUDFLARE })).status, 403);
    await assert.rejects(socketViaTunnel(town.port, `andary, andary.token.${town.uiToken}`), /401/);
    await assert.rejects(
      connectWebSocket(`ws://127.0.0.1:${town.port}/ws`, { headers: { Origin: town.baseUrl, 'Sec-WebSocket-Protocol': `andary, andary.token.${town.uiToken}`, 'cdn-loop': 'cloudflare' } }),
      /403/,
    );
    // The same request without them is the owner, as always.
    assert.equal((await rawRequest(town.port, { path: `/?token=${town.uiToken}` })).status, 302);
  });

  it("keeps Host and Origin strict: only the tunnel's own name", async () => {
    for (const host of [`127.0.0.1:${tunnelPort}`, `localhost:${tunnelPort}`, 'other-words.trycloudflare.com', 'evil.example']) {
      assert.equal((await rawRequest(tunnelPort, { path: '/', headers: { host } })).status, 403, host);
    }
    assert.equal((await viaTunnel(tunnelPort, { path: '/' })).status, 200);
    assert.equal((await viaTunnel(tunnelPort, { path: '/', headers: { host: `${TUNNEL_HOST}:443` } })).status, 200);
    await assert.rejects(socketViaTunnel(tunnelPort, `andary, andary.view.${viewToken(secret)}`, { Origin: 'https://evil.example' }), /403/);
    await assert.rejects(socketViaTunnel(tunnelPort, `andary, andary.view.${viewToken(secret)}`, { Origin: town.baseUrl }), /403/);
    // Even the team's route, which skips the Host check on the network, names the tunnel here.
    const batch = JSON.stringify({ v: 1, events: [{ ts: Date.now(), event: hookPayload('Stop') }] });
    const team = { method: 'POST', path: '/api/team', body: batch, headers: { 'x-andary-team': memberKey(secret, 'Omar'), 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(batch)) } };
    assert.equal((await rawRequest(tunnelPort, { ...team, headers: { ...team.headers, host: `127.0.0.1:${tunnelPort}` } })).status, 403);
    assert.equal((await viaTunnel(tunnelPort, team)).status, 200);
    assert.equal((await viaTunnel(tunnelPort, { ...team, headers: { ...team.headers, 'x-andary-team': 'Omar.wrong' } })).status, 401);
  });

  it('lets teammates watch with the view link and share with their key through the tunnel', async () => {
    const view = viewToken(secret);
    const login = await viaTunnel(tunnelPort, { path: `/?view=${view}` });
    assert.equal(login.status, 302);
    assert.equal(login.headers.location, `/#view=${view}`);
    assert.equal((await viaTunnel(tunnelPort, { path: '/?view=wrong' })).status, 403);
    const viewer = await socketViaTunnel(tunnelPort, `andary, andary.view.${view}`);
    const hello = await waitForMessage(viewer, (m) => m?.t === 'hello');
    assert.equal(hello.settings.team.role, 'viewer');
    assert.equal(hello.notifyUrl, null);
    // A teammate's Andary posts to https://<tunnel>/api/team; here the post is delivered the way
    // cloudflared would deliver it.
    /** @type {typeof fetch} */
    const throughTunnel = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, TUNNEL);
      assert.equal(init?.redirect, 'error');
      const body = String(init?.body);
      const headers = /** @type {Record<string, string>} */ (init?.headers);
      const answer = await viaTunnel(tunnelPort, { method: 'POST', path: url.pathname, body, headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } });
      return new Response(answer.text, { status: answer.status, headers: { 'content-type': 'application/json' } });
    };
    const relay = createTeamRelay({ url: TUNNEL, key: memberKey(secret, 'Lina'), fetchImpl: throughTunnel, flushMs: 10 });
    const relayed = waitForMessage(viewer, (m) => m?.t === 'hook' && m.e.event.andary_member === 'Lina', 10_000);
    relay.send({ ts: Date.now(), event: hookPayload('UserPromptSubmit', { prompt: 'From far away' }) });
    assert.equal((await relayed).e.event.prompt, 'From far away');
    relay.dispose();
    viewer.send(JSON.stringify({ t: 'settings', settings: { remoteApprovals: true } }));
    assert.match((await waitForMessage(viewer, (m) => m?.t === 'error')).message, /Viewers can only watch/);
    await closeBrowser(viewer);
  });

  it("prints invites with the tunnel's address, and the doctor reports it", async () => {
    const invite = await runCli(['team', 'invite', 'Lina'], { ANDARY_HOME: town.home });
    assert.equal(invite.code, 0, invite.output);
    assert.match(invite.output, new RegExp(`ANDARY_TEAM_KEY=Lina\\.[\\w-]{32} andary start --share-to ${TUNNEL}\\n`));
    assert.match(invite.output, new RegExp(`${TUNNEL}/\\?view=${viewToken(secret)}`));
    assert.match(invite.output, /on the internet \(a Cloudflare Quick Tunnel\)/);
    assert.doesNotMatch(invite.output, /plain HTTP/);
    const doctor = await runCli(['doctor'], { ANDARY_HOME: town.home, PATH: process.env.PATH ?? '' });
    assert.match(doctor.output, new RegExp(`Internet tunnel: on at ${TUNNEL} \\(cloudflared pid ${launched.pid}\\)`));
  });

  it('stops cloudflared with the server', async () => {
    assert.ok(isProcessAlive(launched.pid));
    await town.stop();
    for (let waited = 0; waited < 3000 && isProcessAlive(launched.pid); waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(!isProcessAlive(launched.pid), 'cloudflared is gone');
  });
});

describe('--tunnel refusals', { skip: process.platform === 'win32' ? 'the fake cloudflared is a script with a shebang' : false }, () => {
  it('says how to install cloudflared when it is not on the PATH, and starts nothing', async () => {
    const empty = join(scratch, 'empty-bin');
    mkdirSync(empty, { recursive: true });
    const result = await runCli(['start', '--team', '--tunnel', '--no-open', '--port', '0'], { ...tunnelEnv('missing'), PATH: empty });
    assert.equal(result.code, 1);
    assert.match(result.output, /needs Cloudflare's free cloudflared program on your PATH \(Andary does not install it\)/);
    assert.match(result.output, process.platform === 'darwin' ? /brew install cloudflared/ : /pkg\.cloudflare\.com/);
    assert.doesNotMatch(result.output, /is running on/);
  });

  it('gives up when cloudflared prints no address in time, and stops the town', async () => {
    const env = tunnelEnv('silent', { FAKE_SILENT: '1', ANDARY_TUNNEL_TIMEOUT_MS: '700' });
    const result = await runCli(['start', '--team', '--tunnel', '--no-open', '--port', '0'], env);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /The tunnel did not open: cloudflared printed no trycloudflare\.com address within 1 s/);
    assert.match(result.output, /Requesting new quick Tunnel/);
    const { pid } = JSON.parse(readFileSync(env.FAKE_LOG, 'utf8'));
    for (let waited = 0; waited < 3000 && isProcessAlive(pid); waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(!isProcessAlive(pid), 'cloudflared was stopped');
    assert.ok(!existsSync(join(result.home, 'server.json')), 'the town stopped too');
  });

  it('refuses while ~/.cloudflared/config.yml exists, which stops Quick Tunnels', async () => {
    const env = tunnelEnv('config');
    mkdirSync(join(env.HOME, '.cloudflared'), { recursive: true });
    writeFileSync(join(env.HOME, '.cloudflared', 'config.yml'), 'tunnel: mine\n');
    const result = await runCli(['start', '--team', '--tunnel', '--no-open', '--port', '0'], env);
    assert.equal(result.code, 1);
    assert.match(result.output, /Quick Tunnels do not start while ~?.*config\.yml exists/);
  });

  it('needs --team, and an email list only with --tunnel and a cloudflared that supports it', async () => {
    assert.equal((await runCli(['start', '--tunnel', '--no-open'], tunnelEnv('no-team'))).code, 2);
    assert.equal((await runCli(['start', '--team', '--tunnel-allowed-mail', 'a@x.example', '--no-open'], tunnelEnv('no-tunnel'))).code, 2);
    assert.equal((await runCli(['start', '--team', '--tunnel', '--tunnel-allowed-mail', 'not-an-address', '--no-open'], tunnelEnv('bad-mail'))).code, 2);
    const old = await runCli(['start', '--team', '--tunnel', '--tunnel-allowed-mail', 'a@x.example', '--no-open', '--port', '0'], tunnelEnv('old', { FAKE_NO_MAIL: '1' }));
    assert.equal(old.code, 1);
    assert.match(old.output, /needs cloudflared 2026\.9\.3 or newer/);
  });

  it('passes the email list on to cloudflared', async () => {
    const env = tunnelEnv('mail');
    const town = await startTown({ args: ['--team', '--tunnel', '--tunnel-allowed-mail', 'you@x.example,lina@y.example'], env });
    try {
      const { args } = JSON.parse(readFileSync(env.FAKE_LOG, 'utf8'));
      assert.deepEqual(args.slice(4), ['--allowed-mail', 'you@x.example', '--allowed-mail', 'lina@y.example']);
      assert.match(town.output(), /Only you@x\.example, lina@y\.example can open it/);
      assert.match(town.output(), /teammates can watch, not share/);
    } finally {
      await town.stop();
    }
  });
});
