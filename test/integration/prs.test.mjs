// PR and CI status with a real server and a fake gh on its PATH (CONTRACTS §4.16): a push from a
// hook starts `gh pr view` in the work tree; owners hear of the result, and can turn it off.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GH_FIELDS } from '../../public/js/core/pr-status.js';
import { createFakeGh, prView } from '../../e2e/helpers/fake-gh.mjs';
import { closeBrowser, connectBrowser, hookPayload, postHook, startTown, waitForMessage } from './helpers.mjs';

const WINDOWS = process.platform === 'win32' && 'the fake gh is a script; Windows runs gh.exe only (unit tests cover that path)';

describe('PR and CI status through a fake gh', { skip: WINDOWS }, () => {
  /** @type {Awaited<ReturnType<typeof startTown>>} */
  let town;
  /** @type {ReturnType<typeof createFakeGh>} */
  let gh;
  let root = '';
  let repo = '';

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'andary-prs-'));
    repo = join(root, 'api-server');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'src'), { recursive: true });
    gh = createFakeGh(join(root, 'gh'));
    town = await startTown({ gh: true, env: { ...gh.env, ANDARY_GH_POLL_MS: '100' } });
  });

  after(async () => {
    await town?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('after a push, asks gh in the work tree and tells signed-in browsers; hello carries it too', async () => {
    const browser = await connectBrowser(town);
    const hello = await waitForMessage(browser, (m) => m?.t === 'hello');
    assert.deepEqual(hello.settings.gh, { on: true, available: true, hint: null });
    assert.deepEqual(hello.prs, []);
    gh.view(prView('failing'));
    const crew = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => hookPayload(name, { session_id: 'pr-crew', cwd: join(repo, 'src'), ...extra });
    assert.equal((await postHook(town, crew('SessionStart', { source: 'startup' }))).status, 200);
    assert.equal((await postHook(town, crew('PostToolUse', { tool_name: 'Bash', tool_use_id: 'p1', tool_input: { command: 'git push -u origin feat/login' }, tool_response: { stdout: '' } }))).status, 200);
    const { pr } = await waitForMessage(browser, (m) => m?.t === 'pr' && m.pr.checks.state === 'failing', 10_000);
    assert.deepEqual([pr.root, pr.sessionIds, pr.number, pr.branch, pr.checks.failed], [repo, ['pr-crew'], 123, 'feat/login', ['test (ubuntu-latest)']]);
    const [call] = gh.calls();
    assert.deepEqual(call, { args: ['pr', 'view', '--json', GH_FIELDS], cwd: repo, prompt: '1' });
    const later = await connectBrowser(town);
    assert.equal((await waitForMessage(later, (m) => m?.t === 'hello')).prs[0].number, 123);
    await Promise.all([closeBrowser(browser), closeBrowser(later)]);
  });

  it('the town switch turns it off and on, for every browser', async () => {
    const first = await connectBrowser(town);
    const second = await connectBrowser(town);
    await waitForMessage(second, (m) => m?.t === 'hello');
    first.send(JSON.stringify({ t: 'settings', settings: { gh: false } }));
    assert.equal((await waitForMessage(second, (m) => m?.t === 'settings')).settings.gh.on, false);
    first.send(JSON.stringify({ t: 'settings', settings: { gh: true } }));
    assert.equal((await waitForMessage(second, (m) => m?.t === 'settings' && m.settings.gh.on)).settings.gh.on, true);
    await Promise.all([closeBrowser(first), closeBrowser(second)]);
  });

  it('gh not signed in: a quiet hint in the settings, never an error', async () => {
    const browser = await connectBrowser(town);
    await waitForMessage(browser, (m) => m?.t === 'hello');
    gh.answer({ stderr: 'To get started with GitHub CLI, please run:  gh auth login', code: 4 });
    await postHook(town, hookPayload('PostToolUse', { session_id: 'pr-crew', cwd: repo, tool_name: 'Bash', tool_use_id: 'p2', tool_input: { command: 'git push' }, tool_response: {} }));
    const { settings } = await waitForMessage(browser, (m) => m?.t === 'settings' && m.settings.gh.hint === 'signin', 10_000);
    assert.deepEqual(settings.gh, { on: true, available: true, hint: 'signin' });
    assert.ok(!browser.messages.some((m) => m?.t === 'error'));
    await closeBrowser(browser);
  });
});
