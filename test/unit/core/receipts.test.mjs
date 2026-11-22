// Turn receipts (core/receipts.js), fed through the store with real Claude Code and Codex hook
// shapes: files and lines, the last test and build with what their exit status proves, the test
// after the last edit, failures, helpers, duration and cost; never more than the hooks prove.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { durationWords, fileLines, lineDelta, receiptLine, receiptRows } from '../../../public/js/core/receipts.js';
import { fromCodex } from '../../../server/adapters/codex.mjs';
import { PATCH, codex } from '../server/adapters/fixtures.mjs';
import { CWD, FIXTURES, SESSION, envelope, hook } from './helpers.mjs';

const T0 = 1_700_000_000_000;

function setup() {
  let t = T0;
  const store = createStore({ localHour: () => 12, now: () => t });
  /** @param {Record<string, any>|Record<string, any>[]} payloads @param {number} [step] */
  const send = (payloads, step = 1000) => {
    for (const payload of [payloads].flat()) {
      t += step;
      store.ingest(envelope(payload, t));
    }
  };
  const receipts = () => store.getState().receipts;
  const last = () => receipts().at(-1);
  return { store, send, receipts, last, now: () => t };
}

/** A call that started and finished. @param {string} tool @param {Record<string, any>} input @param {string} id @param {any} [response] @param {any} [who] */
const call = (tool, input, id, response = {}, who = undefined) => [
  hook('PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id }, who),
  hook('PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, tool_response: response }, who),
];
/** @param {string} command @param {string} id @param {string} [error] */
const failing = (command, id, error = 'Exit code 1\nFAIL test/login.test.ts') => [
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id }),
  hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, error, is_interrupt: false }),
];
const edit = (/** @type {string} */ id, file = 'src/auth.ts') => call('Edit', { file_path: `${CWD}/${file}`, old_string: 'const a = 1;\nconst b = 2;\nreturn a;', new_string: 'const a = 1;\nconst b = 3;\nconst c = 4;\nreturn a;' }, id);
const test_ = (/** @type {string} */ command, /** @type {string} */ id) => call('Bash', { command }, id, { stdout: 'ok', stderr: '', interrupted: false });

describe('receipts: what a turn did', () => {
  test('files with lines, the tests after the last edit, the duration: nothing to flag', () => {
    const { send, last, receipts } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(edit('e1'));
    send(edit('e2', 'src/login.ts'));
    send(test_('npm test', 'b1'));
    send(FIXTURES.Stop);
    assert.equal(receipts().length, 1);
    const r = /** @type {any} */ (last());
    assert.deepEqual(r.files.map((/** @type {any} */ f) => [f.path, f.added, f.removed]), [['src/login.ts', 2, 1], ['src/auth.ts', 2, 1]]);
    assert.deepEqual([r.test.result, r.test.command, r.testedAfterEdit, r.flag, r.ended, r.said, r.sawStart], ['passed', 'npm test', true, null, 'done', 'All done.', true]);
    assert.equal(r.end - r.start, 7000);
    assert.equal(receiptLine(r), 'Turn receipt: 2 files changed (+4 −2), tests passed, 7s');
  });

  test('said done, but the tests were not re-run since the last edit', () => {
    const { send, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(test_('npm test', 'b1'));
    send(edit('e1'));
    send(FIXTURES.Stop);
    assert.equal(last()?.testedAfterEdit, false);
    assert.equal(last()?.flag, 'Said done, but tests were not re-run since the last edit');
  });

  test('edits and no test at all; a build is no test', () => {
    const { send, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(edit('e1'));
    send(test_('npm run build', 'b1'));
    send(FIXTURES.Stop);
    assert.equal(last()?.flag, 'Said done, but no test ran this turn after the edits');
    assert.deepEqual([last()?.build?.result, last()?.test], ['passed', null]);
  });

  test('a turn that changed nothing has nothing to flag', () => {
    const { send, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(call('Read', { file_path: `${CWD}/a.ts` }, 'r'));
    send(FIXTURES.Stop);
    assert.deepEqual([last()?.files, last()?.testedAfterEdit, last()?.flag], [[], null, null]);
  });

  test('a test result is only what the exit status proves (core/shell.js)', () => {
    /** @type {[Record<string, any>[], string, string|null][]} */
    const table = [
      [test_('npm test 2>&1 | tail -20', 'b'), 'unproven', "the exit status shown is another command's"],
      [test_('set -o pipefail; npm test 2>&1 | tail -20', 'b'), 'passed', null],
      [failing('npm test', 'b'), 'failed', 'FAIL test/login.test.ts'],
      [failing('npm run build && npm test', 'b'), 'unproven', 'the line failed, maybe not here'],
      [call('Bash', { command: 'npm test', run_in_background: true }, 'b', { backgroundTaskId: 'x' }), 'started', 'it runs in the background'],
      [[hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'b' }), hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'b', error: 'Interrupted', is_interrupt: true })], 'interrupted', null],
    ];
    for (const [events, result, why] of table) {
      const { send, last } = setup();
      send(FIXTURES.UserPromptSubmit);
      send(events);
      send(FIXTURES.Stop);
      assert.deepEqual([last()?.test?.result, last()?.test?.why], [result, why], events[0].tool_input.command);
    }
  });

  test('a test command that runs no tests, or a runner named in an argument, is no test run', () => {
    const { send, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(test_('npx playwright test --list', 'a'));
    send(test_('rg -n vitest package.json', 'b'));
    send(FIXTURES.Stop);
    assert.equal(last()?.test, null);
  });

  test('failed calls, and the helpers that worked in the turn, their files too', () => {
    const helper = { agent: { id: 'agent-a1b2c3', type: 'Explore' } };
    const { send, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(FIXTURES.SubagentStart);
    send(call('Write', { file_path: `${CWD}/notes.md`, content: 'one\ntwo' }, 'w', { type: 'create' }, helper));
    send(failing('ls missing', 'l', 'Exit code 2\nls: missing: No such file'));
    send(FIXTURES.SubagentStop);
    send(FIXTURES.Stop);
    const r = /** @type {any} */ (last());
    assert.deepEqual(r.helpers, ['Scout 1']);
    assert.deepEqual(r.files.map((/** @type {any} */ f) => [f.path, fileLines(f)]), [['notes.md', '+2 −0']]);
    assert.deepEqual([r.failures, r.failed], [1, ['$ ls missing: ls: missing: No such file']]);
  });

  test('a file written whole over an old one: what was removed is unknown', () => {
    const { send, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(call('Write', { file_path: `${CWD}/a.ts`, content: 'x\ny\nz' }, 'w', { type: 'update' }));
    send(FIXTURES.Stop);
    assert.equal(fileLines(/** @type {any} */ (last()?.files[0])), '+3, written whole');
    assert.match(receiptLine(/** @type {any} */ (last())), /^Turn receipt: 1 file changed \(\+3\), 3s\. Said done, but no test ran/);
  });

  test('a Stop hook that kept the turn going updates the same receipt', () => {
    const { send, receipts, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(edit('e1'));
    send(FIXTURES.Stop);
    send(test_('npm test', 'b1'));
    send(hook('Stop', { last_assistant_message: 'Tests pass now.', stop_hook_active: true }));
    assert.equal(receipts().length, 1);
    assert.deepEqual([last()?.said, last()?.test?.result, last()?.flag, last()?.sawStart], ['Tests pass now.', 'passed', null, true]);
  });

  test('a turn the town joined midway says so, and has no cost', () => {
    const { send, store, last } = setup();
    store.setUsage({ sessionId: SESSION, agentId: null, costUsd: 2, tokens: {} });
    send(edit('e1'));
    send(FIXTURES.Stop);
    assert.deepEqual([last()?.sawStart, last()?.costUsd], [false, null]);
    assert.match(receiptLine(/** @type {any} */ (last())), /at least 2s/);
  });

  test('a stopped turn ends in an error; your next prompt starts the next receipt', () => {
    const { send, receipts } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(FIXTURES.StopFailure);
    send(FIXTURES.UserPromptSubmit);
    send(FIXTURES.Stop);
    assert.deepEqual(receipts().map((r) => r.ended), ['error', 'done']);
  });

  test('the activity log has the receipt, linked to it, a warning when there is something to check', () => {
    const { send, store, last } = setup();
    send(FIXTURES.UserPromptSubmit);
    send(edit('e1'));
    send(FIXTURES.Stop);
    const entry = store.getState().log.at(-1);
    assert.deepEqual([entry?.kind, entry?.level, entry?.receiptId], ['receipt', 'warn', last()?.id]);
    assert.match(entry?.text ?? '', /Said done, but no test ran/);
  });
});

describe('receipts: cost, an estimate from Claude Code\'s transcripts', () => {
  test('what the crew spent since your prompt, as the usage catches up after the turn', () => {
    const { send, store, last } = setup();
    store.setUsage({ sessionId: SESSION, agentId: null, costUsd: 1, tokens: {} });
    send(FIXTURES.UserPromptSubmit);
    send(FIXTURES.SubagentStart);
    send(FIXTURES.Stop);
    assert.equal(last()?.costUsd, null, 'nothing counted yet');
    store.setUsage({ sessionId: SESSION, agentId: null, costUsd: 1.3, tokens: {} });
    store.setUsage({ sessionId: SESSION, agentId: 'agent-a1b2c3', costUsd: 0.12, tokens: {} });
    assert.ok(Math.abs((last()?.costUsd ?? 0) - 0.42) < 1e-9);
    assert.deepEqual(receiptRows(/** @type {any} */ (last())).find((row) => row.label === 'Cost')?.text, '$0.42 (estimate)');
    // The next turn has started: what comes now is its own.
    send(FIXTURES.UserPromptSubmit);
    store.setUsage({ sessionId: SESSION, agentId: null, costUsd: 5, tokens: {} });
    assert.ok(Math.abs((store.getState().receipts[0].costUsd ?? 0) - 0.42) < 1e-9);
  });

  test('a fresh session spent nothing before its first prompt; an unpriced model has no cost', () => {
    const { send, store, last } = setup();
    send(FIXTURES.SessionStart);
    send(FIXTURES.UserPromptSubmit);
    send(FIXTURES.Stop);
    store.setUsage({ sessionId: SESSION, agentId: null, costUsd: 0.2, tokens: {} });
    assert.equal(last()?.costUsd, 0.2);
    store.setUsage({ sessionId: SESSION, agentId: null, costUsd: 0.3, tokens: {}, unpriced: true });
    assert.equal(last()?.costUsd, null);
  });
});

describe('receipts: Codex', () => {
  test('a patch over several files, a test run whose exit code Codex reported, an interrupt', () => {
    const { send, last } = setup();
    send(codex('UserPromptSubmit', { prompt: 'Rename it' }));
    send([
      ...fromCodex(codex('PreToolUse', { tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: PATCH } })),
      ...fromCodex(codex('PostToolUse', { tool_name: 'apply_patch', tool_use_id: 'p', tool_input: { command: PATCH }, tool_response: { output: 'Done' } })),
      ...fromCodex(codex('PreToolUse', { tool_name: 'Bash', tool_use_id: 't', tool_input: { command: ['bash', '-lc', 'npm test'] } })),
      ...fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 't', tool_input: { command: ['bash', '-lc', 'npm test'] }, tool_response: { exit_code: 0, stdout: 'ok' } })),
      ...fromCodex(codex('Stop', { last_assistant_message: 'Renamed.' })),
    ]);
    const r = /** @type {any} */ (last());
    assert.deepEqual(r.files.map((/** @type {any} */ f) => [f.path, fileLines(f)]), [['src/gone.ts', 'deleted'], ['src/new-name.ts', '+1 −1'], ['src/app.ts', '+2 −2'], ['src/new.ts', '+2 −0']]);
    assert.deepEqual([r.source, r.test.result, r.testedAfterEdit, r.flag, r.costUsd], ['codex', 'passed', true, null, null]);
    send(fromCodex(codex('Interrupt')));
    assert.equal(last()?.ended, 'interrupted');
  });

  test('a Codex command without its exit code proves nothing; a non-zero one failed', () => {
    for (const [response, result] of [[ 'plain text', 'unproven'], [{ exit_code: 1, stderr: '2 tests failed' }, 'failed']]) {
      const { send, last } = setup();
      send(codex('UserPromptSubmit', { prompt: 'Test it' }));
      send([
        ...fromCodex(codex('PreToolUse', { tool_name: 'Bash', tool_use_id: 't', tool_input: { command: ['npm', 'test'] } })),
        ...fromCodex(codex('PostToolUse', { tool_name: 'Bash', tool_use_id: 't', tool_input: { command: ['npm', 'test'] }, tool_response: response })),
        ...fromCodex(codex('Stop', { last_assistant_message: 'Done.' })),
      ]);
      assert.equal(last()?.test?.result, result);
    }
  });
});

describe('receipts: words', () => {
  test('lines added and removed leave out what both texts share', () => {
    assert.deepEqual(lineDelta('a\nb\nc', 'a\nB\nc'), { added: 1, removed: 1 });
    assert.deepEqual(lineDelta('', 'x\ny'), { added: 2, removed: 0 });
    assert.deepEqual(lineDelta('x', ''), { added: 0, removed: 1 });
    assert.deepEqual(lineDelta('same', 'same'), { added: 0, removed: 0 });
  });

  test('durations', () => {
    assert.deepEqual([durationWords(35_000), durationWords(250_000), durationWords(3_900_000)], ['35s', '4m 10s', '1h 05m']);
  });
});
