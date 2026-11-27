// Each crew's branch and working tree (server/git-status.mjs): what git status says as counts and
// names, a real repository and a linked worktree, and how often git runs (throttled per
// repository, a last look after a burst, huge trees without untracked files, git missing).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { MAX_REPOS, createGitStatus, parsePorcelain, runGit, withoutRepoOverrides, worktreeName } from '../../../server/git-status.mjs';

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Waits for promises and timers of 0 ms to run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('git status, read', () => {
  test('branch, upstream, ahead and behind, changed and untracked files: counts only', () => {
    const out = [
      '# branch.oid 0123456789abcdef0123456789abcdef01234567',
      '# branch.head feat/login',
      '# branch.upstream origin/feat/login',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/a.js',
      '1 M. N... 100644 100644 100644 aaa bbb src/b.js',
      '2 R. N... 100644 100644 100644 aaa bbb R100 src/new.js\tsrc/old.js',
      'u UU N... 100644 100644 100644 100644 a b c conflict.js',
      '? notes.txt',
      '! ignored.log',
      '',
    ].join('\n');
    assert.deepEqual(parsePorcelain(out), { branch: 'feat/login', oid: '0123456', upstream: 'origin/feat/login', ahead: 2, behind: 1, changed: 4, untracked: 1 });
  });

  test('detached, a first commit not made yet, no upstream', () => {
    assert.deepEqual(parsePorcelain('# branch.oid abcdef1234567\n# branch.head (detached)\n'), { branch: null, oid: 'abcdef1', upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 });
    assert.equal(parsePorcelain('# branch.oid (initial)\n# branch.head main\n').oid, null);
  });

  test('a long branch name is cut', () => {
    assert.equal(parsePorcelain(`# branch.head ${'b'.repeat(500)}\n`).branch?.length, 200);
  });
});

describe('git status, on disk', { skip: hasGit ? false : 'git is not installed' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'andary-git-'));
  after(() => rmSync(home, { recursive: true, force: true }));
  const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'ignore' });

  test('a repository and its linked worktree: branch, changed files, the worktree by name', async () => {
    const repo = join(home, 'repo');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'first');
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    writeFileSync(join(repo, 'new.txt'), 'x\n');
    const tree = join(home, 'b-feature');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/x', tree);

    const result = await runGit(repo, { untracked: true, timeoutMs: 5000 });
    assert.ok('stdout' in result);
    assert.deepEqual({ ...parsePorcelain(result.stdout), oid: null }, { branch: 'main', oid: null, upstream: null, ahead: 0, behind: 0, changed: 1, untracked: 1 });
    const without = await runGit(repo, { untracked: false, timeoutMs: 5000 });
    assert.ok('stdout' in without);
    assert.equal(parsePorcelain(without.stdout).untracked, 0);
    assert.equal(worktreeName(repo), null);
    assert.equal(worktreeName(tree.replace(/\\/g, '/')), 'b-feature');

    /** @type {import('../../../server/git-status.mjs').GitStatus[]} */
    const seen = [];
    const tracker = createGitStatus({ onChange: (status) => seen.push(status) });
    tracker.observe({ hook_event_name: 'Stop', cwd: tree, andary_root: tree.replace(/\\/g, '/') });
    for (let i = 0; i < 100 && !seen.length; i += 1) await settle();
    tracker.dispose();
    assert.equal(seen.length, 1);
    assert.deepEqual([seen[0].branch, seen[0].worktree, seen[0].changed, seen[0].untracked], ['feat/x', 'b-feature', 0, 0]);
  });

  test('a folder git cannot read is an error, not a throw', async () => {
    const plain = join(home, 'plain');
    mkdirSync(plain);
    assert.deepEqual(await runGit(plain, { untracked: true, timeoutMs: 5000 }), { error: 'failed' });
  });
});

describe('git status, how often', () => {
  /** A fake git: records each run and answers what `answer` says. */
  /** @param {(root: string, untracked: boolean) => import('../../../server/git-status.mjs').RunResult} [answer] */
  function fakeGit(answer = () => ({ stdout: '# branch.head main\n' })) {
    /** @type {{ root: string, untracked: boolean }[]} */
    const runs = [];
    /** @type {import('../../../server/git-status.mjs').Runner} */
    const run = async (root, { untracked }) => {
      runs.push({ root, untracked });
      return answer(root, untracked);
    };
    return { runs, run };
  }

  test('only hooks that may change the tree, in a work tree; the root from the stamp or the folder', async () => {
    const { runs, run } = fakeGit();
    const tracker = createGitStatus({ onChange: () => {}, run, worktreeOf: () => null, workTrees: { rootOf: (folder) => (folder === '/w/app/src' ? '/w/app' : null) }, minIntervalMs: 0 });
    tracker.observe({ hook_event_name: 'PreToolUse', tool_name: 'Bash', andary_root: '/w/a' });
    tracker.observe({ hook_event_name: 'PostToolUse', tool_name: 'Read', andary_root: '/w/a' });
    tracker.observe({ hook_event_name: 'Notification', cwd: '/w/app/src' });
    tracker.observe({ hook_event_name: 'Stop', cwd: '/tmp' });
    assert.equal(runs.length, 0);
    tracker.observe({ hook_event_name: 'PostToolUse', tool_name: 'Edit', andary_root: '/w/b' });
    await settle();
    tracker.observe({ hook_event_name: 'Stop', cwd: '/w/app/src' });
    await settle();
    tracker.dispose();
    assert.deepEqual(runs.map((r) => r.root), ['/w/b', '/w/app']);
  });

  test('at most once per interval per repository, with one more look after a burst; sent only when it changed', async () => {
    let clock = 0;
    let branch = 'main';
    const { runs, run } = fakeGit(() => ({ stdout: `# branch.head ${branch}\n` }));
    /** @type {string[]} */
    const sent = [];
    const tracker = createGitStatus({ onChange: (s) => sent.push(String(s.branch)), run, worktreeOf: () => null, now: () => clock, minIntervalMs: 30 });
    const stop = { hook_event_name: 'Stop', andary_root: '/w/a' };
    tracker.observe(stop);
    await settle();
    branch = 'feat';
    for (let i = 0; i < 5; i += 1) tracker.observe(stop);
    await settle();
    assert.equal(runs.length, 1, 'a burst inside the interval waits');
    clock = 30;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(runs.length, 2, 'one look when the interval is up');
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/b' });
    await settle();
    assert.equal(runs.length, 3, 'another repository has its own interval');
    clock = 100;
    tracker.observe(stop);
    await settle();
    assert.equal(runs.length, 4);
    tracker.dispose();
    assert.deepEqual(sent, ['main', 'feat', 'feat'], 'the same answer again is not sent');
    assert.deepEqual(tracker.snapshot().map((s) => [s.root, s.branch]), [['/w/b', 'feat'], ['/w/a', 'feat']]);
  });

  test('a look that times out or says too much is made again without untracked files', async () => {
    const { runs, run } = fakeGit((_root, untracked) => (untracked ? { error: 'timeout' } : { stdout: '# branch.head main\n1 .M N... 1 1 1 a b f\n' }));
    /** @type {import('../../../server/git-status.mjs').GitStatus[]} */
    const sent = [];
    const tracker = createGitStatus({ onChange: (s) => sent.push(s), run, worktreeOf: () => null, minIntervalMs: 1000 });
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/huge' });
    await settle();
    tracker.dispose();
    assert.deepEqual(runs.map((r) => r.untracked), [true, false]);
    assert.deepEqual([sent.length, sent[0].changed, sent[0].untracked], [1, 1, null]);
  });

  test('a slow tree counts new files again a few minutes later', async () => {
    let clock = 0;
    let huge = true;
    const { runs, run } = fakeGit((_root, untracked) => (untracked && huge ? { error: 'timeout' } : { stdout: '# branch.head main\n' }));
    const tracker = createGitStatus({ onChange: () => {}, run, worktreeOf: () => null, now: () => clock, minIntervalMs: 0 });
    const stop = { hook_event_name: 'Stop', andary_root: '/w/huge' };
    tracker.observe(stop);
    await settle();
    clock = 60_000;
    tracker.observe(stop);
    await settle();
    huge = false;
    clock = 6 * 60_000;
    tracker.observe(stop);
    await settle();
    tracker.dispose();
    assert.deepEqual(runs.map((r) => r.untracked), [true, false, false, true]);
    assert.equal(tracker.snapshot()[0].untracked, 0);
  });

  test('a repository that showed a line and can no longer be read is gone', async () => {
    let readable = true;
    const { run } = fakeGit(() => (readable ? { stdout: '# branch.head main\n' } : { error: 'failed' }));
    /** @type {string[]} */
    const gone = [];
    const tracker = createGitStatus({ onChange: () => {}, onGone: (root) => gone.push(root), run, worktreeOf: () => null, minIntervalMs: 0 });
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/a' });
    await settle();
    readable = false;
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/a' });
    await settle();
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/a' });
    await settle();
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/never' });
    await settle();
    tracker.dispose();
    assert.deepEqual(gone, ['/w/a'], 'once, and not for one that never showed');
    assert.deepEqual(tracker.snapshot(), []);
  });

  test("variables that would point git elsewhere are not passed on", () => {
    const env = withoutRepoOverrides({ PATH: '/bin', HOME: '/h', GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: 'i', GIT_COMMON_DIR: 'c', GIT_OBJECT_DIRECTORY: 'o', GIT_CONFIG_PARAMETERS: "'core.fsmonitor=evil'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'evil' });
    assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
  });

  test('git missing: said once, never run again', async () => {
    const { runs, run } = fakeGit(() => ({ error: 'missing' }));
    /** @type {string[]} */
    const logs = [];
    const tracker = createGitStatus({ onChange: () => assert.fail('nothing to send'), run, worktreeOf: () => null, minIntervalMs: 0, log: (m) => logs.push(m) });
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/a' });
    await settle();
    tracker.observe({ hook_event_name: 'Stop', andary_root: '/w/b' });
    await settle();
    tracker.dispose();
    assert.equal(runs.length, 1);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /\/w\//, 'no folder in the log');
  });

  test('bounded: the repository asked about longest ago is forgotten', async () => {
    const { run } = fakeGit();
    const tracker = createGitStatus({ onChange: () => {}, run, worktreeOf: () => null, minIntervalMs: 0 });
    for (let i = 0; i < MAX_REPOS + 5; i += 1) {
      tracker.observe({ hook_event_name: 'Stop', andary_root: `/w/r${i}` });
      await settle();
    }
    tracker.dispose();
    const roots = tracker.snapshot().map((s) => s.root);
    assert.equal(roots.length, MAX_REPOS);
    assert.ok(!roots.includes('/w/r0'));
  });
});
