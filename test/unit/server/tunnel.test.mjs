import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { after, describe, it } from 'node:test';
import { blockingConfig, findCloudflared, installHelp, parseAllowedMail, parseTunnelUrl, startQuickTunnel, supportsAllowedMail, tunnelArgs } from '../../../server/tunnel.mjs';

// What cloudflared 2026.11.1 printed (on stderr) when it got a Quick Tunnel, and when it could not.
const CREATED = `2026-11-22T19:11:16Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee, are subject to the Cloudflare Online Services Terms of Use (https://www.cloudflare.com/website-terms/), and Cloudflare reserves the right to investigate your use of Tunnels for violations of such terms. If you intend to use Tunnels in production you should use a pre-created named tunnel by following: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps
2026-11-22T19:11:16Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-11-22T19:11:17Z INF +--------------------------------------------------------------------------------------------+
2026-11-22T19:11:17Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-11-22T19:11:17Z INF |  https://seasonal-deck-organisms-sf.trycloudflare.com                                      |
2026-11-22T19:11:17Z INF +--------------------------------------------------------------------------------------------+
2026-11-22T19:11:17Z INF Cannot determine default configuration path. No file [config.yml config.yaml] in [~/.cloudflared ~/.cloudflare-warp ~/cloudflare-warp /etc/cloudflared /usr/local/etc/cloudflared]
2026-11-22T19:11:17Z INF Version 2026.11.1
2026-11-22T19:11:18Z INF Registered tunnel connection connIndex=0 connection=0b1e5c0e event=0 ip=198.41.200.13 location=ams01 protocol=quic
`;
const FAILED = `2026-11-22T19:11:16Z INF Requesting new quick Tunnel on trycloudflare.com...
failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com on 8.8.8.8:53: no such host
`;

const scratch = mkdtempSync(join(tmpdir(), 'tt-tunnel-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

describe('parseTunnelUrl', () => {
  it("finds the address in cloudflared's box", () => {
    assert.equal(parseTunnelUrl(CREATED), 'https://seasonal-deck-organisms-sf.trycloudflare.com');
    assert.equal(parseTunnelUrl('|  https://Seasonal-Deck.TryCloudflare.com  |'), 'https://seasonal-deck.trycloudflare.com');
  });

  it("never takes Cloudflare's own API address, a longer name or a path for it", () => {
    assert.equal(parseTunnelUrl(FAILED), null);
    assert.equal(parseTunnelUrl('see https://www.trycloudflare.com for more'), null);
    assert.equal(parseTunnelUrl('https://words.trycloudflare.com.evil.example'), null);
    assert.equal(parseTunnelUrl('https://words.trycloudflare.com/path'), null);
    assert.equal(parseTunnelUrl('http://words.trycloudflare.com'), null, 'https only');
    assert.equal(parseTunnelUrl('Requesting new quick Tunnel on trycloudflare.com...'), null);
    assert.equal(parseTunnelUrl(''), null);
  });
});

describe('findCloudflared', () => {
  it('finds an executable cloudflared on the PATH, first directory first', () => {
    const empty = join(scratch, 'empty');
    const notExec = join(scratch, 'not-exec');
    const bin = join(scratch, 'bin');
    for (const dir of [empty, notExec, bin]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(notExec, 'cloudflared'), '');
    chmodSync(join(notExec, 'cloudflared'), 0o644);
    writeFileSync(join(bin, 'cloudflared'), '#!/bin/sh\n');
    chmodSync(join(bin, 'cloudflared'), 0o755);
    mkdirSync(join(empty, 'cloudflared'), { recursive: true }); // a folder is no program
    const path = [empty, notExec, bin].join(':');
    assert.equal(findCloudflared({ PATH: path }, 'linux'), join(bin, 'cloudflared'));
    assert.equal(findCloudflared({ PATH: [empty, notExec].join(':') }, 'linux'), null);
    assert.equal(findCloudflared({}, 'linux'), null);
  });

  it('tries the PATHEXT extensions on Windows', () => {
    const dir = join(scratch, 'win');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cloudflared.exe'), '');
    assert.equal(findCloudflared({ Path: dir, PATHEXT: '.COM;.EXE' }, 'win32'), join(dir, 'cloudflared.exe'));
    assert.equal(findCloudflared({ Path: dir, PATHEXT: '.COM' }, 'win32'), null);
  });
});

describe('installHelp', () => {
  it('says how to install cloudflared on each system, and never installs it', () => {
    assert.match(installHelp('darwin').join('\n'), /brew install cloudflared/);
    assert.match(installHelp('win32').join('\n'), /winget install --id Cloudflare\.cloudflared/);
    const linux = installHelp('linux').join('\n');
    assert.match(linux, /https:\/\/pkg\.cloudflare\.com\//);
    assert.match(linux, /github\.com\/cloudflare\/cloudflared\/releases/);
    for (const platform of /** @type {const} */ (['darwin', 'win32', 'linux'])) assert.match(installHelp(platform).join('\n'), /Andary does not install it/);
  });
});

describe('blockingConfig', () => {
  it('names ~/.cloudflared/config.yml or config.yaml, which stop Quick Tunnels', () => {
    const home = join(scratch, 'home');
    mkdirSync(join(home, '.cloudflared'), { recursive: true });
    assert.equal(blockingConfig(home), null);
    writeFileSync(join(home, '.cloudflared', 'config.yaml'), 'tunnel: x\n');
    assert.equal(blockingConfig(home), join(home, '.cloudflared', 'config.yaml'));
  });
});

describe('parseAllowedMail and tunnelArgs', () => {
  it('takes addresses and *@domain, comma-separated or repeated', () => {
    assert.equal(parseAllowedMail(undefined), null);
    assert.deepEqual(parseAllowedMail(['you@example.com, lina@example.org', '*@team.example']), ['you@example.com', 'lina@example.org', '*@team.example']);
    for (const bad of [['not-an-address'], ['a@b'], ['a b@x.example'], ['*.example.com'], [',']]) {
      assert.throws(() => parseAllowedMail(bad), /--tunnel-allowed-mail/, JSON.stringify(bad));
    }
  });

  it('points cloudflared at the loopback port, without updating itself', () => {
    assert.deepEqual(tunnelArgs(5123), ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:5123']);
    assert.deepEqual(tunnelArgs(5123, ['a@x.example', '*@y.example']).slice(4), ['--allowed-mail', 'a@x.example', '--allowed-mail', '*@y.example']);
  });

  it("checks the installed cloudflared's help for --allowed-mail", () => {
    const run = (/** @type {string} */ help) => /** @type {any} */ (() => ({ stdout: help, stderr: '' }));
    assert.equal(supportsAllowedMail('cloudflared', { run: run('   --allowed-mail value   Email addresses…') }), true);
    assert.equal(supportsAllowedMail('cloudflared', { run: run('   --url value') }), false);
  });
});

/** A child process that prints what a test tells it to. */
function fakeChild() {
  const child = /** @type {any} */ (new EventEmitter());
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  child.signals = [];
  child.kill = (/** @type {string} */ signal) => {
    child.signals.push(signal);
    setImmediate(() => child.emit('exit', null, signal));
    return true;
  };
  return child;
}

describe('startQuickTunnel', () => {
  it('resolves with the address, read across chunks, and keeps cloudflared running until stopped', async () => {
    const child = fakeChild();
    /** @type {any[]} */
    const calls = [];
    const spawnImpl = /** @type {any} */ ((/** @type {any[]} */ ...args) => {
      calls.push(args);
      return child;
    });
    const started = startQuickTunnel({ bin: '/usr/bin/cloudflared', port: 5123, env: { PATH: '/usr/bin', ANDARY_TEAM_KEY: 'Lina.secret', HOME: '/home/me' }, spawnImpl });
    const half = CREATED.indexOf('seasonal-deck');
    child.stderr.write(CREATED.slice(0, half));
    child.stderr.write(CREATED.slice(half));
    const tunnel = await started;
    assert.equal(tunnel.url, 'https://seasonal-deck-organisms-sf.trycloudflare.com');
    assert.equal(tunnel.pid, 4242);
    assert.equal(calls[0][0], '/usr/bin/cloudflared');
    assert.deepEqual(calls[0][1], tunnelArgs(5123));
    assert.equal(calls[0][2].env.ANDARY_TEAM_KEY, undefined, "Andary's secrets stay out of cloudflared's environment");
    assert.equal(calls[0][2].env.HOME, '/home/me');
    assert.deepEqual(child.signals, []);
    await tunnel.stop();
    assert.deepEqual(child.signals, ['SIGTERM']);
  });

  it('tells when cloudflared ends after the address was printed', async () => {
    const child = fakeChild();
    const started = startQuickTunnel({ bin: 'cloudflared', port: 1, spawnImpl: /** @type {any} */ (() => child) });
    child.stdout.write('|  https://a-b-c-d.trycloudflare.com  |\n');
    const tunnel = await started;
    const ended = new Promise((resolve) => tunnel.onExit((code) => resolve(code)));
    child.emit('exit', 1, null);
    assert.equal(await ended, 1);
  });

  it("fails with cloudflared's last lines when it ends without an address", async () => {
    const child = fakeChild();
    const started = startQuickTunnel({ bin: 'cloudflared', port: 1, spawnImpl: /** @type {any} */ (() => child) });
    child.stderr.write(FAILED);
    setImmediate(() => child.emit('exit', 1, null));
    await assert.rejects(started, (/** @type {any} */ error) => {
      assert.match(error.message, /stopped before it printed an address \(exit code 1\)/);
      assert.match(error.message, /no such host/);
      return true;
    });
  });

  it('gives up after the timeout, with a clear message, and stops cloudflared', async () => {
    const child = fakeChild();
    const started = startQuickTunnel({ bin: 'cloudflared', port: 1, timeoutMs: 50, spawnImpl: /** @type {any} */ (() => child) });
    child.stderr.write('2026-11-22T19:11:16Z INF Requesting new quick Tunnel on trycloudflare.com...\n');
    await assert.rejects(started, /printed no trycloudflare\.com address within 1 s[\s\S]*Requesting new quick Tunnel/);
    assert.deepEqual(child.signals, ['SIGTERM']);
  });

  it('fails clearly when the program cannot run', async () => {
    const child = fakeChild();
    const started = startQuickTunnel({ bin: '/missing/cloudflared', port: 1, spawnImpl: /** @type {any} */ (() => child) });
    child.emit('error', Object.assign(new Error('spawn /missing/cloudflared ENOENT'), { code: 'ENOENT' }));
    await assert.rejects(started, /Could not run cloudflared \(ENOENT\)/);
  });
});
