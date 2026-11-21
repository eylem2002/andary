// The stuck rules (core/loops.js): what counts as the same step and as a change, when each rule
// starts and what ends it, the steps that wait by nature, changes by other agents, and how much is
// remembered.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_AGENTS, MAX_KEY_CHARS, MAX_STEPS, changesFiles, coreCommand, createLoops, errorSignature, isPolling, stepKey, stuckWords } from '../../../public/js/core/loops.js';

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
  test('a shell command, without a cd into its own folder and without the output plumbing at its end', () => {
    assert.equal(coreCommand('cd /work/app &&  npm   test 2>&1 | tail -40', APP), 'npm test');
    assert.equal(coreCommand('npm test 2>&1 | grep -v warn | head -50'), 'npm test');
    assert.equal(coreCommand('cd "/my app" && npm test\n', '/my app'), 'npm test');
    assert.equal(coreCommand('cd . && sleep 2 && npm test'), 'npm test', 'a pause before it is no part of it');
    const npmTest = stepKey('Bash', { command: 'npm test' }, APP);
    for (const same of ['npm test 2>&1', 'npm test | tail -20', `cd ${APP} && npm test | grep FAIL`, 'cd . && npm test', 'cd ../app && npm test', ' npm  test ', 'sleep 5 && npm test']) {
      assert.equal(stepKey('Bash', { command: same, description: 'Run the tests' }, APP), npmTest, same);
    }
    for (const other of ['npm test || true', 'npm run test', 'npm test -- login', 'cd app && npm test', 'cd packages/a && npm test']) {
      assert.notEqual(stepKey('Bash', { command: other }, APP), npmTest, other);
    }
    assert.equal(stepKey('Bash', { command: ['npm', 'test'] }, APP), npmTest, 'a Codex argument list');
    assert.notEqual(stepKey('PowerShell', { command: 'npm test' }, APP), npmTest);
  });

  test('a command handed to a shell is the command inside it (Codex runs every command so)', () => {
    const npmTest = stepKey('Bash', { command: 'npm test' }, APP);
    for (const wrapped of [['bash', '-lc', 'npm test'], "bash -lc 'npm test 2>&1 | tail -30'", '/bin/zsh -lc "npm test"', "sh -c 'cd /work/app && npm test'"]) {
      assert.equal(stepKey('Bash', { command: wrapped }, APP), npmTest, JSON.stringify(wrapped));
    }
    assert.equal(coreCommand(['bash', '-lc', "echo 'it''s' && cd packages/a && npm test"], APP), "echo 'it''s' && cd packages/a && npm test");
    const inner = String.raw`cd packages/a && echo 'it'\''s'`;
    assert.equal(coreCommand(['bash', '-lc', inner], APP), inner, 'quotes inside read back as typed');
  });

  test('a cd elsewhere is part of the step, by the folder it leads to', () => {
    const a = stepKey('Bash', { command: 'cd packages/a && npm test' }, APP);
    assert.equal(stepKey('Bash', { command: `cd ${APP}/packages/a && npm test` }, APP), a);
    assert.equal(stepKey('Bash', { command: 'cd packages && cd ./a/ && npm test' }, APP), a);
    assert.equal(stepKey('Bash', { command: 'cd ../app/packages/a; npm test' }, APP), a);
    assert.equal(stepKey('Bash', { command: 'npm test' }, `${APP}/packages/a`), a, 'or run from there');
    assert.notEqual(stepKey('Bash', { command: 'cd packages/b && npm test' }, APP), a);
    assert.equal(coreCommand(`cd ${APP}/packages/a && npm test 2>&1 | tail -5`, APP), 'cd packages/a && npm test', 'shown as from the folder it runs in');
  });

  test('a trailing grep is part of the step, unless it filters a test or build run', () => {
    assert.notEqual(stepKey('Bash', { command: 'git log --oneline | grep fix' }), stepKey('Bash', { command: 'git log --oneline | grep feat' }));
    assert.equal(coreCommand('git log --oneline | grep fix | head -5'), 'git log --oneline | grep fix');
    for (const run of ['npm test', 'npm run build', 'pnpm typecheck', 'npx vitest run', 'pytest -x', 'cargo test', 'go test ./...', 'make check', 'node --test test/']) {
      assert.equal(coreCommand(`${run} 2>&1 | grep -E "FAIL|Error" | head -20`), run, run);
    }
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
      "bash -lc 'npm install'",
      "(cd src && rm old.ts)",
      "find . -name '*.orig' -exec sh -c 'rm \"$1\"' _ {} \\;",
      "cat > src/a.ts <<'EOF'\nexport const a = 1;\nEOF",
      'cat <<EOF >> notes.md\n- done\nEOF',
      'echo "export {}" > src/index.ts',
      'npm test 2>&1 | tee test-output.txt',
      'jq . package.json | tee -a package.tmp.json',
      "python3 - <<'EOF'\nfrom pathlib import Path\nPath('src/a.py').write_text('x = 1')\nEOF",
      "python - <<'PY'\nwith open('config.json', 'w') as f:\n    f.write('{}')\nPY",
      'node <<EOF\nrequire("fs").writeFileSync("a.json", "{}")\nEOF',
      "ruby -e 'File.open(\"a.rb\", \"a\") { |f| f.puts 1 }'",
      'gofmt -w main.go',
      'npx prettier -w src',
      'npm run format',
      'pnpm lint:fix',
      'yarn codegen',
      'npm run generate -- --force',
      'npm run build:types',
      'node scripts/build-icons.mjs',
      'python scripts/gen_schema.py',
      'bash <<EOF\necho ready > status.txt\nEOF',
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
      'npm test >> /tmp/run.txt',
      'npm test 2>/dev/null',
      'npm test | tee test.log',
      'pytest > results.out',
      'node -e "console.log([1, 2].map((x) => x * 2))"',
      "python3 - <<'EOF'\nprint(open('a.py').read())\nEOF",
      'docker run --rm node:22 npm test',
      'grep -rn "rm -rf" src',
      'grep -w token src/auth.ts',
      "curl -s -w '%{http_code}' localhost:3000",
      'npm run test:fixtures',
      'echo "=> done" >&2',
      "awk '$3 > 100' data.csv",
      'python3 -c "print(1 > 0)"',
    ];
    for (const command of nothing) assert.equal(changesFiles(command), false, command);
    assert.equal(changesFiles(['git', 'checkout', 'main']), true, 'a Codex argument list');
    assert.equal(changesFiles(['bash', '-lc', "cat > src/a.ts <<'EOF'\nx\nEOF"]), true, 'and one handed to a shell');
  });

  test('a script that writes the file the tests then fail on is progress, three times over', () => {
    const t = rules();
    for (let i = 0; i < 3; i += 1) {
      t.run(ran({ input: { command: `python3 - <<'EOF'\nopen('src/calc.py', 'w').write('def add(a, b): return a + ${i}')\nEOF` }, at: T0 + i * 10 }));
      t.run(failed({ input: { command: 'pytest -q' }, at: T0 + i * 10 + 1 }));
    }
    assert.equal(t.stuck(), null);
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

describe('rule 3: the same step failed 6 times within 20 minutes with the same error', () => {
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

  test('the error is the first line that says something: not `Exit code 1`, a banner or npm about the script', () => {
    /** @type {[string, string, string][]} what failed, its text, the line compared ('' none) */
    const failures = [
      ['Claude Code, node --test', 'Exit code 1\n\n> andary@0.1.0 test\n> node --test test/\n\n▶ login\n  ✔ accepts a fresh token (0.8ms)\n  ✖ rejects an expired token (1.2ms)\n    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', '✖ rejects an expired token'],
      ['Claude Code, vitest', 'Exit code 1\n\n> app@1.0.0 test\n> vitest run\n\n RUN  v2.1.8 /work/app\n\n ❯ test/auth.test.ts (3 tests | 1 failed) 12ms\n   × login > rejects expired tokens 5ms', '❯ test/auth.test.ts (3 tests | 1 failed)'],
      ['Claude Code, pytest', 'Exit code 1\n============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-8.3.3, pluggy-1.5.0\nrootdir: /work/app\nconfigfile: pyproject.toml\ncollected 12 items\n\ntests/test_cart.py ..F.........                                         [100%]', 'tests/test_cart.py ..F......... [100%]'],
      ['Claude Code, a crash', "Exit code 1\nnode:internal/modules/run_main:123\n    triggerUncaughtException(\n\nTypeError: Cannot read properties of undefined (reading 'split')", 'node:internal/modules/run_main:123'],
      ['Claude Code, the command echoed', 'Exit code 2\n+ npm test\n$ npm test\nnpm test\nmake: *** [Makefile:12: test] Error 2', ''],
      ['Claude Code, nothing but the exit code', 'Exit code 1', ''],
      ['Codex, npm 10 on stderr', 'npm error Lifecycle script `test` failed with error:\nnpm error code 1\nnpm error path /work/app\nnpm error workspace app@1.0.0\nnpm error location /work/app\nnpm error command failed\nnpm error command sh -c node --test', ''],
      ['Codex, npm 6 on stderr', 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1\nnpm ERR! app@1.0.0 test: `node --test`\nnpm ERR! Exit status 1\nnpm ERR!\nnpm ERR! Failed at the app@1.0.0 test script.\nnpm ERR! This is probably not a problem with npm. There is likely additional logging output above.\n\nnpm ERR! A complete log of this run can be found in:\nnpm ERR!     /root/.npm/_logs/2026-11-21T00_00_00_000Z-debug.log', ''],
      ['Codex, pnpm and yarn', ' ELIFECYCLE  Test failed. See above for more details.\nERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  app@1.0.0 test: `vitest run`\nerror Command failed with exit code 1.\ninfo Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.', ''],
      ['Codex, no output', 'Exit code 1', ''],
      ['Codex, a plain word', 'Error', ''],
      ['CI', 'Error: Process completed with exit code 1.\ncommand failed', ''],
      ['Codex, a real error on stderr', 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/left-padd', 'npm error code E404'],
    ];
    for (const [what, text, line] of failures) assert.equal(errorSignature(text, 'npm test'), line, what);
  });

  test('red, edit, red again: six runs of TDD are not stuck, with Claude Code or Codex', () => {
    const claude = rules();
    for (let i = 0; i < 6; i += 1) {
      claude.run(failed({ at: T0 + i * MINUTE, error: `Exit code 1\n\n> app@1.0.0 test\n> node --test\n\n✖ case ${i} works (0.${i}ms)` }), edited({ at: T0 + i * MINUTE + 1 }));
    }
    assert.equal(claude.stuck(), null);
    const codex = rules();
    const stderr = 'npm error Lifecycle script `test` failed with error:\nnpm error code 1\nnpm error path /work/app\nnpm error command failed\nnpm error command sh -c node --test';
    for (let i = 0; i < 6; i += 1) codex.run(failed({ input: { command: ['bash', '-lc', 'npm test'] }, at: T0 + i * MINUTE, error: stderr }), edited({ at: T0 + i * MINUTE + 1 }));
    assert.equal(codex.stuck(), null, 'npm saying the script failed says nothing about how');
  });

  test('the same TypeError six times, edits or not, is stuck; a failure saying nothing leaves the count alone', () => {
    const t = rules();
    for (let i = 0; i < 6; i += 1) {
      t.run(failed({ at: T0 + i * MINUTE, error: `Exit code 1\n\n> app@1.0.0 test\n> node --test\n\n✖ login (${i + 1}.2ms)\n  TypeError: token is undefined` }), edited({ at: T0 + i * MINUTE + 1 }));
      if (i === 2) t.run(failed({ at: T0 + i * MINUTE + 2, error: 'Exit code 1' }), edited({ at: T0 + i * MINUTE + 3 }));
    }
    assert.deepEqual([t.stuck()?.rule, t.stuck()?.count], [3, 6]);
  });

  test('its window goes by when the failures happened, not when they arrived', () => {
    const t = rules();
    const late = (/** @type {number} */ minute) => failed({ at: T0 + minute * MINUTE, error: 'TypeError: token is undefined' });
    for (const minute of [30, 31, 32, 33, 34]) t.run(late(minute), edited({ at: T0 + minute * MINUTE + 1 }));
    t.run(late(0));
    assert.equal(t.stuck(), null, 'the sixth happened half an hour before the others');
    t.run(late(29));
    assert.deepEqual([t.stuck()?.rule, t.stuck()?.count], [3, 6], 'this one, though late, happened within the 20 minutes');
  });
});

describe('hooks that arrive out of order', () => {
  test('a failure made before an edit but arriving after it does not count towards rule 1', () => {
    const t = rules();
    t.run(edited({ at: T0 + 2 }), failed({ at: T0 + 1 }), failed({ at: T0 + 3 }), failed({ at: T0 + 4 }));
    assert.equal(t.stuck(), null, 'two failures since the edit');
    t.run(failed({ at: T0 + 5 }));
    assert.equal(t.stuck()?.rule, 1);
  });

  test("another agent's edit in the folder moves the line too, and a late success changes nothing", () => {
    const t = rules();
    t.run(ran({ input: { command: 'ls' }, at: T0 }), edited({ agent: HELPER, at: T0 + 10 }), ran({ at: T0 + 5 }), ran({ at: T0 + 6 }));
    t.run(...times(4, (i) => ran({ at: T0 + 11 + i })));
    assert.equal(t.stuck(), null, 'four runs since the edit');
    t.run(...times(3, (i) => failed({ input: { command: 'npm run lint' }, at: T0 + 20 + i })));
    t.run(ran({ input: { command: 'npm run lint' }, at: T0 + 9 }));
    assert.equal(t.stuck()?.step, 'npm run lint', 'it worked before the edit, not since');
  });
});

describe('a monorepo: a cd into a package is a step of its own', () => {
  test("each package's checks, one after another, never seem stuck", () => {
    const t = rules();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) t.run(failed({ input: { command: `cd packages/${name} && npm test 2>&1 | tail -20` } }));
    assert.equal(t.stuck(), null);
    const codex = rules();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) codex.run(failed({ input: { command: ['bash', '-lc', `cd packages/${name} && npm test`] }, error: 'npm error code 1' }));
    assert.equal(codex.stuck(), null);
  });

  test('the same package red three times with nothing changed is', () => {
    const t = rules();
    t.run(failed({ input: { command: 'cd packages/a && npm test' } }), failed({ input: { command: 'cd packages/b && npm test' } }));
    t.run(failed({ input: { command: `cd ${APP}/packages/a && npm test | tail -5` } }), failed({ folder: `${APP}/packages/a`, input: { command: 'npm test' } }));
    assert.equal(t.stuck()?.text, 'Seems stuck: `cd packages/a && npm test` failed 3 times, nothing changed');
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
      ['Bash', { command: 'curl -s http://localhost:3000/health' }],
      ['Bash', { command: 'curl -fsS http://127.0.0.1:8080/ > /dev/null && echo up' }],
      ['Bash', { command: 'wget -qO- localhost:5173' }],
      ['Bash', { command: 'tail -n 100 logs/server.log' }],
      ['Bash', { command: 'ps aux | grep -v grep | grep vite' }],
      ['Bash', { command: 'pgrep -f "node server.js"' }],
      ['Bash', { command: 'docker ps --format "{{.Names}}"' }],
      ['Bash', { command: 'docker compose ps' }],
      ['Bash', { command: 'kubectl get pods -n staging' }],
      ['Bash', { command: 'gh pr view 42 --json statusCheckRollup' }],
      ['Bash', { command: 'lsof -i :3000' }],
      ['Bash', { command: "bash -lc 'sleep 30'" }],
      ['Bash', { command: ['bash', '-lc', 'sleep 30 && gh run list --limit 1'] }],
    ];
    for (const [tool, input] of waits) {
      assert.equal(isPolling(tool, input), true, `${tool} ${JSON.stringify(input)}`);
      const t = rules();
      for (let i = 0; i < 10; i += 1) t.run(ran({ tool, input, at: T0 + i }), failed({ tool, input, at: T0 + i, error: 'Exit code 8' }));
      assert.equal(t.stuck(), null, `${tool} ${JSON.stringify(input)}`);
    }
  });

  test('ordinary steps are not waits, and a wait that changes files is still a change', () => {
    for (const command of ['npm test', 'npm run watch', 'npx tsc --watch', 'cat src/a.ts', 'gh pr create --fill', 'curl -X POST localhost:3000/api/login', 'echo done']) {
      assert.equal(isPolling('Bash', { command }), false, command);
    }
    assert.equal(isPolling('Read', { file_path: `${APP}/src/tasks/list.output.ts` }), false);
    const t = rules();
    t.run(...times(3, () => failed()));
    t.run(ran({ input: { command: 'sleep 10 && git pull' } }));
    assert.equal(t.stuck(), null);
  });

  test('only a command that is nothing but waiting is a wait: `sleep 5 && npm test` is the test run', () => {
    assert.equal(isPolling('Bash', { command: 'sleep 5 && npm test' }), false);
    assert.equal(isPolling('Bash', { command: ['bash', '-lc', 'sleep 2; npm test'] }), false);
    const t = rules();
    t.run(failed({ input: { command: 'sleep 5 && npm test' } }), failed(), failed({ input: { command: 'sleep 2; npm test 2>&1 | tail' } }));
    assert.equal(t.stuck()?.text, 'Seems stuck: `npm test` failed 3 times, nothing changed');
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
  test('words that name no step, for notes that may show on a locked screen, follow the rule', () => {
    assert.deepEqual([1, 2, 3].map((rule) => stuckWords(/** @type {1|2|3} */ (rule))), ['the same step keeps failing', 'it keeps repeating the same step', 'the same step keeps failing']);
  });


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
  test('a step failing between many others is remembered: twenty reads between attempts', () => {
    const t = rules();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      t.run(failed());
      t.run(...times(20, (i) => ran({ tool: 'Read', input: { file_path: `${APP}/src/${attempt}-${i}.ts` } })));
    }
    assert.equal(t.stuck()?.rule, 1);
  });

  test(`at most ${MAX_STEPS} steps an agent: one that never failed goes first, else the one run the longest ago`, () => {
    const t = rules();
    t.run(...times(3, () => failed()));
    t.run(...times(MAX_STEPS * 2, (i) => ran({ tool: 'Read', input: { file_path: `${APP}/src/${i}.ts` } })));
    assert.equal(t.stuck()?.rule, 1, 'reads never push out a failing step');
    t.run(...times(MAX_STEPS - 1, (i) => failed({ input: { command: `npm test -- case-${i}` } })));
    assert.equal(t.stuck()?.rule, 1);
    t.run(failed({ input: { command: 'npm test -- last' } }));
    assert.equal(t.stuck(), null, 'with every step failing, the one run the longest ago goes, and its alert ends');
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
