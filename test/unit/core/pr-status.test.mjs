import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { badgeText, ciEpisode, ciText, gitFolder, isSettled, prLogDraft, prOfSession, pushSites, readGhView, readPrStatus, summarizeChecks } from '../../../public/js/core/pr-status.js';

const run = (/** @type {string} */ name, /** @type {string} */ conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, status, conclusion });
const context = (/** @type {string} */ name, /** @type {string} */ state) => ({ __typename: 'StatusContext', context: name, state });

/** `gh pr view --json …` as gh prints it. @param {Record<string, unknown>} [extra] */
function ghView(extra = {}) {
  return { number: 123, url: 'https://github.com/acme/app/pull/123', state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', headRefName: 'feat/login', headRefOid: 'abc123', statusCheckRollup: [run('test', 'SUCCESS')], ...extra };
}

const where = { root: '/w/app', sessionIds: ['s1'], at: 1000 };

describe('summarizeChecks', () => {
  it('sums check runs and commit statuses: failing as soon as one failed, even while others run', () => {
    assert.deepEqual(summarizeChecks([run('test', 'SUCCESS'), run('lint', 'FAILURE'), run('build', '', 'IN_PROGRESS'), context('ci/circle', 'ERROR')]),
      { state: 'failing', total: 4, failing: 2, pending: 1, failed: ['lint', 'ci/circle'] });
    assert.equal(summarizeChecks([run('test', 'SUCCESS'), run('e2e', '', 'QUEUED'), context('deploy', 'PENDING')]).state, 'pending');
    assert.equal(summarizeChecks([run('test', 'SUCCESS'), context('deploy', 'SUCCESS')]).state, 'passing');
    assert.equal(summarizeChecks([]).state, 'none');
    assert.equal(summarizeChecks(null).state, 'none');
  });

  it('neutral, skipped, cancelled and stale runs are no failure; timeouts and startup failures are', () => {
    assert.equal(summarizeChecks(['NEUTRAL', 'SKIPPED', 'CANCELLED', 'STALE'].map((c) => run(c, c))).state, 'passing');
    assert.equal(summarizeChecks(['TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].map((c) => run(c, c))).failing, 3);
  });

  it('keeps the first three failed names, on one line', () => {
    const checks = summarizeChecks(['a', 'b\nc', 'd', 'e'].map((name) => run(name, 'FAILURE')));
    assert.deepEqual([checks.failing, checks.failed], [4, ['a', 'b c', 'd']]);
  });
});

describe('readGhView', () => {
  it('reads what gh printed into a status, and nothing it did not ask for', () => {
    const pr = readGhView(ghView({ body: 'secret' }), where);
    assert.deepEqual(pr, {
      root: '/w/app', sessionIds: ['s1'], number: 123, url: 'https://github.com/acme/app/pull/123', state: 'OPEN', review: 'REVIEW_REQUIRED',
      branch: 'feat/login', sha: 'abc123', checks: { state: 'passing', total: 1, failing: 0, pending: 0, failed: [] }, at: 1000, failingSince: null, watching: true,
    });
  });

  it('takes only an https link, and no pull request at all from an empty answer', () => {
    assert.equal(readGhView(ghView({ url: 'javascript:alert(1)' }), where).url, null);
    assert.equal(readGhView(ghView({ url: 'http://github.com/x' }), where).url, null);
    assert.equal(readGhView(ghView({ url: 'https://evil.example/acme/app/pull/123' }), where).url, null, 'github.com only, by default');
    assert.equal(readGhView(ghView({ url: 'https://ghe.corp/acme/app/pull/123' }), { ...where, hosts: ['github.com', 'ghe.corp'] }).url, 'https://ghe.corp/acme/app/pull/123');
    for (const url of ['https://github.com/a"onmouseover=x', 'https://github.com/<b>', 'https://user:pw@github.com/x', 'https://github.com/a b', 'https://github.com\\@evil.example/']) {
      assert.equal(readGhView(ghView({ url }), where).url, null, url);
    }
    const none = readGhView({}, where);
    assert.deepEqual([none.number, none.url, none.checks.state], [null, null, 'none']);
  });

  it('remembers when CI started failing on the same head commit; a new commit starts again', () => {
    const failing = ghView({ statusCheckRollup: [run('test', 'FAILURE')] });
    const first = readGhView(failing, where);
    assert.equal(first.failingSince, 1000);
    const again = readGhView(failing, { ...where, at: 5000, previous: first });
    assert.equal(again.failingSince, 1000);
    const pushed = readGhView({ ...failing, headRefOid: 'def456' }, { ...where, at: 9000, previous: again });
    assert.equal(pushed.failingSince, 9000);
    assert.notEqual(ciEpisode(pushed), ciEpisode(again));
    assert.equal(readGhView(ghView(), { ...where, previous: again }).failingSince, null);
  });
});

describe('isSettled', () => {
  it('waits while checks run; stops once they finished, or the pull request is merged or closed', () => {
    const view = (/** @type {Record<string, unknown>} */ extra) => readGhView(ghView(extra), where);
    assert.equal(isSettled(view({ statusCheckRollup: [run('t', '', 'IN_PROGRESS')] }), 1), false);
    assert.equal(isSettled(view({ statusCheckRollup: [run('t', 'FAILURE')] }), 1), true);
    // Passed: only on two looks in a row at the same head commit, so a check that starts late is not missed.
    assert.equal(isSettled(view({}), 1), false);
    assert.equal(isSettled(view({}), 2, view({})), true);
    assert.equal(isSettled(view({}), 2, view({ statusCheckRollup: [run('t', '', 'QUEUED')] })), false);
    assert.equal(isSettled(view({}), 2, view({ headRefOid: 'older' })), false);
    assert.equal(isSettled(view({ state: 'MERGED', statusCheckRollup: [run('t', '', 'QUEUED')] }), 1), true);
    // No checks yet: they may not have started; after a few answers, there are none.
    assert.equal(isSettled(view({ statusCheckRollup: [] }), 1), false);
    assert.equal(isSettled(view({ statusCheckRollup: [] }), 3), true);
    assert.equal(isSettled(readGhView({}, where), 5), false, 'no pull request yet: one may still be opened');
  });
});

describe('readPrStatus', () => {
  it('reads a status that crossed the network defensively', () => {
    assert.equal(readPrStatus(null), null);
    assert.equal(readPrStatus({ root: '' }), null);
    const pr = readPrStatus({ root: '/w', number: -1, url: 'ftp://x', state: 'WEIRD', review: 'x', checks: { state: 'odd', total: -3, failed: [1, 'lint'] }, at: 'now', sessionIds: ['a', 2] });
    assert.deepEqual(pr, { root: '/w', sessionIds: ['a'], number: null, url: null, state: null, review: null, branch: '', sha: '', checks: { state: 'none', total: 0, failing: 0, pending: 0, failed: ['lint'] }, at: 0, failingSince: null, watching: false });
    const round = readGhView(ghView({ statusCheckRollup: [run('lint', 'FAILURE')] }), where);
    assert.deepEqual(readPrStatus(JSON.parse(JSON.stringify(round))), round);
  });
});

describe('words', () => {
  it('a badge for the crew row, and a line for "need you" that names the branch and the checks', () => {
    const failing = readGhView(ghView({ reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: ['test', 'lint', 'e2e', 'build'].map((n) => run(n, 'FAILURE')) }), where);
    assert.equal(badgeText(failing), 'PR #123 · CI failing (4) · changes requested');
    assert.equal(ciText(failing), 'CI failed on feat/login (PR #123): test, lint, e2e…');
    assert.equal(badgeText(readGhView(ghView({ statusCheckRollup: [run('t', '', 'QUEUED')] }), where)), 'PR #123 · CI running');
    assert.equal(badgeText(readGhView(ghView({ state: 'MERGED', reviewDecision: 'APPROVED' }), where)), 'PR #123 · CI passed · merged');
    assert.equal(badgeText(readGhView({}, where)), '');
  });

  it('logs a pull request found, CI failing, passing again and a merge; not the same news twice', () => {
    const pending = readGhView(ghView({ statusCheckRollup: [run('t', '', 'QUEUED')] }), where);
    const failing = readGhView(ghView({ statusCheckRollup: [run('t', 'FAILURE')] }), where);
    const passing = readGhView(ghView(), where);
    assert.deepEqual(prLogDraft(null, pending), { icon: '🔀', text: 'PR #123 (feat/login): CI running', level: 'info' });
    assert.equal(prLogDraft(pending, pending), null);
    assert.equal(prLogDraft(pending, failing)?.level, 'warn');
    assert.equal(prLogDraft(failing, failing), null);
    assert.deepEqual(prLogDraft(failing, passing), { icon: '✅', text: 'CI passed on PR #123 (feat/login)', level: 'success' });
    assert.equal(prLogDraft(passing, readGhView(ghView({ state: 'MERGED' }), where))?.text, 'PR #123 (feat/login) merged');
    assert.equal(prLogDraft(null, readGhView({}, where)), null);
  });
});

describe('prOfSession', () => {
  it("is the newest pull request the crew pushed to, never one without a number", () => {
    const old = { ...readGhView(ghView(), where), root: '/w/a', at: 1 };
    const newer = { ...readGhView(ghView({ number: 7 }), { ...where, sessionIds: ['s2', 's1'] }), root: '/w/b', at: 2 };
    const none = { ...readGhView({}, where), root: '/w/c', at: 3 };
    assert.equal(prOfSession([old, newer, none], 's1'), newer);
    assert.equal(prOfSession([old, newer, none], 's2'), newer);
    assert.equal(prOfSession([old, newer, none], 's3'), null);
  });
});

describe('pushSites', () => {
  const ran = (/** @type {string} */ command, /** @type {Record<string, unknown>} */ extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: 's', cwd: '/w/app', tool_name: 'Bash', tool_input: { command }, ...extra });

  it('finds where a successful push or a new pull request ran', () => {
    assert.deepEqual(pushSites(ran('git push')), ['/w/app']);
    assert.deepEqual(pushSites(ran('git add -A && git commit -m x && git push -u origin feat/x')), ['/w/app']);
    assert.deepEqual(pushSites(ran('cd ../api && git push && cd ../web && gh pr create --fill')), ['/w/api', '/w/web']);
    assert.deepEqual(pushSites(ran('sudo git -c core.x=1 push')), ['/w/app']);
    assert.deepEqual(pushSites(ran('git push', { tool_name: 'PowerShell', cwd: 'C:\\w\\app' })), ['C:\\w\\app']);
  });

  it("counts a push whose result the line does not show: piped without pipefail, or followed by ';'", () => {
    assert.deepEqual(pushSites(ran('git push 2>&1 | tail -3')), ['/w/app']);
    assert.deepEqual(pushSites(ran('git push; echo done')), ['/w/app']);
    assert.deepEqual(pushSites(ran('git push origin main &')), ['/w/app']);
  });

  it("follows git's own -C to the repository it pushes", () => {
    assert.deepEqual(pushSites(ran('git -C /other/repo push')), ['/other/repo']);
    assert.deepEqual(pushSites(ran('cd ../web && git -C ../api push')), ['/w/api']);
    assert.deepEqual(pushSites(ran('git -C C:\\w\\api push', { tool_name: 'PowerShell', cwd: 'C:\\w\\app' })), ['C:/w/api']);
    assert.equal(gitFolder(['git', '-C', 'a', '-c', 'x=1', '-C', '../b', 'push'], '/w'), '/w/b');
    assert.equal(gitFolder(['git', 'push', '-C', 'x'], '/w'), '/w', 'only before the subcommand');
    assert.equal(gitFolder(['git', '-C', '$REPO', 'push'], '/w'), null);
  });

  it('not a dry run, a deletion, a failure, a background run, or a line whose success proves nothing of it', () => {
    for (const command of ['git push --dry-run', 'git push -n', 'git push origin --delete old', 'git push origin :old', 'git status', 'gh pr view', 'git push || true', 'true || git push', 'if git push; then echo ok; fi', 'echo git push', 'git -C ~/elsewhere push']) {
      assert.deepEqual(pushSites(ran(command)), [], command);
    }
    assert.deepEqual(pushSites(ran('git push', { hook_event_name: 'PostToolUseFailure' })), []);
    assert.deepEqual(pushSites(ran('git push', { tool_input: { command: 'git push', run_in_background: true } })), []);
    assert.deepEqual(pushSites(ran('git push', { tool_name: 'Edit' })), []);
  });

  it('a Codex push only when its exit code was found', () => {
    assert.deepEqual(pushSites(ran('git push', { andary_source: 'codex' })), []);
    assert.deepEqual(pushSites(ran('git push', { andary_source: 'codex', andary_exit_known: true })), ['/w/app']);
  });
});
