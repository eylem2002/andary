// The demo's made-up branch lines (sources/demo-git.js): a crew's edits since its last commit are
// its changed files, a commit puts it one ahead of its upstream, a push sends them all.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDemoGit } from '../../../public/js/sources/demo-git.js';
import { demoBranch } from '../../../public/js/sim/simulation.js';

describe('demo branch lines', () => {
  test('edits, a commit and a push, for a crew whose branch the story names', () => {
    /** @type {any[]} */
    const sent = [];
    const observe = createDemoGit({ setGit: (status) => sent.push(status) }, () => 5, demoBranch);
    const cwd = '/home/dev/code/api-server';
    const post = (/** @type {string} */ tool, /** @type {Record<string, any>} */ input) => observe({ hook_event_name: 'PostToolUse', cwd, tool_name: tool, tool_input: input });
    observe({ hook_event_name: 'SessionStart', cwd });
    post('Edit', { file_path: `${cwd}/a.ts` });
    post('Edit', { file_path: `${cwd}/a.ts` });
    post('Write', { file_path: `${cwd}/b.ts` });
    post('Bash', { command: 'git add -A && git commit -m "x"' });
    post('Bash', { command: 'git push origin fix/flaky-login-test' });
    assert.deepEqual(sent.map((s) => [s.branch, s.changed, s.ahead]), [['fix/flaky-login-test', 0, 0], ['fix/flaky-login-test', 1, 0], ['fix/flaky-login-test', 2, 0], ['fix/flaky-login-test', 0, 1], ['fix/flaky-login-test', 0, 0]]);
    observe({ hook_event_name: 'SessionStart', cwd: '/somewhere/else' });
    assert.equal(sent.length, 5, 'a folder the story has no branch for shows none');
  });
});
