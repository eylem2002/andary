// The review queue (core/review.js): per crew, the turns since your last mark rolled up from the
// receipts the store keeps; warnings first; the git command that shows the change; and Markdown
// handoffs and standups (core/handoff.js), built from the same data.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { MAX_REVIEW_FILES, diffCommand, reviewMark, reviewQueue, reviewWarnings, shellQuote } from '../../../public/js/core/review.js';
import { codeSpan, handoffMarkdown, resumeCommand, standupMarkdown } from '../../../public/js/core/handoff.js';
import { CWD, FIXTURES, SESSION, envelope, hook } from './helpers.mjs';

const T0 = 1_700_000_000_000;
const OTHER = '7c1d0e3f-2e5b-4d44-8f20-1b8c7d6e5f40';

function setup() {
  let t = T0;
  const store = createStore({ localHour: () => 12, now: () => t });
  /** @param {Record<string, any>|Record<string, any>[]} payloads */
  const send = (payloads) => {
    for (const payload of [payloads].flat()) {
      t += 1000;
      store.ingest(envelope(payload, t));
    }
  };
  return { store, send, state: () => store.getState() };
}

/** @param {string} tool @param {Record<string, any>} input @param {string} id @param {Record<string, any>} [extra] */
const call = (tool, input, id, extra = {}) => [
  hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, ...extra }),
  hook('PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, tool_response: { stdout: 'ok', stderr: '' }, ...extra }),
];
const edit = (/** @type {string} */ id, file = 'src/auth.ts', extra = {}) => call('Edit', { file_path: `${extra.cwd ?? CWD}/${file}`, old_string: 'a\nb', new_string: 'a\nc\nd' }, id, extra);
const bash = (/** @type {string} */ command, /** @type {string} */ id, extra = {}) => call('Bash', { command }, id, extra);
const failing = (/** @type {string} */ command, /** @type {string} */ id) => [
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id }),
  hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, error: 'Exit code 1\nFAIL test/login.test.ts', is_interrupt: false }),
];

describe('review queue', () => {
  test('rolls up every turn since the mark: files merged, the latest test, a git command from the first turn', () => {
    const { send, state } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(edit('e1'));
    send(bash('npm test', 'b1'));
    send(FIXTURES.Stop);
    send(FIXTURES.UserPromptSubmit);
    send(edit('e2'));
    send(edit('e3', 'src/login.ts'));
    send(bash('npm test', 'b2'));
    send(FIXTURES.Stop);
    const [crew, ...rest] = reviewQueue(state(), {});
    assert.equal(rest.length, 0);
    assert.equal(crew.sessionId, SESSION);
    assert.equal(crew.turns, 2);
    assert.equal(crew.reviewedAt, null);
    assert.deepEqual(crew.files.map((f) => [f.path, f.added, f.removed, f.edits, f.lines]), [['src/login.ts', 2, 1, 1, '+2 −1'], ['src/auth.ts', 4, 2, 2, '+4 −2']]);
    assert.equal(crew.test?.result, 'passed');
    assert.deepEqual(crew.warnings, []);
    assert.equal(crew.diff, `git -C ${CWD} diff 'HEAD@{${new Date(crew.start).toISOString().replace('.000Z', 'Z')}}'`);
  });

  test('a mark leaves out the turns before it; the next turn starts a new card from the mark', () => {
    const { send, state } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(edit('e1'));
    send(FIXTURES.Stop);
    const mark = reviewMark(state(), SESSION);
    assert.ok(mark);
    assert.deepEqual(reviewQueue(state(), { [SESSION]: mark }), []);
    send(FIXTURES.UserPromptSubmit);
    send(edit('e2', 'src/new.ts'));
    send(FIXTURES.Stop);
    const [crew] = reviewQueue(state(), { [SESSION]: mark });
    assert.equal(crew.turns, 1);
    assert.equal(crew.reviewedAt, mark);
    assert.deepEqual(crew.files.map((f) => f.path), ['src/new.ts']);
    assert.match(crew.diff, /HEAD@\{2023-11-14T22:13:\d\dZ\}/);
    assert.equal(reviewMark(state(), 'nobody'), null);
  });

  test('warnings come first: said done untested, failed tests, failed calls; crews with warnings sort first', () => {
    const { send, state } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(edit('e1'));
    send(FIXTURES.Stop);
    const other = (/** @type {Record<string, any>} */ payload) => ({ ...payload, session_id: OTHER, cwd: '/home/dev/code/web' });
    send(other(FIXTURES.UserPromptSubmit));
    send(failing('npm test', 'f1').map(other));
    send(other(FIXTURES.Stop));
    // The crew without warnings finished last, and still comes after the one with them.
    send(FIXTURES.UserPromptSubmit);
    send(bash('ls', 'b9'));
    send(FIXTURES.Stop);
    const crews = reviewQueue(state(), {});
    assert.deepEqual(crews.map((c) => c.sessionId), [SESSION, OTHER]);
    assert.deepEqual(crews[0].warnings, ['Said done, but no test ran this turn after the edits']);
    assert.deepEqual(crews[1].warnings, ['The latest test run failed: npm test: failed (FAIL test/login.test.ts)', '1 failed call']);
  });

  test('the same flag in several turns is said once, with how many', () => {
    const receipt = (/** @type {Record<string, any>} */ fields) => /** @type {any} */ ({ flag: null, othersEdited: null, ended: 'done', failures: 0, ...fields });
    const flag = 'Said done, but tests were not re-run since the last edit';
    assert.deepEqual(reviewWarnings([receipt({ flag }), receipt({ flag }), receipt({ ended: 'error' }), receipt({ othersEdited: 'during', ended: 'interrupted' })], null), [
      `${flag} (2 turns)`,
      'Another crew edited files in this folder',
      'A turn stopped on an error',
      'A turn was interrupted',
    ]);
  });

  test('a long list of files is cut, the rest counted', () => {
    const files = Array.from({ length: MAX_REVIEW_FILES + 3 }, (_, i) => ({ path: `f${i}.js`, added: 1, removed: 0, approx: false, deleted: false, edits: 1 }));
    const r = /** @type {any} */ ({ id: 'r1', sessionId: SESSION, source: 'claude', start: T0, end: T0 + 1, files, moreFiles: 2, test: null, build: null, shellEdits: 0, flag: null, othersEdited: null, ended: 'done', failures: 0, costUsd: 0.5 });
    const [crew] = reviewQueue({ sessions: [], receipts: [r] }, {});
    assert.equal(crew.files.length, MAX_REVIEW_FILES);
    assert.equal(crew.moreFiles, 5);
    assert.equal(crew.costUsd, 0.5);
    assert.equal(crew.name, SESSION);
    assert.equal(crew.diff, `git diff 'HEAD@{${new Date(T0).toISOString().replace('.000Z', 'Z')}}'`, 'no folder known: no -C');
  });
});

describe('commands to copy', () => {
  test('shell words are quoted only when they need it, and a quote inside survives', () => {
    assert.equal(shellQuote('/home/dev/code/api'), '/home/dev/code/api');
    assert.equal(shellQuote('/home/dev/my code'), "'/home/dev/my code'");
    assert.equal(shellQuote("/tmp/it's"), "'/tmp/it'\\''s'");
    assert.equal(shellQuote('$(rm -rf ~)'), "'$(rm -rf ~)'");
    assert.equal(shellQuote(''), "''");
  });

  test('the diff command reads git\'s reflog at a UTC time', () => {
    assert.equal(diffCommand('/w/a b', Date.UTC(2026, 10, 23, 9, 5, 7, 900)), "git -C '/w/a b' diff 'HEAD@{2026-11-23T09:05:07Z}'");
  });

  test('resume: Claude Code and Codex, in the crew\'s folder', () => {
    assert.equal(resumeCommand({ id: SESSION, cwd: CWD, source: 'claude' }), `cd ${CWD} && claude --resume ${SESSION}`);
    assert.equal(resumeCommand({ id: 'abc', cwd: '/w/my app', source: 'codex' }), "cd '/w/my app' && codex resume abc");
    assert.equal(resumeCommand({ id: 'abc', cwd: '', source: undefined }), 'claude --resume abc');
    assert.equal(resumeCommand({ id: 'unknown', cwd: CWD, source: 'claude' }), null);
    assert.equal(resumeCommand({ id: 'a;b', cwd: CWD, source: 'claude' }), `cd ${CWD} && claude --resume 'a;b'`);
  });

  test('inline code survives backquotes', () => {
    assert.equal(codeSpan('npm test'), '`npm test`');
    assert.equal(codeSpan('a `b` c'), '``a `b` c``');
    assert.equal(codeSpan('`x`'), '`` `x` ``');
  });
});

describe('handoff Markdown', () => {
  test('goal, folder, resume, files, tests, warnings, to-dos and the last words, from the store', () => {
    const { send, state } = setup();
    send(hook('UserPromptSubmit', { prompt: 'Fix the login bug' }));
    send(hook('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Find the bug', status: 'completed' }, { content: 'Add a test', status: 'in_progress' }] }, tool_use_id: 't1', tool_response: {} }));
    send(edit('e1'));
    send(FIXTURES.Stop);
    const session = state().sessions[0];
    const md = handoffMarkdown({ session, receipts: [...state().receipts], warnings: ['Said done, but no test ran this turn after the edits'] });
    assert.match(md, /^# Handoff: api-server\n/);
    assert.match(md, new RegExp(`- Agent: Claude Code, session \`${SESSION}\``));
    assert.match(md, new RegExp(`- Resume: \`cd ${CWD} && claude --resume ${SESSION}\``));
    assert.match(md, /## Goal\n\nFix the login bug\n/);
    assert.match(md, /## Files touched\n\n- `src\/auth.ts` \(\+2 −1\)\n/);
    assert.match(md, /## Tests\n\nNo test or build run seen\.\n/);
    assert.match(md, /## Open warnings\n\n- Said done, but no test ran this turn after the edits\n/);
    assert.match(md, /## To-dos\n\n- \[x\] Find the bug\n- \[ \] Add a test \(in progress\)\n/);
    assert.match(md, /## Last messages\n\n- 2023-11-14 22:13 UTC \(\ds turn\): All done\.\n$/);
  });

  test('nothing finished yet: says so, and quotes the lead\'s last message when there is one', () => {
    const session = /** @type {any} */ ({ id: 's1', project: 'web', cwd: '/w', source: 'codex', todos: [], tasks: [] });
    const md = handoffMarkdown({ session, receipts: [], warnings: [], lastMessage: 'Looking at it.' });
    assert.match(md, /- Agent: Codex, session `s1`/);
    assert.match(md, /- Resume: `cd \/w && codex resume s1`/);
    assert.match(md, /\(no prompt seen by the town\)/);
    assert.match(md, /No file changes seen\./);
    assert.match(md, /## Open warnings\n\nNone\./);
    assert.doesNotMatch(md, /## To-dos/);
    assert.match(md, /## Last messages\n\n- Looking at it\.\n$/);
  });
});

describe('standup Markdown', () => {
  test('one section per crew, then the quiet ones', () => {
    const md = standupMarkdown({
      title: 'Standup: Monday',
      period: 'Today, since midnight.',
      crews: [
        { name: 'web-app', words: '', said: null, need: 'Asks: Which port?', costUsd: null },
        { name: 'api-server', words: '3 turns, tests passing', said: 'Fixed it.', need: null, costUsd: 1.234 },
      ],
      quiet: ['docs-site'],
    });
    assert.equal(md, [
      '# Standup: Monday', '', 'Today, since midnight.', '',
      '## web-app', '', '- Nothing new', '- Needs you: Asks: Which port?', '',
      '## api-server', '', '- 3 turns, tests passing', '- Last turn: Fixed it.', '- Cost so far: $1.23 (estimate)', '',
      'Quiet: docs-site.', '',
    ].join('\n'));
  });

  test('no crew did anything', () => {
    assert.match(standupMarkdown({ title: 'T', period: 'P', crews: [], quiet: [] }), /No crew did anything in that time\.\n$/);
  });
});
