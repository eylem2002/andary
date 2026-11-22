// What `andary doctor` says about plan limits (server/cli/doctor.mjs, CONTRACTS §4.14).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limitsCheck, tunnelCheck } from '../../../../server/cli/doctor.mjs';

const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const account = (/** @type {Record<string, unknown>} */ extra = {}) => ({ account: 'default', label: null, claudeVersion: '2.1.330', at: NOW - 4 * 60_000, limits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: NOW + 3_600_000, at: NOW - 4 * 60_000 }], ...extra });

test('doctor says when the mod last reported, and from which Claude Code', () => {
  const check = limitsCheck({ accounts: [account(), account({ account: 'dir-x', at: NOW - 3 * 3_600_000, claudeVersion: '2.1.300' })] }, true, NOW);
  assert.deepEqual(check, { status: 'ok', title: 'Plan limits: the andary-limits mod reported 4 min ago from Claude Code 2.1.330', detail: 'To remove it: /plugin uninstall andary-limits@andary' });
  const empty = limitsCheck({ accounts: [account({ limits: [] })] }, false, NOW);
  assert.match(empty.title, /reported 4 min ago from Claude Code 2\.1\.330 \(no plan limits in it: an API key, or before the first answer\)$/);
});

test('doctor warns when the mod is enabled but nothing came, and says how to add it otherwise', () => {
  const silent = limitsCheck({ accounts: [] }, true, NOW);
  assert.equal(silent.status, 'warn');
  assert.match(silent.detail, /v2\.1\.287 or newer/);
  assert.doesNotMatch(silent.detail, /ANDARY_HOME/);
  // The mod finds a town in another folder only through Claude Code's own ANDARY_HOME.
  assert.match(limitsCheck({ accounts: [] }, true, NOW, true).detail, /started with the same ANDARY_HOME/);
  const off = limitsCheck(undefined, false, NOW);
  assert.equal(off.status, 'ok');
  assert.equal(off.title, 'Plan limits: not set up (optional)');
  assert.match(off.detail, /\/plugin marketplace add eylem2002\/andary, then \/plugin install andary-limits@andary$/);
});

test("doctor reports a team town's internet tunnel: on, down, gone, or off", () => {
  const base = /** @type {any} */ ({ pid: 1, port: 4747, host: '127.0.0.1', secret: 's', uiToken: 't', team: true });
  const url = 'https://seasonal-deck.trycloudflare.com';
  const alive = () => true;
  assert.equal(tunnelCheck({ ...base, team: undefined }, { cloudflared: null, alive }), null, 'nothing for a town without a team');
  const off = tunnelCheck(base, { cloudflared: null, alive });
  assert.equal(off?.status, 'ok');
  assert.match(String(off?.detail), /--team --tunnel; it needs cloudflared on the PATH/);
  assert.match(String(tunnelCheck(base, { cloudflared: '/usr/local/bin/cloudflared', alive })?.detail), /cloudflared is installed \(\/usr\/local\/bin\/cloudflared\)/);
  const on = tunnelCheck({ ...base, tunnel: { url, pid: 99 } }, { cloudflared: null, alive });
  assert.equal(on?.status, 'ok');
  assert.equal(on?.title, `Internet tunnel: on at ${url} (cloudflared pid 99)`);
  assert.match(String(on?.detail), /team reset$/);
  const gone = tunnelCheck({ ...base, tunnel: { url, pid: 99 } }, { cloudflared: null, alive: () => false });
  assert.equal(gone?.status, 'fail');
  assert.match(String(gone?.title), /pid 99\) is gone/);
  const down = tunnelCheck({ ...base, tunnel: { url: null, error: 'cloudflared stopped (exit code 1)' } }, { cloudflared: null, alive });
  assert.equal(down?.status, 'fail');
  assert.equal(down?.title, 'Internet tunnel: down (cloudflared stopped (exit code 1))');
  assert.match(String(down?.detail), /new address/);
});
