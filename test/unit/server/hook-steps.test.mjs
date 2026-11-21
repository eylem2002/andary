// How the server reads a hook for the dialog model (server/hook-steps.mjs): its own time and its
// call key.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_HOOK_AGE_MS, hookTime, withCallKey } from '../../../server/hook-steps.mjs';
import { inputKey } from '../../../public/js/core/dialogs.js';

describe('hookTime', () => {
  it("is the forwarder's stamp, kept between a minute ago and now", () => {
    const now = 1_000_000;
    assert.equal(hookTime(now - 1_234, now), now - 1_234);
    assert.equal(hookTime(now + 3_600_000, now), now, 'a stamp ahead of the clock counts as now');
    assert.equal(hookTime(now - MAX_HOOK_AGE_MS, now), now - MAX_HOOK_AGE_MS);
    assert.equal(hookTime(now - 3_600_000, now), now - MAX_HOOK_AGE_MS, 'an older one as a minute ago');
    assert.equal(hookTime(-Infinity, now), now, 'one that is no time as its arrival');
    for (const ts of [undefined, null, '5', NaN]) assert.equal(hookTime(ts, now), now, String(ts));
  });
});

describe('withCallKey', () => {
  it("leaves a command's description out of its key, and keeps any other tool's", () => {
    const shell = withCallKey({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls', description: 'List' } });
    assert.equal(shell.andary_key, inputKey({ command: 'ls' }, 'Bash'));
    const mcp = (/** @type {string} */ description) => withCallKey({ hook_event_name: 'PreToolUse', tool_name: 'mcp__gh__create_issue', tool_input: { title: 'Bug', description } }).andary_key;
    assert.notEqual(mcp('one'), mcp('two'));
  });
});
