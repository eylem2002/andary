// The catch-up's counters (core/digest.js): what each hook counts for, from real hook payloads;
// five-minute buckets that roll over; a day's bound on what is kept.
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

/** @param {string} command @param {'PostToolUse'|'PostToolUseFailure'} [name] @param {Record<string, any>} [extra] */
const ran = (command, name = 'PostToolUse', extra = {}) => hook(name, { tool_name: 'Bash', tool_input: { command }, tool_use_id: `t-${command}`, ...extra });

describe('what each hook counts for', () => {
  test('a finished turn, with its last message; an interrupted one is none', () => {
    const crew = crewAfter([FIXTURES.Stop, { ...FIXTURES.Stop, last_assistant_message: '' }, hook('Stop', { stop_reason: 'interrupted', last_assistant_message: 'Interrupted' })]);
    assert.equal(crew?.turns, 2);
    // The latest turn that said something.
    assert.equal(crew?.lastMessage, 'All done.');
    const long = crewAfter([hook('Stop', { last_assistant_message: `Done.\n\n${'word '.repeat(80)}` })]);
    assert.ok(long?.lastMessage && long.lastMessage.length <= 200 && !long.lastMessage.includes('\n'), 'one line, clipped');
  });

  test('a stopped turn, by its kind', () => {
    const crew = crewAfter([FIXTURES.StopFailure, FIXTURES.StopFailure, hook('StopFailure', { error: 'server_error' })]);
    assert.deepEqual(crew?.stops, { rate_limit: 2, server_error: 1 });
    assert.equal(crew?.turns, 0);
  });

  test('a failed tool call, unless you interrupted it; a test command failing is a test result', () => {
    const crew = crewAfter([FIXTURES.PostToolUseFailure, ran('ls missing', 'PostToolUseFailure', { error: 'Exit code 2' }), ran('npm test', 'PostToolUseFailure', { is_interrupt: true, error: 'Interrupted' })]);
    assert.equal(crew?.failures, 2);
    assert.equal(crew?.tests, 'failed');
  });

  test('the latest test command decides the test result, read as the town reads a test run', () => {
    assert.equal(crewAfter([FIXTURES.PostToolUseFailure, FIXTURES.PostToolUse])?.tests, 'passed');
    assert.equal(crewAfter([FIXTURES.PostToolUse, FIXTURES.PostToolUseFailure])?.tests, 'failed');
    assert.equal(crewAfter([ran('npx vitest run src/a.test.ts')])?.tests, 'passed');
    // Its strongest kind is a push (core/summaries.js): no test result, as in the town's weather.
    assert.equal(crewAfter([ran('npm test && git push')])?.tests, null);
    assert.equal(crewAfter([ran('npm run build')]), undefined, 'a build is nothing the catch-up counts');
    // Sent to the background, it has only started when its hook comes: no result, no push yet.
    const background = hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test && git push', run_in_background: true }, tool_use_id: 'bg', tool_response: {} });
    assert.equal(crewAfter([background]), undefined);
  });

  test('commits and pushes, both from one command, and whether the latest commit was pushed', () => {
    const both = crewAfter([ran('git add -A && git commit -m "fix" && git push')]);
    assert.deepEqual([both?.commits, both?.pushes, both?.allPushed], [1, 1, true]);
    const later = crewAfter([ran('git push'), ran('git commit -am "more"')]);
    assert.deepEqual([later?.commits, later?.pushes, later?.allPushed], [1, 1, false]);
    const failed = crewAfter([ran('git push', 'PostToolUseFailure', { error: 'Exit code 1' })]);
    assert.deepEqual([failed?.pushes, failed?.failures], [0, 1]);
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

  test('tool calls, permissions asked (not questions or plans) and helpers', () => {
    const crew = crewAfter([
      FIXTURES.PreToolUse,
      FIXTURES.PermissionRequest,
      hook('PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }),
      hook('PermissionRequest', { tool_name: 'ExitPlanMode', tool_input: { plan: 'Do it' } }),
      FIXTURES.SubagentStart,
      FIXTURES.SubagentStop,
      hook('SubagentStart', {}, { agent: { id: 'agent-b2', type: 'Plan' } }),
    ]);
    assert.deepEqual([crew?.toolCalls, crew?.asked, crew?.helpersStarted, crew?.helpersFinished], [1, 1, 2, 1]);
  });

  test('permissions answered come from the approval, when it settles by an answer', () => {
    const digest = createDigest();
    const approval = { id: 'a1', sessionId: SESSION, toolName: 'Bash', cwd: CWD };
    for (const status of ['pending', 'allowed', 'denied', 'resolved', 'expired']) digest.answered({ ...approval, status }, T0);
    digest.answered({ ...approval, status: 'resolved', toolName: 'AskUserQuestion' }, T0);
    digest.answered({ ...approval, status: 'allowed', sessionId: 'andary-doctor-1' }, T0);
    const [crew] = digest.summary(0, T0 + 1).crews;
    assert.deepEqual([crew.sessionId, crew.answered, crew.cwd], [SESSION, 3, CWD]);
  });

  test('hooks that count for nothing; the doctor\'s probe leaves no crew', () => {
    for (const name of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Notification', 'PreCompact', 'PostCompact', 'TaskCreated', 'TeammateIdle', 'PostModelSwitch', 'PermissionDenied']) {
      assert.equal(tallyOf(FIXTURES[/** @type {keyof typeof FIXTURES} */ (name)]), null, name);
    }
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

describe('five-minute buckets and the day they cover', () => {
  test('a summary counts every bucket that ends after the time it is asked for, and says where it starts', () => {
    const digest = createDigest();
    digest.observe(FIXTURES.Stop, T0 + BUCKET_MS - 1);
    digest.observe(FIXTURES.Stop, T0 + BUCKET_MS);
    const at = T0 + BUCKET_MS + 1000;
    const after = digest.summary(T0 + BUCKET_MS, at);
    assert.deepEqual([after.since, after.until, after.crews[0].turns], [T0 + BUCKET_MS, at, 1]);
    // Asked from the middle of the first bucket: all of it counts, a few minutes early at most.
    const during = digest.summary(T0 + 60_000, at);
    assert.deepEqual([during.since, during.crews[0].turns], [T0, 2]);
    // A time after now counts from now: the bucket now is in.
    const later = digest.summary(at + 60_000, at);
    assert.deepEqual([later.since, later.crews[0].turns], [T0 + BUCKET_MS, 1]);
    assert.deepEqual(digest.summary(T0 + 2 * BUCKET_MS, T0 + 2 * BUCKET_MS).crews, [], 'nothing yet in a bucket that has just begun');
  });

  test('a day at most: older buckets and files are dropped, and a crew quiet for a day is forgotten', () => {
    const digest = createDigest();
    const edit = hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: `${CWD}/old.md`, content: '' }, tool_use_id: 'w1' });
    digest.observe(FIXTURES.Stop, T0);
    digest.observe(edit, T0);
    // Another crew works every five minutes for two days.
    for (let at = T0; at <= T0 + 2 * KEEP_MS; at += BUCKET_MS) digest.observe(hook('PreToolUse', { tool_name: 'Read' }, { session: OTHER }), at);
    const at = T0 + 2 * KEEP_MS;
    assert.ok(digest.size().buckets <= KEEP_MS / BUCKET_MS + 2, `a day of buckets per crew, not ${digest.size().buckets}`);
    const { since, crews } = digest.summary(0, at);
    assert.equal(since, at - KEEP_MS, 'everything kept: the last day');
    assert.deepEqual(crews.map((c) => [c.sessionId, c.toolCalls]), [[OTHER, KEEP_MS / BUCKET_MS + 1]]);
    assert.deepEqual(digest.size(), { crews: 1, buckets: KEEP_MS / BUCKET_MS + 1, files: 0 }, 'the quiet crew, its bucket and its file are gone');
  });

  test('a bucket a day old rolls out as the next one starts', () => {
    const digest = createDigest();
    digest.observe(FIXTURES.Stop, T0);
    digest.observe(FIXTURES.PreToolUse, T0 + KEEP_MS);
    assert.equal(digest.summary(0, T0 + KEEP_MS).crews[0].turns, 1, 'still within the day');
    digest.observe(FIXTURES.PreToolUse, T0 + KEEP_MS + BUCKET_MS);
    assert.equal(digest.summary(0, T0 + KEEP_MS + BUCKET_MS).crews[0].turns, 0);
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
});
