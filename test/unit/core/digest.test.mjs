// The catch-up's counts (core/digest.js): what each hook counts for, from real hook payloads;
// exact times for the rare things and five-minute buckets for the frequent ones; where a summary
// starts and why; a day's bound on what is kept.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { BUCKET_MS, KEEP_MS, createDigest, tallyOf } from '../../../public/js/core/digest.js';
import { CWD, FIXTURES, SESSION, hook } from './helpers.mjs';

/** A time on a bucket's boundary, so tests can sit just before or after one. */
const T0 = 1_000 * BUCKET_MS;
const OTHER = '7c1d0e3f-2e5b-4d44-8f20-1b8c7d6e5f40';

/** The crew's summary for everything kept, after these hooks (each a moment after the last). @param {Record<string, any>[]} events */
function crewAfter(events, session = SESSION) {
  const digest = createDigest();
  events.forEach((event, i) => digest.observe(event, T0 + i * 1000));
  return digest.summary(0, T0 + events.length * 1000).crews.find((crew) => crew.sessionId === session);
}

/** @param {string|string[]} command @param {'PostToolUse'|'PostToolUseFailure'} [name] @param {Record<string, any>} [extra] */
const ran = (command, name = 'PostToolUse', extra = {}) => hook(name, { tool_name: 'Bash', tool_input: { command }, tool_use_id: `t-${command}`, ...(name === 'PostToolUseFailure' ? { error: 'Exit code 1' } : {}), ...extra });

/** @param {import('../../../public/js/core/digest.js').Digest} digest */
const pick = (digest) => [digest.since, digest.limit];

describe('what each hook counts for', () => {
  test('a finished turn, with what the latest one said; an interrupted one, or one a Stop hook kept going, is none', () => {
    const crew = crewAfter([FIXTURES.Stop, hook('Stop', { stop_reason: 'interrupted', last_assistant_message: 'Interrupted' }), hook('Stop', { stop_hook_active: true, last_assistant_message: 'Fixed the lint too.' })]);
    assert.equal(crew?.turns, 1, 'the Stop hook kept the same turn going');
    assert.equal(crew?.lastMessage, 'Fixed the lint too.', 'its newer words');
    // The latest turn said nothing: nothing to show, not an older turn's words.
    assert.equal(crewAfter([FIXTURES.Stop, { ...FIXTURES.Stop, last_assistant_message: '' }])?.lastMessage, null);
    const long = crewAfter([hook('Stop', { last_assistant_message: `Done.\n\n${'word '.repeat(80)}` })]);
    assert.ok(long?.lastMessage && long.lastMessage.length <= 200 && !long.lastMessage.includes('\n'), 'one line, clipped');
  });

  test('a stopped turn, by its kind', () => {
    const crew = crewAfter([FIXTURES.StopFailure, FIXTURES.StopFailure, hook('StopFailure', { error: 'server_error' })]);
    assert.deepEqual(crew?.stops, { rate_limit: 2, server_error: 1 });
    assert.equal(crew?.turns, 0);
  });

  test('a failed tool call, unless you interrupted it', () => {
    const crew = crewAfter([FIXTURES.PostToolUseFailure, ran('ls missing', 'PostToolUseFailure', { error: 'Exit code 2' }), ran('npm test', 'PostToolUseFailure', { is_interrupt: true, error: 'Interrupted' })]);
    assert.equal(crew?.failures, 2);
    assert.equal(crew?.tests, 'failed');
  });

  test('tests pass or fail only when the line\'s exit status is a test run\'s', () => {
    /** @type {[Record<string, any>, 'passed'|'failed'|null][]} */
    const table = [
      [ran('npm test'), 'passed'],
      [ran('npx vitest run src/a.test.ts'), 'passed'],
      [ran('cd app && npm test'), 'passed'],
      [ran('X=1 uv run pytest -q'), 'passed'],
      [ran("bash -lc 'python -m pytest'"), 'passed'],
      // A Codex argument list is read as the line it stands for.
      [ran(['bash', '-lc', 'cd app && npm test']), 'passed'],
      [ran('set -o pipefail; npm test 2>&1 | tail -20'), 'passed'],
      [ran('npm test && git push'), 'passed'],
      [ran('npm test', 'PostToolUseFailure'), 'failed'],
      [ran('cd app && npm test', 'PostToolUseFailure'), 'failed'],
      [ran('set -o pipefail; npm test 2>&1 | tail -20', 'PostToolUseFailure'), 'failed'],
      // A runner named in an argument runs nothing: Codex reads files through the shell.
      [ran('rg -n "vitest" package.json'), null],
      [ran('npm install -D vitest'), null],
      [ran('pip install pytest'), null],
      [ran('cat jest.config.js'), null],
      [ran("sed -n '1,80p' tox.ini"), null],
      // The line's status is not the tests'.
      [ran('npm test 2>&1 | tail -20'), null],
      [ran('npm test 2>&1 | tail -20', 'PostToolUseFailure'), null],
      [ran('npm test; echo done'), null],
      [ran('npm test || true'), null],
      [ran('npm run build && npm test', 'PostToolUseFailure'), null],
      [ran('npm test && git push', 'PostToolUseFailure'), null],
      // A timeout is a timeout, as the town calls it, not red tests.
      [ran('npm test', 'PostToolUseFailure', { error: 'Command timed out after 2m 0.0s' }), null],
      // A test command that runs no tests says nothing of them.
      ...['cargo test --no-run', 'pytest --collect-only -q', 'pytest --co', 'npx playwright test --list', 'npx jest --listTests', 'npx vitest --list-tags', 'pytest -l', 'tox list', 'npx vitest --help', 'pytest -h', 'npx jest --version', 'npm test --if-present', 'go test -run NONE ./...', 'go test -run=TestX']
        .flatMap((command) => /** @type {[Record<string, any>, null][]} */ ([[ran(command), null], [ran(command, 'PostToolUseFailure'), null]])),
      // A name filter still runs tests (go's -run aside): a filter matching none fails in most runners.
      [ran('pytest -k login'), 'passed'],
      [ran('npx jest -t "logs in"'), 'passed'],
      [ran('npx mocha --grep login'), 'passed'],
      [ran('npx jest --testNamePattern=login', 'PostToolUseFailure'), 'failed'],
    ];
    for (const [event, expected] of table) assert.equal(crewAfter([event])?.tests ?? null, expected, `${event.hook_event_name}: ${event.tool_input.command}`);
    assert.equal(crewAfter([FIXTURES.PostToolUseFailure, FIXTURES.PostToolUse])?.tests, 'passed', 'the latest decides');
    assert.equal(crewAfter([FIXTURES.PostToolUse, FIXTURES.PostToolUseFailure])?.tests, 'failed');
    assert.equal(crewAfter([ran('npm run build')]), undefined, 'a build is nothing the catch-up counts');
    // Sent to the background, it has only started when its hook comes: no result, no push yet.
    const background = hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test && git push', run_in_background: true }, tool_use_id: 'bg', tool_response: {} });
    assert.equal(crewAfter([background]), undefined);
  });

  test('each commit and push a command must have made, read from git in command position', () => {
    /** @type {[string, [number, number]][]} */
    const table = [
      ['git add -A && git commit -m "fix" && git push', [1, 1]],
      ['git commit -m a && git commit -m b', [2, 0]],
      ['git -C repo commit -m x', [1, 0]],
      ['git -c commit.gpgsign=false commit -m x && git push -u origin main', [1, 1]],
      ['git commit -m "Explain why git push needs a remote"', [1, 0]],
      ['echo "do the git push later"', [0, 0]],
      ['git push --dry-run', [0, 0]],
      ['grep -rn "git commit" docs/', [0, 0]],
      // The line succeeding says nothing of a commit before `;`: it may have had nothing to commit.
      ['git commit -m x; git push', [0, 1]],
      // An amend rewrites a commit; a deletion sends nothing.
      ['git commit --amend --no-edit && git push --force-with-lease', [0, 1]],
      ['git push --delete origin old-branch', [0, 0]],
      ['git push -d origin old-branch', [0, 0]],
      ['git push origin :old-branch', [0, 0]],
    ];
    for (const [command, expected] of table) {
      const crew = crewAfter([ran(command)]);
      assert.deepEqual([crew?.commits ?? 0, crew?.pushes ?? 0], expected, command);
    }
    // A push that had nothing to send is no push.
    const same = crewAfter([ran('git push', 'PostToolUse', { tool_response: { stdout: '', stderr: 'Everything up-to-date\n' } })]);
    assert.equal(same?.pushes ?? 0, 0);
    const two = crewAfter([ran('git push origin a && git push origin b', 'PostToolUse', { tool_response: { stdout: '', stderr: 'Everything up-to-date\nTo github.com:x/y.git\n' } })]);
    assert.equal(two?.pushes, 1, 'one of two sent nothing');
    const later = crewAfter([ran('git push'), ran('git commit -am "more"')]);
    assert.deepEqual([later?.commits, later?.pushes, later?.allPushed], [1, 1, false]);
    assert.equal(crewAfter([ran('git commit -am "more" && git push')])?.allPushed, true);
    const failed = crewAfter([ran('git push', 'PostToolUseFailure', { error: 'Exit code 1' })]);
    assert.deepEqual([failed?.pushes, failed?.failures], [0, 1]);
  });

  test('a push while the latest test run had failed is counted apart; one after a passing run is not', () => {
    const red = ran('npm test', 'PostToolUseFailure', { error: 'Exit code 1\n FAIL  test/login.test.ts > login' });
    const crew = crewAfter([red, ran('git push'), ran('git push origin other')]);
    assert.deepEqual([crew?.tests, crew?.pushes, crew?.redPushes], ['failed', 2, 2]);
    assert.equal(crewAfter([red, ran('npm test'), ran('git push')])?.redPushes, 0);
    assert.equal(crewAfter([red, ran('npm test && git push')])?.redPushes, 0, 'the same line: tests first');
    assert.equal(crewAfter([ran('git push')])?.redPushes, 0, 'no test run known');
  });

  test('a Codex command proves a result only when its adapter found the exit code', () => {
    const codex = (/** @type {string} */ command, /** @type {Record<string, any>} */ extra = {}) => ({ ...ran(command), andary_source: 'codex', ...extra });
    assert.equal(crewAfter([codex('npm test && git commit -am x && git push')]), undefined, 'no exit code: nothing proved');
    const known = crewAfter([codex('npm test && git commit -am x && git push', { andary_exit_known: true })]);
    assert.deepEqual([known?.tests, known?.commits, known?.pushes], ['passed', 1, 1]);
  });

  test('files changed: distinct files, by Edit, MultiEdit, Write, NotebookEdit and a Codex patch that deletes one', () => {
    const edit = (/** @type {string} */ tool, /** @type {Record<string, any>} */ input) => hook('PostToolUse', { tool_name: tool, tool_input: input, tool_response: {}, tool_use_id: `t-${tool}` });
    const crew = crewAfter([
      edit('Edit', { file_path: `${CWD}/src/a.ts`, old_string: 'a', new_string: 'b' }),
      edit('Edit', { file_path: `${CWD}/src/a.ts`, old_string: 'b', new_string: 'c' }),
      edit('MultiEdit', { file_path: `${CWD}/src/b.ts`, edits: [{ old_string: 'x', new_string: 'y' }] }),
      edit('Write', { file_path: `${CWD}/README.md`, content: '# hi' }),
      edit('NotebookEdit', { notebook_path: `${CWD}/nb.ipynb`, new_source: 'print(1)' }),
      { ...edit('apply_patch', { command: '*** Begin Patch\n*** Delete File: old.ts\n*** End Patch', file_path: `${CWD}/old.ts` }), andary_source: 'codex' },
      // Reading a file, or an edit that failed, changes nothing.
      edit('Read', { file_path: `${CWD}/src/c.ts` }),
      hook('PostToolUseFailure', { tool_name: 'Edit', tool_input: { file_path: `${CWD}/src/d.ts` }, error: 'String not found' }),
    ]);
    assert.equal(crew?.files, 5);
  });

  test('tool calls (a Codex patch over several files is one), permissions asked (not questions or plans) and helpers', () => {
    // The Codex adapter makes one call per file of a patch: `p1`, `p1#2`, `p1#3`.
    const patch = ['p1', 'p1#2', 'p1#3'].map((id) => hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${CWD}/${id}.ts` }, tool_use_id: id, andary_tool: 'apply_patch', andary_source: 'codex' }));
    const crew = crewAfter([
      FIXTURES.PreToolUse,
      ...patch,
      FIXTURES.PermissionRequest,
      hook('PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }),
      hook('PermissionRequest', { tool_name: 'ExitPlanMode', tool_input: { plan: 'Do it' } }),
      FIXTURES.SubagentStart,
      FIXTURES.SubagentStop,
      hook('SubagentStart', {}, { agent: { id: 'agent-b2', type: 'Plan' } }),
    ]);
    assert.deepEqual([crew?.toolCalls, crew?.asked, crew?.helpersStarted, crew?.helpersFinished], [2, 1, 2, 1]);
  });

  test('permissions answered: decided in the town, or run or denied in the terminal; one the agent moved on from is not', () => {
    const digest = createDigest();
    const approval = { id: 'a1', sessionId: SESSION, toolName: 'Bash', cwd: CWD };
    for (const status of ['pending', 'allowed', 'denied', 'resolved', 'expired']) digest.answered({ ...approval, status }, T0);
    for (const status of ['resolved', 'expired']) for (const proof of ['ran', 'denied', 'stopped']) digest.answered({ ...approval, status, proof }, T0);
    digest.answered({ ...approval, status: 'resolved', toolName: 'AskUserQuestion' }, T0);
    digest.answered({ ...approval, status: 'allowed', sessionId: 'andary-doctor-1' }, T0);
    const [crew] = digest.summary(0, T0 + 1).crews;
    assert.deepEqual([crew.sessionId, crew.answered, crew.cwd], [SESSION, 6, CWD]);
  });

  test('hooks that count for nothing; the doctor\'s probe leaves no crew', () => {
    for (const name of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Notification', 'PreCompact', 'PostCompact', 'TaskCreated', 'TeammateIdle', 'PostModelSwitch', 'PermissionDenied']) {
      assert.equal(tallyOf(FIXTURES[/** @type {keyof typeof FIXTURES} */ (name)]), null, name);
    }
    assert.equal(tallyOf(hook('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })), null);
    assert.equal(tallyOf(null), null);
    assert.equal(tallyOf({ hook_event_name: 'constructor' }), null);
    const digest = createDigest();
    digest.observe(FIXTURES.Notification, T0);
    digest.observe({ ...FIXTURES.Stop, session_id: 'andary-doctor-1b2c' }, T0);
    assert.deepEqual(digest.summary(0, T0 + 1).crews, [], 'a crew that did nothing countable is not listed');
    assert.equal(digest.size().crews, 1, 'the probe is not even remembered');
  });

  test('a crew is named by its first folder and its latest title, and listed most recently active first', () => {
    const digest = createDigest();
    digest.observe(hook('SessionStart', { source: 'startup' }), T0);
    digest.observe(hook('UserPromptSubmit', { prompt: 'Go', session_title: 'Fix the login' }), T0 + 1);
    digest.observe({ ...FIXTURES.PreToolUse, cwd: '/elsewhere' }, T0 + 2);
    digest.observe(hook('Stop', {}, { session: OTHER }), T0 + 3);
    const { crews } = digest.summary(0, T0 + 10);
    assert.deepEqual(crews.map((c) => [c.sessionId, c.cwd, c.title]), [[OTHER, CWD, null], [SESSION, CWD, 'Fix the login']]);
  });
});

describe('where a summary starts', () => {
  test('turns and rare things by their exact time; when a five-minute count reaches back, everything counts from its start', () => {
    const digest = createDigest();
    digest.observe(ran('git commit -m a && git push'), T0 + 60_000);
    digest.observe(FIXTURES.Stop, T0 + 60_000);
    digest.observe({ ...FIXTURES.Stop, last_assistant_message: 'Again.' }, T0 + 3 * 60_000);
    const at = T0 + 4 * 60_000;
    // Only exact times since then: counted to the moment.
    const exact = digest.summary(T0 + 2 * 60_000, at);
    assert.deepEqual([exact.since, exact.from, exact.until, exact.limit], [T0 + 2 * 60_000, T0 + 2 * 60_000, at, null]);
    assert.deepEqual([exact.crews[0].turns, exact.crews[0].commits, exact.crews[0].pushes, exact.crews[0].lastMessage], [1, 0, 0, 'Again.']);
    // A tool call since then, in a bucket that began before: all of it counts from the bucket's start.
    digest.observe(FIXTURES.PreToolUse, T0 + 3 * 60_000);
    const back = digest.summary(T0 + 2 * 60_000, at);
    assert.deepEqual([back.since, back.from], [T0 + 2 * 60_000, T0]);
    assert.deepEqual([back.crews[0].turns, back.crews[0].commits, back.crews[0].pushes, back.crews[0].toolCalls], [2, 1, 1, 1], 'not mixed: the commit and the first turn since that start too');
  });

  test('a second look right after the first finds nothing new, though the bucket is the same', () => {
    const digest = createDigest();
    digest.observe(ran('npm test'), T0 + 1000);
    digest.observe(FIXTURES.Stop, T0 + 2000);
    const first = digest.summary(0, T0 + 3000);
    assert.equal(first.crews.length, 1);
    const second = digest.summary(first.until, T0 + 4000);
    assert.deepEqual([second.crews, second.from, second.since], [[], first.until, first.until]);
    // Something new in that bucket: counted, from the bucket's start.
    digest.observe(FIXTURES.PreToolUse, T0 + 5000);
    const third = digest.summary(first.until, T0 + 6000);
    assert.deepEqual([third.crews[0].toolCalls, third.crews[0].turns, third.crews[0].tests, third.from], [1, 1, 'passed', T0], 'counted from the bucket\'s start, the period says so');
    // A new turn alone is counted to the moment: only what is new.
    const fourth = digest.summary(third.until, T0 + 8000);
    assert.deepEqual(fourth.crews, []);
    digest.observe(FIXTURES.Stop, T0 + 9000);
    const fifth = digest.summary(third.until, T0 + 10_000);
    assert.deepEqual([fifth.from, fifth.crews[0].turns, fifth.crews[0].toolCalls, fifth.crews[0].tests], [third.until, 1, 0, null]);
  });

  test('never before the town started, nor more than a day back: the digest says which', () => {
    const started = T0 + 10 * 60_000;
    const digest = createDigest({ startedAt: started });
    digest.observe(FIXTURES.Stop, started + 1000);
    const at = started + 60 * 60_000;
    assert.deepEqual(pick(digest.summary(T0, at)), [started, 'started']);
    assert.deepEqual(pick(digest.summary(0, at)), [started, 'started']);
    assert.deepEqual(pick(digest.summary(started + 5, at)), [started + 5, null]);
    // A day later, a day is what it keeps.
    const later = started + 2 * KEEP_MS;
    assert.deepEqual(pick(digest.summary(started, later)), [later - KEEP_MS, 'day']);
    // A time after now counts from now.
    assert.deepEqual(pick(digest.summary(at + 60_000, at)), [at, null]);
  });
});

describe('bounds', () => {
  test('a day at most: older buckets, times and files are dropped, and a crew quiet for a day is forgotten', () => {
    const digest = createDigest();
    const edit = hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: `${CWD}/old.md`, content: '' }, tool_use_id: 'w1' });
    digest.observe(FIXTURES.Stop, T0);
    digest.observe(edit, T0);
    // Another crew works every five minutes for two days, and commits each time.
    for (let at = T0; at <= T0 + 2 * KEEP_MS; at += BUCKET_MS) {
      digest.observe(hook('PreToolUse', { tool_name: 'Read' }, { session: OTHER }), at);
      digest.observe(hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, tool_use_id: `c${at}` }, { session: OTHER }), at);
    }
    const at = T0 + 2 * KEEP_MS;
    assert.ok(digest.size().buckets <= KEEP_MS / BUCKET_MS + 2, `a day of buckets per crew, not ${digest.size().buckets}`);
    const { since, crews } = digest.summary(0, at);
    assert.equal(since, at - KEEP_MS, 'everything kept: the last day');
    assert.deepEqual(crews.map((c) => [c.sessionId, c.toolCalls, c.commits]), [[OTHER, KEEP_MS / BUCKET_MS + 1, 200]]);
    assert.deepEqual(digest.size(), { crews: 1, buckets: KEEP_MS / BUCKET_MS + 1, files: 0, times: 200 }, 'the quiet crew, its bucket and its file are gone; 200 commit times kept');
  });

  test('a bucket a day old rolls out as the next one starts', () => {
    const digest = createDigest();
    digest.observe(FIXTURES.SubagentStart, T0);
    digest.observe(FIXTURES.PreToolUse, T0 + KEEP_MS);
    assert.equal(digest.summary(0, T0 + KEEP_MS).crews[0].helpersStarted, 1, 'still within the day');
    digest.observe(FIXTURES.PreToolUse, T0 + KEEP_MS + BUCKET_MS);
    assert.equal(digest.summary(0, T0 + KEEP_MS + BUCKET_MS).crews[0].helpersStarted, 0);
    assert.equal(digest.size().buckets, 2);
  });

  test('a hundred crews at most: the one quiet for longest gives way', () => {
    const digest = createDigest();
    for (let i = 0; i <= 100; i += 1) digest.observe(hook('Stop', {}, { session: `s${i}` }), T0 + i);
    const ids = digest.summary(0, T0 + 1000).crews.map((c) => c.sessionId);
    assert.equal(ids.length, 100);
    assert.ok(!ids.includes('s0') && ids.includes('s100'));
  });

  test('a crew remembers 200 changed files, the latest', () => {
    const digest = createDigest();
    for (let i = 0; i < 250; i += 1) digest.observe(hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: `${CWD}/f${i}.ts`, content: '' }, tool_use_id: `w${i}` }), T0 + i);
    assert.equal(digest.summary(0, T0 + 1000).crews[0].files, 200);
  });

  test('only what it counts is kept for a crew: one that only used tools holds no times, files or stops', () => {
    const digest = createDigest();
    digest.observe(FIXTURES.PreToolUse, T0);
    assert.deepEqual(digest.size(), { crews: 1, buckets: 1, files: 0, times: 0 });
  });
});
