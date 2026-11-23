// Each crew's branch and working tree in the browser (core/git-status.js): read defensively, matched
// to its crew (the stamped work tree, else the deepest repository holding its folder), and put in
// words; and the store keeping them.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { branchWords, dirtyCount, gitOf, gitSentence, gitShort, readGitStatus } from '../../../public/js/core/git-status.js';
import { createStore } from '../../../public/js/core/store.js';
import { CWD, FIXTURES, envelope, hook } from './helpers.mjs';

/** @param {Record<string, any>} [over] */
const status = (over = {}) => /** @type {import('../../../public/js/core/git-status.js').GitStatus} */ (readGitStatus({ root: '/w/app', branch: 'feat/login', oid: 'abcdef1234', upstream: 'origin/feat/login', ahead: 2, behind: 0, changed: 4, untracked: 1, worktree: null, at: 5, ...over }));

describe('git status in the browser', () => {
  test('read defensively: a root is required, numbers are counts, names are cut', () => {
    assert.equal(readGitStatus(null), null);
    assert.equal(readGitStatus({ branch: 'main' }), null);
    const read = readGitStatus({ root: 'C:\\w\\app', branch: 'x'.repeat(300), oid: '<script>', ahead: -3, behind: 'many', changed: 2.7, untracked: null });
    assert.deepEqual({ ...read, branch: read?.branch?.length }, { root: 'C:/w/app', branch: 200, oid: null, upstream: null, ahead: 0, behind: 0, changed: 2, untracked: null, worktree: null, at: 0 });
  });

  test("a crew's repository: the stamped work tree, else the deepest one holding its folder", () => {
    const repos = { '/w': status({ root: '/w', branch: 'outer' }), '/w/app': status(), '/w/app/vendor/lib': status({ root: '/w/app/vendor/lib', branch: 'lib' }) };
    assert.equal(gitOf(repos, { cwd: '/w/app/src' })?.branch, 'feat/login');
    assert.equal(gitOf(repos, { cwd: '/w/app/src', root: '/w' })?.branch, 'outer');
    assert.equal(gitOf(repos, { cwd: '/elsewhere' }), null);
    assert.equal(gitOf({}, { cwd: '/w/app' }), null);
  });

  test('in a few words, and in a sentence', () => {
    assert.equal(gitShort(status()), 'feat/login ↑2 · 5 changed');
    assert.equal(gitShort(status({ ahead: 0, behind: 3, changed: 0, untracked: 0 })), 'feat/login ↓3 · clean');
    assert.equal(gitShort(status({ worktree: 'b-git', changed: 0, untracked: null })), 'b-git: feat/login ↑2 · no changes to tracked files');
    assert.equal(gitShort(status({ branch: null, ahead: 0, changed: 1, untracked: 0 })), 'detached at abcdef1 · 1 changed');
    assert.equal(gitSentence(status()), 'On feat/login. 2 commits ahead of origin/feat/login. 4 changed files, 1 new file.');
    assert.equal(gitSentence(status({ worktree: 'b-git', ahead: 1, behind: 2, changed: 0, untracked: 0 })), 'On feat/login, a worktree (b-git). 1 commit ahead of origin/feat/login, 2 behind. No uncommitted changes.');
    assert.equal(gitSentence(status({ upstream: null, ahead: 0, changed: 1, untracked: null })), 'On feat/login. No upstream branch. 1 changed file (new files not counted: a large working tree).');
    assert.equal(gitSentence(status({ ahead: 0, changed: 0, untracked: 0 })), 'On feat/login. Up to date with origin/feat/login. No uncommitted changes.');
    assert.equal(gitSentence(status({ branch: null, upstream: null, ahead: 0, changed: 0, untracked: 0 })), 'Detached at abcdef1. No uncommitted changes.');
    assert.equal(branchWords(status({ branch: null, oid: null })), 'detached');
    assert.equal(dirtyCount(status({ untracked: null })), 4);
  });

  test('the store keeps each repository by root, and each crew the work tree its tool hooks name', () => {
    const store = createStore({ localHour: () => 12 });
    /** @type {string[]} */
    const changes = [];
    store.subscribe((change) => changes.push(change.type));
    store.ingest(envelope(FIXTURES.SessionStart, 1));
    store.ingest(envelope(hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'b1', tool_response: {}, andary_root: '/home/dev/code' }), 2));
    store.setGit({ root: '/home/dev/code', branch: 'main' });
    store.setGit({ nonsense: true });
    const state = store.getState();
    assert.equal(state.sessions[0].root, '/home/dev/code');
    assert.equal(gitOf(state.git, state.sessions[0])?.branch, 'main');
    assert.deepEqual(changes.filter((type) => type === 'git'), ['git']);
    assert.equal(state.sessions[0].cwd, CWD);
  });
});
