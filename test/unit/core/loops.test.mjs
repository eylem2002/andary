// The stuck rules (core/loops.js): what counts as the same step and as a change, when each rule
// starts and what ends it, the steps that wait by nature, changes by other agents, and how much is
// remembered.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_AGENTS, MAX_KEY_CHARS, MAX_STEPS, changesFiles, coreCommand, createLoops, isPolling, stepKey } from '../../../public/js/core/loops.js';

/** @typedef {import('../../../public/js/core/loops.js').LoopCall} LoopCall */
/** @typedef {import('../../../public/js/core/loops.js').LoopChange} LoopChange */

const T0 = 1_000_000;
const MINUTE = 60_000;
const APP = '/work/app';
const LEAD = 's1:main';
const HELPER = 's1:h1';

/** A finished call by the lead in /work/app: a passing `npm test` unless told otherwise. @param {Partial<LoopCall>} [fields] @returns {LoopCall} */
const ran = (fields = {}) => ({ agent: LEAD, folder: APP, tool: 'Bash', input: { command: 'npm test' }, ok: true, error: '', at: T0, ...fields });
/** @param {Partial<LoopCall>} [fields] */
const failed = (fields = {}) => ran({ ok: false, error: 'Exit code 1', ...fields });
/** A successful edit of src/a.ts. @param {Partial<LoopCall>} [fields] */
const edited = (fields = {}) => ran({ tool: 'Edit', input: { file_path: `${APP}/src/a.ts`, old_string: 'a', new_string: 'b' }, ...fields });

/** The rules, with what they last said about each agent. */
function rules() {
  const loops = createLoops();
  /** @type {Map<string, import('../../../public/js/core/loops.js').Stuck|null>} */
  const stuck = new Map();
  /** @type {LoopChange[]} */
  const said = [];
  /** @param {LoopChange[]} changes */
  const keep = (changes) => {
    for (const change of changes) stuck.set(change.agent, change.stuck);
    said.push(...changes);
    return changes;
  };
  return {
    /** @param {...LoopCall} calls */
    run(...calls) {
      for (const call of calls) keep(loops.record(call));
    },
    reset: (agent = LEAD) => keep(loops.reset(agent)),
    /** @param {(agent: string) => boolean} belongs */
    resetAll: (belongs) => keep(loops.resetAll(belongs)),
    stuck: (agent = LEAD) => stuck.get(agent) ?? null,
    /** How many episodes started, for an agent. */
    started: (agent = LEAD) => said.filter((change) => change.agent === agent && change.started).length,
  };
}

/** @template T @param {number} n @param {(i: number) => T} make @returns {T[]} */
const times = (n, make) => Array.from({ length: n }, (_, i) => make(i));

describe('the same step', () => {
  test('a shell command, without a leading cd and without the output plumbing at its end', () => {
    assert.equal(coreCommand('cd /work/app &&  npm   test 2>&1 | tail -40'), 'npm test');
    assert.equal(coreCommand('npm test 2>&1 | grep -v warn | head -50'), 'npm test');
    assert.equal(coreCommand('cd "/my app" && npm test\n'), 'npm test');
    const npmTest = stepKey('Bash', { command: 'npm test' });
    for (const same of ['npm test 2>&1', 'npm test | tail -20', 'cd app && npm test | grep FAIL', ' npm  test ']) {
      assert.equal(stepKey('Bash', { command: same, description: 'Run the tests' }), npmTest, same);
    }
    for (const other of ['npm test || true', 'npm run test', 'npm test -- login', 'cd app; npm test']) {
      assert.notEqual(stepKey('Bash', { command: other }), npmTest, other);
    }
    assert.equal(stepKey('Bash', { command: ['npm', 'test'] }), npmTest, 'a Codex argument list');
    assert.notEqual(stepKey('PowerShell', { command: 'npm test' }), npmTest);
  });

  test('file tools by tool and path; Read adds offset and limit', () => {
    const file = '/work/app/src/a.ts';
    assert.equal(stepKey('Edit', { file_path: file, old_string: 'x', new_string: 'y' }), stepKey('Edit', { file_path: file, old_string: 'p', new_string: 'q' }));
    assert.notEqual(stepKey('Edit', { file_path: file }), stepKey('Write', { file_path: file }));
    assert.notEqual(stepKey('Edit', { file_path: file }), stepKey('Edit', { file_path: '/work/app/src/b.ts' }));
    assert.equal(stepKey('Read', { file_path: file, offset: 100, limit: 50 }), stepKey('Read', { limit: 50, offset: 100, file_path: file }));
    assert.notEqual(stepKey('Read', { file_path: file, offset: 100, limit: 50 }), stepKey('Read', { file_path: file, offset: 150, limit: 50 }));
    assert.notEqual(stepKey('Read', { file_path: file }), stepKey('Read', { file_path: file, limit: 50 }));
  });

  test('searches by tool, pattern and path', () => {
    const grep = stepKey('Grep', { pattern: 'TODO', path: 'src', output_mode: 'content' });
    assert.equal(stepKey('Grep', { pattern: 'TODO', path: 'src', output_mode: 'count' }), grep);
    assert.notEqual(stepKey('Grep', { pattern: 'TODO', path: 'test' }), grep);
    assert.notEqual(stepKey('Grep', { pattern: 'FIXME', path: 'src' }), grep);
    assert.notEqual(stepKey('Glob', { pattern: 'TODO', path: 'src' }), grep);
  });

  test('anything else by its whole input, keys in any order, cut at a fixed length', () => {
    const issue = stepKey('mcp__github__get_issue', { owner: 'o', repo: 'r', issue: { number: 7, labels: ['bug'] } });
    assert.equal(stepKey('mcp__github__get_issue', { issue: { labels: ['bug'], number: 7 }, repo: 'r', owner: 'o' }), issue);
    assert.notEqual(stepKey('mcp__github__get_issue', { owner: 'o', repo: 'r', issue: { number: 8, labels: ['bug'] } }), issue);
    const huge = stepKey('mcp__files__write', { content: 'x'.repeat(100_000) });
    assert.ok(huge.length <= MAX_KEY_CHARS, `${huge.length} characters`);
    assert.ok(stepKey('Bash', { command: `echo ${'y'.repeat(5000)}` }).length <= MAX_KEY_CHARS);
  });
});

describe('what counts as a change', () => {
  test('shell commands that change files, judged by the command', () => {
    const changes = [
      "sed -i 's/old/new/' src/a.ts",
      "sed -i.bak -e 's/a/b/' x",
      'sed --in-place s/a/b/ x',
      "perl -pi -e 's/a/b/' x",
      'npx prettier --write .',
      'npx eslint --fix src',
      'npm run lint -- --fix',
      'ruff format .',
      'cargo fmt',
      'git checkout -- src/a.ts',
      'git -C app restore src',
      'git stash',
      'git stash pop',
      'git reset --hard HEAD~1',
      'git apply fix.patch',
      'git pull --rebase',
      'git commit -m "Fix login"',
      'patch -p1 < fix.diff',
      'npm install left-pad',
      'pip install requests',
      'rm -rf node_modules/.cache',
      'mkdir -p src/lib && mv a.ts src/lib/',
      'cp .env.example .env',
    ];
    for (const command of changes) assert.equal(changesFiles(command), true, command);
    const nothing = [
      'npm test',
      "sed -n '1,20p' src/a.ts",
      'perl -e "print 1"',
      'npx eslint --fix-dry-run src',
      'git status',
      'git diff',
      'git log --oneline',
      'git stash list',
      'git add -A',
      'npm test > test.log 2>&1',
      'docker run --rm node:22 npm test',
      'grep -rn "rm -rf" src',
    ];
    for (const command of nothing) assert.equal(changesFiles(command), false, command);
    assert.equal(changesFiles(['git', 'checkout', 'main']), true, 'a Codex argument list');
  });

  test('a failed edit is no change: its own failures count instead', () => {
    const t = rules();
    t.run(failed(), failed());
    t.run(failed({ tool: 'Edit', input: { file_path: `${APP}/src/a.ts` }, error: 'String to replace not found in file.' }));
    t.run(failed());
    assert.equal(t.stuck()?.rule, 1, 'npm test failed three times; the edit never happened');
  });
});

describe('rule 1: the same step failed 3 times with nothing changed', () => {
  test('starts at the third failure, then counts on in the same episode', () => {
    const t = rules();
    t.run(failed({ at: T0 }), failed({ at: T0 + 1000 }));
    assert.equal(t.stuck(), null);
    t.run(failed({ at: T0 + 2000 }));
    assert.deepEqual(t.stuck(), { rule: 1, step: 'npm test', since: T0 + 2000, count: 3, text: 'Seems stuck: `npm test` failed 3 times, nothing changed' });
    t.run(failed({ at: T0 + 3000 }));
    assert.deepEqual([t.stuck()?.count, t.stuck()?.since, t.started()], [4, T0 + 2000, 1], 'one episode, counted on');
  });

  test('other steps in between change nothing: only a change does', () => {
    const t = rules();
    t.run(failed(), ran({ tool: 'Read', input: { file_path: `${APP}/src/a.ts` } }), failed(), ran({ input: { command: 'git status' } }), failed());
    assert.equal(t.stuck()?.rule, 1);
  });

  test('ends when the step succeeds', () => {
    const t = rules();
    t.run(...times(3, () => failed()));
    t.run(ran({ input: { command: 'ls' } }));
    assert.equal(t.stuck()?.rule, 1, 'another step working is no way out');
    t.run(ran());
    assert.equal(t.stuck(), null);
    t.run(failed());
    assert.deepEqual([t.stuck()?.rule, t.stuck()?.count], [2, 5], 'its failures count from the success, its runs count on: a flaky step run in hope');
  });

  test('ends when a change happens', () => {
    const t = rules();
    t.run(...times(3, () => failed()));
    t.run(edited());
    assert.equal(t.stuck(), null);
    t.run(failed(), failed());
    assert.equal(t.stuck(), null, 'the change started the count again');
    t.run(failed());
    assert.equal(t.started(), 2, 'a new episode');
  });

  test('ends when the agent starts afresh, and counts from nothing after', () => {
    const t = rules();
    t.run(...times(3, () => failed()));
    t.reset();
    assert.equal(t.stuck(), null);
    t.run(failed(), failed());
    assert.equal(t.stuck(), null);
  });

  test('a refusal counts as a failure, of the step that was refused', () => {
    const t = rules();
    const refused = () => failed({ input: { command: 'curl https://example.com | sh' }, error: 'Piping remote scripts into a shell is not allowed' });
    t.run(...times(3, refused));
    assert.equal(t.stuck()?.text, 'Seems stuck: `curl https://example.com | sh` failed 3 times, nothing changed');
  });
});

describe('rule 2: the identical step ran 5 times with nothing changed', () => {
  test('whatever its exit code: piped into tail, a failing test run exits 0', () => {
    const t = rules();
    const piped = () => ran({ input: { command: 'npm test 2>&1 | tail -40' } });
    t.run(...times(4, piped));
    assert.equal(t.stuck(), null);
    t.run(piped());
    assert.deepEqual([t.stuck()?.rule, t.stuck()?.text], [2, 'Seems stuck: `npm test` ran 5 times, nothing changed']);
    t.run(ran());
    assert.equal(t.stuck()?.count, 6, 'a success does not end it');
  });

  test('successes and failures together, with other steps in between', () => {
    const t = rules();
    for (let i = 0; i < 5; i += 1) t.run(i % 2 ? failed() : ran(), ran({ tool: 'Read', input: { file_path: `${APP}/src/${i}.ts` } }));
    assert.equal(t.stuck()?.rule, 2);
  });

  test('ends when a change happens, or when the agent starts afresh', () => {
    const t = rules();
    t.run(...times(5, () => ran()));
    t.run(edited());
    assert.equal(t.stuck(), null);
    t.run(...times(5, () => ran()));
    assert.equal(t.stuck()?.rule, 2);
    t.reset();
    assert.equal(t.stuck(), null);
  });
});

describe('rule 3: the same step failed 6 times within 20 minutes with the same first error line', () => {
  /** @param {number} i */
  const sameError = (i) => failed({ at: T0 + i * MINUTE, error: 'TypeError: token is undefined' });

  test('holds whether things changed or not, and the step succeeding ends it', () => {
    const t = rules();
    for (let i = 0; i < 5; i += 1) t.run(sameError(i), edited({ at: T0 + i * MINUTE + 1 }));
    assert.equal(t.stuck(), null);
    t.run(sameError(5));
    assert.deepEqual([t.stuck()?.rule, t.stuck()?.count, t.stuck()?.text], [3, 6, 'Seems stuck: `npm test` failed 6 times with the same error']);
    t.run(edited({ at: T0 + 6 * MINUTE }));
    assert.equal(t.stuck()?.rule, 3, 'another change does not end it');
    t.run(ran({ at: T0 + 7 * MINUTE }));
    assert.equal(t.stuck(), null);
  });

  test('not over more than 20 minutes, and not with different errors', () => {
    const slow = rules();
    for (let i = 0; i < 6; i += 1) slow.run(failed({ at: T0 + i * 5 * MINUTE, error: 'TypeError: token is undefined' }), edited({ at: T0 + i * 5 * MINUTE + 1 }));
    assert.equal(slow.stuck(), null, 'six failures over 25 minutes');
    const varied = rules();
    for (let i = 0; i < 6; i += 1) varied.run(failed({ at: T0 + i * MINUTE, error: `Error: case ${i % 2}` }), edited({ at: T0 + i * MINUTE + 1 }));
    assert.equal(varied.stuck(), null, 'three of one error, three of another');
  });

  test('when nothing changed either, the words say so (rule 1 comes first)', () => {
    const t = rules();
    t.run(...times(6, (i) => sameError(i)));
    assert.deepEqual([t.stuck()?.rule, t.stuck()?.count], [1, 6]);
    t.run(edited({ at: T0 + 6 * MINUTE }));
    assert.deepEqual([t.stuck()?.rule, t.stuck()?.text, t.started()], [3, 'Seems stuck: `npm test` failed 6 times with the same error', 1], 'the same episode, in other words');
  });
});

describe('steps that wait by nature are never counted', () => {
  test('reading a background task again, sleep loops, watches and CI status', () => {
    /** @type {[string, Record<string, any>][]} */
    const waits = [
      ['BashOutput', { bash_id: 'b1' }],
      ['TaskOutput', { task_id: 'b1' }],
      ['Monitor', { command: 'tail -f server.log' }],
      ['ScheduleWakeup', { delaySeconds: 60 }],
      ['WaitForMcpServers', { servers: ['github'] }],
      ['TaskList', {}],
      ['TaskGet', { taskId: '3' }],
      ['Read', { file_path: '/tmp/claude-1000/-work-app/5b0c9f2e/tasks/b39hdiusi.output' }],
      ['Read', { file_path: 'C:\\Users\\dev\\AppData\\Local\\Temp\\claude\\tasks\\b39hdiusi.output' }],
      ['Bash', { command: 'tail -n 50 /tmp/claude-1000/-work-app/5b0c9f2e/tasks/b39hdiusi.output' }],
      ['Bash', { command: 'sleep 30 && gh pr checks 42' }],
      ['Bash', { command: 'cd /work/app && sleep 5; curl -sf localhost:3000/health' }],
      ['Bash', { command: 'until curl -sf localhost:3000; do sleep 1; done' }],
      ['Bash', { command: 'gh run watch 1234 --exit-status' }],
      ['Bash', { command: 'gh run view 1234 --log-failed | tail -50' }],
      ['Bash', { command: 'gh pr checks 42' }],
      ['Bash', { command: 'gh api repos/o/r/commits/abc/check-runs' }],
      ['Bash', { command: 'watch -n 5 kubectl get pods' }],
      ['Bash', { command: 'kubectl rollout status deploy/api' }],
      ['PowerShell', { command: 'Start-Sleep -Seconds 30; Get-Job' }],
    ];
    for (const [tool, input] of waits) {
      assert.equal(isPolling(tool, input), true, `${tool} ${JSON.stringify(input)}`);
      const t = rules();
      for (let i = 0; i < 10; i += 1) t.run(ran({ tool, input, at: T0 + i }), failed({ tool, input, at: T0 + i, error: 'Exit code 8' }));
      assert.equal(t.stuck(), null, `${tool} ${JSON.stringify(input)}`);
    }
  });

  test('ordinary steps are not waits, and a wait that changes files is still a change', () => {
    for (const command of ['npm test', 'npm run watch', 'npx tsc --watch', 'cat src/a.ts', 'gh pr create --fill']) assert.equal(isPolling('Bash', { command }), false, command);
    assert.equal(isPolling('Read', { file_path: `${APP}/src/tasks/list.output.ts` }), false);
    const t = rules();
    t.run(...times(3, () => failed()));
    t.run(ran({ input: { command: 'sleep 10 && git pull' } }));
    assert.equal(t.stuck(), null);
  });
});

describe('a change by any agent in the same folder', () => {
  test("a helper's edit ends the lead's alert; the lead's own folder may be written any way", () => {
    const t = rules();
    t.run(...times(3, () => failed({ folder: 'C:\\work\\app\\' })));
    t.run(edited({ agent: HELPER, folder: 'C:/work/app', input: { file_path: 'C:\\work\\app\\src\\a.ts' } }));
    assert.equal(t.stuck(), null);
  });

  test('another crew in the same folder counts too; an agent in another folder does not', () => {
    const t = rules();
    t.run(...times(5, () => ran()));
    t.run(edited({ agent: 's2:main', folder: '/work/other', input: { file_path: '/work/other/a.ts' } }));
    t.run(ran({ agent: 's2:main', folder: '/work/other', input: { command: 'git checkout main' } }));
    assert.equal(t.stuck()?.rule, 2, 'nothing changed here');
    t.run(ran({ agent: 's3:main', folder: APP, input: { command: 'git checkout main' } }));
    assert.equal(t.stuck(), null, "another crew's checkout changed this folder");
  });

  test('an edit of a file inside the folder counts, wherever it was made from', () => {
    const t = rules();
    t.run(...times(3, () => failed({ folder: `${APP}/packages/api` })));
    t.run(edited({ agent: HELPER, folder: APP, input: { file_path: `${APP}/packages/web/a.ts` } }));
    assert.equal(t.stuck()?.rule, 1, 'another package of the project');
    t.run(edited({ agent: HELPER, folder: APP, input: { file_path: 'packages/api/src/a.ts' } }));
    assert.equal(t.stuck(), null, 'a path relative to the folder the edit was made in');
  });

  test("one agent's change ends the alerts of all the agents in the folder at once", () => {
    const t = rules();
    t.run(...times(3, () => failed()), ...times(3, () => failed({ agent: HELPER })));
    assert.deepEqual([t.stuck(LEAD)?.rule, t.stuck(HELPER)?.rule], [1, 1]);
    t.run(edited({ agent: 's1:h2' }));
    assert.deepEqual([t.stuck(LEAD), t.stuck(HELPER)], [null, null]);
  });
});

describe('one alert per agent', () => {
  test('while any step stays stuck the episode goes on, showing the step run most recently', () => {
    const t = rules();
    t.run(...times(3, () => failed()));
    const lint = (/** @type {number} */ at) => failed({ input: { command: 'npm run lint' }, at });
    t.run(lint(T0 + 1), lint(T0 + 2), lint(T0 + 3));
    assert.deepEqual([t.stuck()?.step, t.stuck()?.since, t.started()], ['npm run lint', T0, 1]);
    t.run(ran({ input: { command: 'npm run lint' } }));
    assert.deepEqual([t.stuck()?.step, t.stuck()?.since], ['npm test', T0], 'npm test still fails');
    t.run(ran());
    assert.equal(t.stuck(), null);
  });

  test('a step is shown in a few words: the command, or the tool and its file', () => {
    const t = rules();
    t.run(...times(3, () => failed({ tool: 'Edit', input: { file_path: `${APP}/src/auth/login.ts` }, error: 'String to replace not found in file.' })));
    assert.equal(t.stuck()?.text, 'Seems stuck: `Edit src/auth/login.ts` failed 3 times, nothing changed');
    const long = rules();
    long.run(...times(3, () => failed({ input: { command: `npm test -- ${'--grep login '.repeat(10)}` } })));
    assert.ok((long.stuck()?.step.length ?? 0) <= 36, long.stuck()?.step);
  });
});

describe('memory', () => {
  test(`at most ${MAX_STEPS} steps an agent: the one run the longest ago is forgotten, and its alert ends`, () => {
    const t = rules();
    t.run(...times(3, () => failed()));
    t.run(...times(MAX_STEPS - 1, (i) => ran({ tool: 'Read', input: { file_path: `${APP}/src/${i}.ts` } })));
    assert.equal(t.stuck()?.rule, 1);
    t.run(ran({ tool: 'Read', input: { file_path: `${APP}/src/last.ts` } }));
    assert.equal(t.stuck(), null);
  });

  test(`at most ${MAX_AGENTS} agents: the one quiet the longest is forgotten, and its alert ends`, () => {
    const t = rules();
    t.run(...times(3, () => failed()));
    t.run(...times(MAX_AGENTS - 1, (i) => ran({ agent: `s${i + 2}:main` })));
    assert.equal(t.stuck()?.rule, 1);
    t.run(ran({ agent: 'late:main' }));
    assert.equal(t.stuck(), null);
    t.run(failed(), failed());
    assert.equal(t.stuck(), null, 'its failures went with it');
  });

  test('a session ending forgets its agents, and only those', () => {
    const t = rules();
    t.run(...times(3, () => failed()), ...times(3, () => failed({ agent: HELPER })), ...times(3, () => failed({ agent: 's2:main' })));
    t.resetAll((agent) => agent.startsWith('s1:'));
    assert.deepEqual([t.stuck(LEAD), t.stuck(HELPER), t.stuck('s2:main')?.rule], [null, null, 1]);
  });
});
