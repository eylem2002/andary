// Each crew's branch and working tree with a real server and a real repository (CONTRACTS §4.16):
// a local hook in a work tree makes the server read git status, owners hear of it and get it in
// their hello; a team viewer never does, and a teammate's hook never runs git here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { teamSecret, viewToken } from '../../server/team.mjs';
import { closeBrowser, connectBrowser, hookPayload, postHook, startTown, waitForMessage } from './helpers.mjs';

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('git status per crew', { skip: hasGit ? false : 'git is not installed' }, () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  const dir = mkdtempSync(join(tmpdir(), 'andary-git-int-'));
  const repo = join(dir, 'app');
  before(async () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    writeFileSync(join(repo, 'src', 'a.js'), '1\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feat/login');
    writeFileSync(join(repo, 'src', 'a.js'), '2\n');
    writeFileSync(join(repo, 'notes.txt'), 'x\n');
    town = await startTown({ args: ['--team', '--host', '127.0.0.1'] });
  });
  after(async () => {
    await town?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a local hook in a work tree: owners hear the branch and counts, a late owner gets it in hello, a viewer never', async () => {
    const owner = await connectBrowser(town);
    assert.deepEqual((await waitForMessage(owner, (m) => m?.t === 'hello')).git, []);
    const view = viewToken(/** @type {string} */ (teamSecret(town.home, { create: false })));
    const viewer = await connectBrowser(town, { protocols: `andary, andary.view.${view}` });
    await waitForMessage(viewer, (m) => m?.t === 'hello');
    /** @type {any[]} */
    const seenByViewer = [];
    viewer.on('message', (/** @type {string} */ text) => seenByViewer.push(JSON.parse(text)));

    const heard = waitForMessage(owner, (m) => m?.t === 'git', 8000);
    assert.equal((await postHook(town, hookPayload('Stop', { cwd: join(repo, 'src') }))).status, 200);
    const { g } = await heard;
    const root = repo.replace(/\\/g, '/');
    assert.deepEqual([g.root, g.branch, g.upstream, g.changed, g.untracked, g.worktree], [root, 'feat/login', null, 1, 1, null]);
    assert.ok(!JSON.stringify(g).includes('notes.txt'), 'never a file name');

    const late = await connectBrowser(town);
    assert.equal((await waitForMessage(late, (m) => m?.t === 'hello')).git[0].branch, 'feat/login');
    const lateViewer = await connectBrowser(town, { protocols: `andary, andary.view.${view}` });
    assert.deepEqual((await waitForMessage(lateViewer, (m) => m?.t === 'hello')).git, []);
    assert.ok(!seenByViewer.some((m) => m.t === 'git'));
    for (const connection of [owner, viewer, late, lateViewer]) await closeBrowser(connection);
  });
});
