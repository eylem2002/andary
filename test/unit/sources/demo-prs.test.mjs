import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoPrs } from '../../../public/js/sources/demo-prs.js';
import { readPrStatus } from '../../../public/js/core/pr-status.js';
import { createFakeClock } from '../core/helpers.mjs';

describe('createDemoPrs', () => {
  it("a story's push gets a made-up pull request whose checks run, then fail or pass in turn", async () => {
    const clock = createFakeClock(0);
    /** @type {any[]} */
    const set = [];
    let speed = 2;
    const prs = createDemoPrs({ setPr: (pr) => set.push(pr) }, clock.now, { speed: () => speed, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout });
    const push = (/** @type {string} */ cwd, /** @type {string} */ session) => prs.observe({ hook_event_name: 'PostToolUse', session_id: session, cwd, tool_name: 'Bash', tool_input: { command: 'git push origin fix/flaky-login-test' } });
    push('/demo/api', 's1');
    prs.observe({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/demo/api', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    assert.equal(set.length, 1);
    assert.deepEqual([set[0].checks.state, set[0].branch, set[0].url], ['pending', 'fix/flaky-login-test', null]);
    await clock.advance(10_000);
    assert.equal(set[1].checks.state, 'failing', 'at 2×, the checks take half as long');
    speed = 1;
    push('/demo/web', 's2');
    await clock.advance(20_000);
    assert.equal(set.at(-1).checks.state, 'passing');
    // What the demo sends reads like what the server sends.
    for (const pr of set) assert.deepEqual(readPrStatus(pr), pr);
    push('/demo/api', 's1');
    prs.stop();
    await clock.advance(60_000);
    assert.equal(set.at(-1).checks.state, 'pending', 'stopped: no more changes');
  });
});
