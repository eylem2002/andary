import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GH_FIELDS } from '../../../public/js/core/pr-status.js';
import { GH_TIMEOUT_MS, POLL_DELAYS_MS, WATCH_MS, classifyFailure, createPrWatch, nativeDir, runGh } from '../../../server/pr-watch.mjs';
import { findProgram } from '../../../server/programs.mjs';
import { createFakeClock } from '../core/helpers.mjs';

const GH = '/usr/bin/gh';
const run = (/** @type {string} */ name, /** @type {string} */ conclusion, status = 'COMPLETED') => ({ name, status, conclusion });
/** gh's answer for a pull request whose checks are in this state. */
const answer = (/** @type {'pending'|'failing'|'passing'} */ state, sha = 'abc') => ({
  ok: true,
  stdout: JSON.stringify({
    number: 42,
    url: 'https://github.com/acme/app/pull/42',
    state: 'OPEN',
    reviewDecision: '',
    headRefName: 'feat/x',
    headRefOid: sha,
    statusCheckRollup: [state === 'pending' ? run('test', '', 'IN_PROGRESS') : run('test', state === 'failing' ? 'FAILURE' : 'SUCCESS')],
  }),
});

/**
 * A PR watch on a fake clock with a fake gh: each run takes the next answer (the last repeats).
 * @param {{ answers?: any[], findGh?: () => string|null, platform?: NodeJS.Platform, isDir?: (dir: string) => boolean, wanted?: boolean, run?: any }} [options]
 */
function watch(options = {}) {
  const clock = createFakeClock(0);
  /** @type {{ bin: string, args: string[], cwd: string, timeoutMs: number, at: number }[]} */
  const runs = [];
  const answers = [...(options.answers ?? [answer('passing')])];
  /** @type {any[]} */
  const changes = [];
  /** @type {any[]} */
  const failing = [];
  /** @type {string[]} */
  const logs = [];
  let settingsChanges = 0;
  const prs = createPrWatch({
    wanted: options.wanted ?? true,
    findGh: options.findGh ?? (() => GH),
    isDir: options.isDir ?? (() => true),
    platform: options.platform ?? 'linux',
    now: clock.now,
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
    run: options.run ?? (async (/** @type {string} */ bin, /** @type {string[]} */ args, /** @type {any} */ { cwd, timeoutMs }) => {
      runs.push({ bin, args, cwd, timeoutMs, at: clock.now() });
      return answers.length > 1 ? answers.shift() : answers[0];
    }),
    onChange: (pr) => changes.push(pr),
    onFailing: (pr) => failing.push(pr),
    onSettings: () => {
      settingsChanges += 1;
    },
    log: (message) => logs.push(message),
  });
  return { prs, clock, runs, changes, failing, logs, settingsChanges: () => settingsChanges };
}

describe('createPrWatch', () => {
  it('asks gh in the work tree 30 s after a push, then backs off until the checks finish', async () => {
    const t = watch({ answers: [answer('pending'), answer('pending'), answer('failing')] });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(POLL_DELAYS_MS[0] - 1);
    assert.equal(t.runs.length, 0);
    await t.clock.advance(1);
    assert.deepEqual(t.runs[0], { bin: GH, args: ['pr', 'view', '--json', GH_FIELDS], cwd: '/w/app', timeoutMs: GH_TIMEOUT_MS, at: 30_000 });
    assert.deepEqual([t.changes[0].number, t.changes[0].checks.state, t.changes[0].watching, t.changes[0].sessionIds], [42, 'pending', true, ['s1']]);
    await t.clock.advance(60 * 60_000);
    assert.deepEqual(t.runs.map((r) => r.at), [30_000, 90_000, 210_000], '30 s, then 1 and 2 minutes later');
    assert.deepEqual([t.changes.at(-1).checks.state, t.changes.at(-1).watching], ['failing', false]);
    assert.equal(t.failing.length, 1, 'one phone note for the failure');
    assert.deepEqual(t.prs.list(), [t.changes.at(-1)]);
    assert.equal(t.clock.pending, 0, 'settled: nothing more to ask');
  });

  it('follows a push for an hour at most, every 5 minutes after the first few', async () => {
    const t = watch({ answers: [answer('pending')] });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(2 * WATCH_MS);
    const times = t.runs.map((r) => r.at);
    assert.deepEqual(times.slice(0, 5), [30_000, 90_000, 210_000, 510_000, 810_000]);
    assert.ok(times.at(-1) <= WATCH_MS + 300_000 && times.at(-1) >= WATCH_MS - 300_000, String(times.at(-1)));
    assert.equal(t.changes.at(-1).watching, false);
    assert.equal(t.clock.pending, 0);
  });

  it('a new push to the same work tree starts again, names both crews and is a new episode', async () => {
    const t = watch({ answers: [answer('failing', 'a1'), answer('failing', 'a1'), answer('failing', 'b2')] });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(30_000);
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(30_000);
    assert.equal(t.failing.length, 1, 'the same head commit failing again sends no second note');
    t.prs.pushed({ root: '/w/app', sessionId: 's2' });
    await t.clock.advance(30_000);
    assert.equal(t.failing.length, 2);
    assert.deepEqual(t.changes.at(-1).sessionIds, ['s1', 's2']);
  });

  it('without gh: one quiet hint, no run, and gh installed later is found on the next push', async () => {
    let bin = /** @type {string|null} */ (null);
    const t = watch({ findGh: () => bin });
    assert.deepEqual(t.prs.settings(), { on: false, available: false, hint: null });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(60_000);
    assert.deepEqual(t.prs.settings(), { on: false, available: false, hint: 'missing' });
    assert.equal(t.settingsChanges(), 1);
    assert.equal(t.logs.length, 1);
    assert.equal(t.runs.length, 0);
    bin = GH;
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    assert.deepEqual(t.prs.settings(), { on: true, available: true, hint: null });
    await t.clock.advance(30_000);
    assert.equal(t.runs.length, 1);
  });

  it('gh not signed in: one hint, every look stops; signed in later clears it', async () => {
    const t = watch({ answers: [{ ok: false, code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' }, answer('passing')] });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(30_000);
    assert.equal(t.prs.settings().hint, 'signin');
    assert.equal(t.clock.pending, 0);
    assert.equal(t.changes.length, 0, 'never an error in the town');
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(30_000);
    assert.deepEqual(t.prs.settings(), { on: true, available: true, hint: null });
    assert.equal(t.changes.at(-1).checks.state, 'passing');
  });

  it('gh gone since the start (ENOENT): the missing hint, and no more runs', async () => {
    const t = watch({ answers: [{ ok: false, code: 'ENOENT', stderr: '' }] });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(30_000);
    assert.deepEqual(t.prs.settings(), { on: false, available: false, hint: 'missing' });
  });

  it('no pull request yet: keeps looking quietly; not a GitHub repository: forgets it', async () => {
    const t = watch({ answers: [{ ok: false, code: 1, stderr: 'no pull requests found for branch "feat/x"' }, answer('passing')] });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(90_000);
    assert.equal(t.runs.length, 2);
    assert.equal(t.changes.at(-1).number, 42);
    const other = watch({ answers: [{ ok: false, code: 1, stderr: 'none of the git remotes configured for this repository point to a known GitHub host' }] });
    other.prs.pushed({ root: '/w/gitlab', sessionId: 's1' });
    await other.clock.advance(WATCH_MS);
    assert.equal(other.runs.length, 1);
    assert.deepEqual(other.prs.list(), []);
  });

  it('gives a push up after three failed looks in a row, with one log line', async () => {
    const t = watch({ answers: [{ ok: false, code: null, stderr: '', timedOut: true }] });
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(WATCH_MS);
    assert.equal(t.runs.length, 3);
    assert.deepEqual(t.logs, ['PR and CI status: gh did not answer 3 times in a row (timed out); waiting for the next push']);
  });

  it('a work tree removed since the push is forgotten without asking gh', async () => {
    const t = watch({ isDir: () => false });
    t.prs.pushed({ root: '/w/gone', sessionId: 's1' });
    await t.clock.advance(30_000);
    assert.equal(t.runs.length, 0);
    assert.equal(t.prs.settings().hint, null);
  });

  it('runs two gh at a time at most', async () => {
    /** @type {((value: any) => void)[]} */
    const waiting = [];
    let running = 0;
    let most = 0;
    const t = watch({
      run: () => new Promise((resolve) => {
        running += 1;
        most = Math.max(most, running);
        waiting.push((value) => {
          running -= 1;
          resolve(value);
        });
      }),
    });
    for (const root of ['/w/a', '/w/b', '/w/c']) t.prs.pushed({ root, sessionId: 's' });
    await t.clock.advance(30_000);
    assert.equal(waiting.length, 2);
    for (const done of waiting.splice(0)) done(answer('passing'));
    await t.clock.advance(0);
    await t.clock.advance(5_000);
    assert.equal(waiting.length, 1, 'the third waited for a free slot');
    waiting[0](answer('passing'));
    await t.clock.advance(1);
    assert.equal(most, 2);
    assert.equal(t.prs.list().length, 3);
  });

  it('off (--no-gh, or the town switch): pushes are ignored; on again looks for gh', async () => {
    const t = watch({ wanted: false });
    assert.deepEqual(t.prs.settings(), { on: false, available: true, hint: null }, 'gh is there, the switch is off');
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(60_000);
    assert.equal(t.runs.length, 0);
    t.prs.setWanted(true);
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    await t.clock.advance(30_000);
    assert.equal(t.runs.length, 1);
    t.prs.pushed({ root: '/w/app', sessionId: 's1' });
    t.prs.setWanted(false);
    await t.clock.advance(60_000);
    assert.equal(t.runs.length, 1);
    assert.equal(t.prs.settings().on, false);
  });

  it('Windows: runs gh.exe in the work tree with its own separators', async () => {
    const t = watch({ platform: 'win32', findGh: () => 'C:\\Program Files\\GitHub CLI\\gh.exe' });
    t.prs.pushed({ root: 'C:/w/app', sessionId: 's1' });
    await t.clock.advance(30_000);
    assert.deepEqual([t.runs[0].bin, t.runs[0].cwd], ['C:\\Program Files\\GitHub CLI\\gh.exe', 'C:\\w\\app']);
    assert.equal(t.changes[0].root, 'C:/w/app', 'the town keeps the work tree as it knows it');
  });
});

describe('nativeDir', () => {
  it('gives Windows its own separators, drives and shares alike; elsewhere the folder as it is', () => {
    assert.equal(nativeDir('C:/w/app', 'win32'), 'C:\\w\\app');
    assert.equal(nativeDir('//host/share/app', 'win32'), '\\\\host\\share\\app');
    assert.equal(nativeDir('/w/app', 'linux'), '/w/app');
  });
});

describe('findProgram', () => {
  it('Windows: only gh.exe, only in absolute Path entries, joined with backslashes', () => {
    /** @type {string[]} */
    const asked = [];
    const isProgram = (/** @type {string} */ file) => {
      asked.push(file);
      return file === 'D:\\tools\\gh.exe';
    };
    assert.equal(findProgram('gh', { Path: 'bin;C:\\nothing;D:\\tools;E:\\later', PATHEXT: '.CMD;.EXE' }, 'win32', isProgram), 'D:\\tools\\gh.exe');
    assert.deepEqual(asked, ['C:\\nothing\\gh.exe', 'D:\\tools\\gh.exe']);
    assert.equal(findProgram('gh', { Path: '\\\\server\\bin' }, 'win32', (file) => file === '\\\\server\\bin\\gh.exe'), '\\\\server\\bin\\gh.exe');
  });

  it('elsewhere: an absolute PATH entry, first first', () => {
    assert.equal(findProgram('gh', { PATH: 'rel:/a:/b' }, 'linux', (file) => file.startsWith('/b')), '/b/gh');
    assert.equal(findProgram('gh', {}, 'linux', () => true), null);
  });
});

describe('classifyFailure', () => {
  it("reads gh's own words and exit codes", () => {
    const failure = (/** @type {any} */ code, stderr = '') => classifyFailure({ ok: false, code, stderr });
    assert.equal(failure('ENOENT'), 'missing');
    assert.equal(failure(4), 'signin');
    assert.equal(failure(1, 'You are not logged into any GitHub hosts. To log in, run: gh auth login'), 'signin');
    assert.equal(failure(1, 'no pull requests found for branch "x"'), 'none');
    assert.equal(failure(1, 'fatal: not a git repository (or any of the parent directories): .git'), 'elsewhere');
    assert.equal(failure(1, 'HTTP 502'), 'error');
  });
});

describe('runGh', () => {
  // Node stands in for gh: the same execFile, on every system.
  it('gives what the program printed, or a failure with its code; never throws', async () => {
    const ok = await runGh(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({ number: 1, prompt: process.env.GH_PROMPT_DISABLED }))'], { cwd: process.cwd(), timeoutMs: 10_000 });
    assert.deepEqual(ok.ok && JSON.parse(ok.stdout), { number: 1, prompt: '1' });
    const failed = await runGh(process.execPath, ['-e', 'process.stderr.write("gh auth login"); process.exit(4)'], { cwd: process.cwd(), timeoutMs: 10_000 });
    assert.deepEqual(failed, { ok: false, code: 4, stderr: 'gh auth login', timedOut: false });
    const missing = /** @type {any} */ (await runGh('/no/such/gh', [], { cwd: process.cwd(), timeoutMs: 10_000 }));
    assert.deepEqual([missing.ok, missing.code], [false, 'ENOENT']);
    const slow = /** @type {any} */ (await runGh(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { cwd: process.cwd(), timeoutMs: 200 }));
    assert.deepEqual([slow.ok, slow.timedOut], [false, true]);
  });
});
