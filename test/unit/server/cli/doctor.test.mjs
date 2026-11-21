// What `andary doctor` says about plan limits (server/cli/doctor.mjs, CONTRACTS §4.14).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limitsCheck } from '../../../../server/cli/doctor.mjs';

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
  const off = limitsCheck(undefined, false, NOW);
  assert.equal(off.status, 'ok');
  assert.equal(off.title, 'Plan limits: not set up (optional)');
  assert.match(off.detail, /\/plugin marketplace add eylem2002\/andary, then \/plugin install andary-limits@andary$/);
});
