// Open dialogs (core/dialogs.js): the one model of "an agent asked you and has had no answer",
// shared by the phone notes and the town. Each rule here is a way a needed note or a waiting agent
// could otherwise be lost.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDialogs, inputKey } from '../../../public/js/core/dialogs.js';

const S = 'session-1';
const lead = (/** @type {string[]} */ tools, /** @type {unknown} */ input = {}) => ({ sessionId: S, agentId: null, tools, input: inputKey(input) });
const helper = (/** @type {string[]} */ tools, /** @type {unknown} */ input = {}) => ({ sessionId: S, agentId: 'h1', tools, input: inputKey(input) });
const kinds = (/** @type {ReturnType<typeof createDialogs>} */ d) => d.list().map((x) => `${x.agentId ?? 'lead'}:${x.kind}:${x.tools.join('/')}`);

describe('createDialogs', () => {
  test('a request closes on its own result, not on a parallel call with another input', () => {
    const d = createDialogs();
    d.ask(lead(['Bash'], { command: 'rm -rf build' }), 1);
    assert.deepEqual(d.result(lead(['Bash'], { command: 'ls' })), [], 'a parallel ls proves nothing');
    assert.equal(d.list().length, 1);
    assert.equal(d.result(lead(['Bash'], { command: 'rm -rf build' })).length, 1);
    assert.deepEqual(d.list(), []);
  });

  test('parallel requests from one agent each stay open until their own answer', () => {
    const d = createDialogs();
    d.ask(lead(['Read'], { file_path: '../a' }), 1);
    d.ask(lead(['Read'], { file_path: '../b' }), 2);
    assert.equal(d.list().length, 2, 'a new request is no proof the old one was answered');
    d.result(lead(['Read'], { file_path: '../b' }));
    assert.deepEqual(d.list().map((x) => x.at), [1]);
  });

  test('a question or a plan is one dialog, answered by its result whatever its input became', () => {
    const d = createDialogs();
    d.ask(lead(['AskUserQuestion'], { questions: [{ question: 'Which port?' }] }), 1, 'Asks: Which port?');
    // Claude Code sends a permission request for it too: it joins the question.
    const again = d.ask(lead(['AskUserQuestion'], { questions: [{ question: 'Which port?' }] }), 2);
    assert.equal(again.opened, false);
    assert.deepEqual(kinds(d), ['lead:question:AskUserQuestion']);
    assert.equal(d.list()[0].text, 'Asks: Which port?');
    d.result(lead(['AskUserQuestion'], { questions: [{ question: 'Which port?' }], answers: { 'Which port?': '8080' } }));
    assert.deepEqual(d.list(), []);
    d.ask(helper(['ExitPlanMode'], { plan: 'x' }), 3);
    assert.deepEqual(kinds(d), ['h1:plan:ExitPlanMode']);
  });

  test("a session's notice counts only when nothing of that session is known to be open", () => {
    const d = createDialogs();
    d.ask(helper(['Bash'], { command: 'npm run lint -- --fix' }), 1);
    assert.equal(d.notice(S, 2), null, "the helper's dialog is the one showing: no second item");
    d.result(helper(['Bash'], { command: 'npm run lint -- --fix' }));
    const notice = d.notice(S, 3, 'Claude needs your permission to use Bash');
    assert.equal(notice?.kind, 'unknown');
    assert.deepEqual(d.result(lead(['Read'], { file_path: 'x' })), [], 'any tool result is no proof for a dialog we cannot name');
    assert.equal(d.prompted(S).length, 1, 'your prompt is');
  });

  test("your prompt answers the lead's dialogs, never a helper's held in the town", () => {
    const d = createDialogs();
    d.ask(helper(['WebFetch'], { url: 'https://x' }), 1);
    d.ask(lead(['Bash'], { command: 'npm publish' }), 2);
    assert.deepEqual(d.prompted(S).map((x) => x.agentId), [null]);
    assert.deepEqual(kinds(d), ['h1:permission:WebFetch']);
  });

  test("an agent's turn ending closes its own dialogs; the session ending closes all", () => {
    const d = createDialogs();
    d.ask(helper(['WebFetch']), 1);
    d.notice('other', 2);
    d.ask(lead(['Bash']), 3);
    assert.deepEqual(d.stopped(S, 'h1').map((x) => x.agentId), ['h1']);
    assert.equal(d.stopped('other', null).length, 1, "the lead's Stop takes the session's notice");
    assert.equal(d.closeSession(S).length, 1);
    assert.deepEqual(d.list(), []);
  });

  test("the town's request links to its own dialog, and only its decision closes it", () => {
    const d = createDialogs();
    d.ask(lead(['Bash'], { command: 'cat a' }), 1);
    d.ask(lead(['Bash'], { command: 'cat b' }), 2);
    assert.equal(d.link(lead(['Bash'], { command: 'cat a' }), 'A')?.at, 1);
    assert.equal(d.link({ ...lead(['Bash']), input: null }, 'B')?.at, 2, 'without an input: the newest dialog with no request yet');
    assert.equal(d.link(lead(['Bash'], { command: 'cat a' }), 'A')?.at, 1, 'linking again changes nothing');
    assert.equal(d.link(lead(['Bash'], { command: 'cat c' }), 'C'), null, 'another input: not this dialog');
    assert.deepEqual(d.decided('B').map((x) => x.at), [2]);
    assert.deepEqual(d.decided('B'), []);
    assert.deepEqual(d.list().map((x) => x.approvalId), ['A']);
  });

  test('kept bounded: the oldest give way', () => {
    const d = createDialogs({ max: 3 });
    for (let i = 1; i <= 5; i += 1) d.ask(lead(['Bash'], { command: `run ${i}` }), i);
    assert.deepEqual(d.list().map((x) => x.at), [3, 4, 5]);
    assert.equal(d.has(1), false);
    assert.equal(d.forget(d.list()[0].id).length, 1);
  });
});

describe('inputKey', () => {
  test('equal inputs give equal keys; a command as a list reads as the same line', () => {
    assert.equal(inputKey({ command: 'npm test' }), inputKey({ command: 'npm test' }));
    assert.equal(inputKey({ command: ['rm', 'a b'] }), inputKey({ command: "rm 'a b'" }));
    assert.notEqual(inputKey({ command: ['rm', 'a b'] }), inputKey({ command: 'rm a b' }));
    assert.notEqual(inputKey({ command: 'npm test' }), inputKey({ command: 'npm test ' }));
    assert.equal(inputKey(undefined), inputKey(null));
  });
});
