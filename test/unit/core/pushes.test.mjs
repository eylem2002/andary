// "Pushed while the last test run failed" (core/pushes.js), fed through the store with real hook
// shapes: a crew's latest test run (the lead's or a helper's) and a push that went through; the
// warning in the activity log and in "needs you" until set aside, pushed over or the crew leaves.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { attentionItems } from '../../../public/js/core/attention.js';
import { FIXTURES, SESSION, envelope, hook } from './helpers.mjs';

const T0 = 1_700_000_000_000;

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
  return { store, send, red: () => store.getState().redPushes, now: () => t };
}

/** @param {string} command @param {string} id @param {any} [response] @param {any} [who] */
const ok = (command, id, response = { stdout: '', stderr: '' }, who = undefined) => [
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id }, who),
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, tool_response: response }, who),
];
/** @param {string} command @param {string} id @param {any} [who] */
const fails = (command, id, who = undefined) => [
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id }, who),
  hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, error: 'Exit code 1\nFAIL test/login.test.ts', is_interrupt: false }, who),
];

describe('pushed while the last test run failed', () => {
  test('a push after a failed run: a warning in the log and in "needs you", counted and dismissable', () => {
    const { store, send, red, now } = setup();
    send(FIXTURES.SessionStart);
    send(FIXTURES.UserPromptSubmit);
    send(fails('npm test', 't1'));
    send(ok('git push origin main', 'p1'));
    assert.equal(red().length, 1);
    assert.deepEqual([red()[0].sessionId, red()[0].test, red()[0].push], [SESSION, 'npm test', 'git push origin main']);
    const line = store.getState().log.findLast((entry) => entry.kind === 'pushed');
    assert.deepEqual([line?.level, line?.text], ['warn', 'Pushed while the last test run failed (npm test)']);
    const items = attentionItems(store.getState(), now()).filter((item) => item.kind === 'pushed');
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].level, items[0].counted, items[0].dismissable, items[0].text], ['alert', true, true, 'Pushed while the last test run failed: npm test']);
    assert.equal(attentionItems(store.getState(), now(), { dismissed: new Set([items[0].id]) }).filter((item) => item.kind === 'pushed').length, 0, 'set aside');
  });

  test('no warning: tests passed, never ran, or the push did not go through or sent nothing', () => {
    const passed = setup();
    passed.send(ok('npm test', 't1'));
    passed.send(ok('git push', 'p1'));
    assert.equal(passed.red().length, 0);

    const never = setup();
    never.send(ok('git push', 'p1'));
    assert.equal(never.red().length, 0);

    const rejected = setup();
    rejected.send(fails('npm test', 't1'));
    rejected.send(fails('git push', 'p1'));
    rejected.send(ok('git push --dry-run', 'p2'));
    rejected.send(ok('git push origin --delete old', 'p3'));
    rejected.send(ok('git push', 'p4', { stdout: '', stderr: 'Everything up-to-date' }));
    assert.equal(rejected.red().length, 0);

    // The same line: a test run that must pass before the push.
    const chained = setup();
    chained.send(fails('npm test', 't1'));
    chained.send(ok('npm test && git push', 't2'));
    assert.equal(chained.red().length, 0);
  });

  test("a helper's failed run counts for its crew; a push after a passing run clears the warning", () => {
    const { send, red } = setup();
    const helper = { agent: { id: 'a1b2c3', type: 'general-purpose' } };
    send(FIXTURES.UserPromptSubmit);
    send(hook('SubagentStart', { agent_id: 'a1b2c3', agent_type: 'general-purpose' }));
    send(fails('pytest -q', 't1', helper));
    send(ok('git push', 'p1'));
    assert.equal(red().length, 1);
    assert.equal(red()[0].test, 'pytest -q');
    send(ok('pytest -q', 't2'));
    assert.equal(red().length, 1, 'a passing run alone does not undo the push');
    send(ok('git push', 'p2'));
    assert.equal(red().length, 0);
  });

  test("the crew leaving ends it; a teammate's crew is not followed", () => {
    const { send, red } = setup();
    send(fails('npm test', 't1'));
    send(ok('git push', 'p1'));
    assert.equal(red().length, 1);
    send(FIXTURES.SessionEnd);
    assert.equal(red().length, 0);

    const team = setup();
    const theirs = { andary_member: 'Sam', session_id: 'Sam~x' };
    team.send(fails('npm test', 't1').map((p) => ({ ...p, ...theirs })));
    team.send(ok('git push', 'p1').map((p) => ({ ...p, ...theirs })));
    assert.equal(team.red().length, 0);
  });

  test('a test result that proves nothing is not a failure', () => {
    const { send, red } = setup();
    send(fails('npm test | tail -5', 't1'));
    send(ok('git push', 'p1'));
    assert.equal(red().length, 0);
  });
});
