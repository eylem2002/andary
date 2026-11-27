// The "Where" section of the agent's details (ui/agent-where.js): the crew's folder, its branch in
// words, the model, and the session id its own agent knows.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createStore } from '../../../public/js/core/store.js';
import { modelWords, ownSessionId, whereRows } from '../../../public/js/ui/agent-where.js';
import { CWD, FIXTURES, envelope } from '../core/helpers.mjs';

describe("an agent's Where", () => {
  test('folder, branch and model, as rows', () => {
    const store = createStore({ localHour: () => 12 });
    store.ingest(envelope(FIXTURES.SessionStart, 1));
    store.setGit({ root: CWD, branch: 'feat/login', upstream: 'origin/feat/login', ahead: 1, changed: 2, untracked: 0 });
    const state = store.getState();
    const session = state.sessions[0];
    const lead = state.agents[session.agentKeys[0]];
    assert.deepEqual(whereRows(state, lead, session), [
      { label: 'Folder', text: CWD, mono: true },
      { label: 'Branch', text: 'On feat/login. 1 commit ahead of origin/feat/login. 2 changed files.', mono: false },
      { label: 'Model', text: 'Opus 5.5 (claude-opus-5-5)', mono: false },
    ]);
    // A teammate's crew: their folder is on their computer, so no branch from this one.
    assert.deepEqual(whereRows(state, lead, { ...session, member: 'Sam' }).map((row) => row.label), ['Folder', 'Model']);
  });

  test('the session id its own agent knows, and a model with no shorter name', () => {
    assert.equal(ownSessionId(/** @type {any} */ ({ id: 'Sam~abc-123', member: 'Sam' })), 'abc-123');
    assert.equal(ownSessionId(/** @type {any} */ ({ id: 'abc-123', member: null })), 'abc-123');
    assert.equal(modelWords('gpt-5.3-codex'), 'GPT-5.3 Codex (gpt-5.3-codex)');
    assert.equal(modelWords('my-local-model'), 'my-local-model');
    assert.equal(modelWords(undefined), '');
  });
});
