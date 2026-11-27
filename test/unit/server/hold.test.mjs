import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MAX_HOLD_REASON_CHARS, holdFilePath, holdOutput, readHoldRisky, writeHoldRisky } from '../../../server/hold.mjs';

/** @param {string} command @param {Record<string, unknown>} [extra] */
const pre = (command, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: '/w/app', ...extra });

describe('holding risky commands', () => {
  it('asks before a risky shell command from Claude Code, with why', () => {
    const output = holdOutput(pre('rm -rf src'), { source: 'claude', root: '/w/app' });
    assert.deepEqual(output, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Andary holds risky commands for you: deletes recursively' } });
  });

  it('uses the top of the work tree found on disk', () => {
    assert.equal(holdOutput(pre('rm ../lib/a.js', { cwd: '/w/app/web' }), { source: 'claude', root: '/w/app' }), null);
    assert.match(holdOutput(pre('rm ../lib/a.js', { cwd: '/w/app/web' }), { source: 'claude', root: '/w/app/web' })?.hookSpecificOutput.permissionDecisionReason ?? '', /outside the project/);
  });

  it('holds nothing else: ordinary commands, other tools and hooks, Codex', () => {
    assert.equal(holdOutput(pre('npm test'), { source: 'claude', root: null }), null);
    assert.equal(holdOutput(pre('rm -rf x', { tool_name: 'Read' }), { source: 'claude', root: null }), null);
    assert.equal(holdOutput(pre('rm -rf x', { hook_event_name: 'PostToolUse' }), { source: 'claude', root: null }), null);
    assert.equal(holdOutput(pre('rm -rf x'), { source: 'codex', root: null }), null);
  });

  it('never holds a rebuildable folder, and holds a command too long to read', () => {
    assert.equal(holdOutput(pre('rm -rf node_modules dist'), { source: 'claude', root: '/w/app' }), null);
    const long = holdOutput(pre(`echo ${'x'.repeat(20_001)}`), { source: 'claude', root: null });
    assert.match(long?.hookSpecificOutput.permissionDecisionReason ?? '', /too long for Andary to read in full/);
    assert.match(holdOutput(pre('npm test', { truncated: true }), { source: 'claude', root: null })?.hookSpecificOutput.permissionDecisionReason ?? '', /too long/);
  });

  it('keeps its reason short', () => {
    const output = holdOutput(pre(`rm -rf ${Array.from({ length: 40 }, (_, i) => `~/${'d'.repeat(40)}${i}`).join(' ')}`), { source: 'claude', root: null });
    assert.ok((output?.hookSpecificOutput.permissionDecisionReason.length ?? 0) <= MAX_HOLD_REASON_CHARS);
  });

  it('keeps the switch in a private file that outlasts a restart', () => {
    const home = mkdtempSync(join(tmpdir(), 'tt-hold-'));
    try {
      const file = holdFilePath(home);
      assert.equal(readHoldRisky(file), false);
      assert.equal(writeHoldRisky(file, true), true);
      assert.equal(readHoldRisky(file), true);
      if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o077, 0);
      assert.equal(writeHoldRisky(file, false), true);
      assert.equal(readHoldRisky(file), false);
      assert.equal(writeHoldRisky(file, false), true, 'off twice is fine');
      assert.equal(readHoldRisky(null), false);
      assert.equal(writeHoldRisky(null, true), true, 'nothing to write without a home');
      assert.equal(writeHoldRisky(join(home, 'missing', 'hold-risky'), true), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
