// Each crew's branch and working tree, a push while the last test run failed, and where an agent
// works, end to end: a real server reading a real repository with git status, the real hook
// forwarder, and the HUD (CONTRACTS §4.16, §8.1).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startTown } from './helpers/town.mjs';

/** Where screenshots for the pull request go, when asked for (SHOTS_DIR). */
const SHOTS = process.env.SHOTS_DIR ?? '';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;
/** @type {string} */
let dir;
/** @type {string} */
let repo;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'andary-e2e-git-'));
  repo = join(dir, 'shop-api');
  const remote = join(dir, 'remote.git');
  const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'ignore' });
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(dir, 'init', '-q', '--bare', remote);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export const total = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  git(repo, 'checkout', '-q', '-b', 'fix/cart-total');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', '-u', 'origin', 'fix/cart-total');
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export const total = 2;\n');
  git(repo, 'commit', '-q', '-am', 'second');
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export const total = 3;\n');
  writeFileSync(join(repo, 'src', 'tax.ts'), 'export const tax = 0;\n');
  town = await startTown();
});

test.afterEach(async () => {
  await town?.stop();
  rmSync(dir, { recursive: true, force: true });
});

test('a crew shows its branch; a push after a failed test run is a warning that needs you; details say where it works', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.goto(`${town.loginUrl}&world=fake`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  const hook = (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => ({ session_id: 'git-e2e', transcript_path: '/tmp/t.jsonl', cwd: repo, permission_mode: 'default', model: 'claude-opus-5-5', hook_event_name: name, ...extra });
  for (const payload of [
    hook('SessionStart', { source: 'startup' }),
    hook('UserPromptSubmit', { prompt: 'Fix the cart total' }),
    hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' } }),
    hook('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' }, error: 'Exit code 1\n FAIL  test/cart.test.ts > total', is_interrupt: false }),
    hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'p1', tool_input: { command: 'git push' } }),
    hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'p1', tool_input: { command: 'git push' }, tool_response: { stdout: '', stderr: 'To remote.git\n   1a2b3c4..5d6e7f8  fix/cart-total -> fix/cart-total' } }),
  ]) {
    expect(await town.sendHook(payload)).toMatchObject({ code: 0 });
  }

  // The branch line: git said one commit ahead, one changed and one new file (the push was a story).
  const crew = page.locator('[data-testid="crew"][data-session-id="git-e2e"]');
  const line = crew.getByTestId('crew-git');
  await expect(line).toBeVisible();
  await expect(line).toContainText('fix/cart-total ↑1 · 2 changed');
  await expect(line).toContainText('On fix/cart-total. 1 commit ahead of origin/fix/cart-total. 1 changed file, 1 new file.');

  // The push while red: on the lead's row and counted in "need you".
  const row = page.locator('[data-testid="agent-row"][data-agent-key="git-e2e:main"]');
  await expect(row).toContainText('Pushed while the last test run failed: npm test');
  await expect(row).toHaveAttribute('data-need', 'alert');
  await expect(page.getByTestId('waiting-for-you')).toHaveAttribute('aria-label', /^1 needs you. Next: Pushed while the last test run failed/);
  if (SHOTS && test.info().project.name === 'desktop') await page.screenshot({ path: join(SHOTS, 'git-crew-row.png') });

  // Where it works: the folder, the branch, the model and its session id, which can be copied.
  await row.click();
  const inspector = page.getByTestId('agent-inspector');
  const where = inspector.getByTestId('agent-where');
  await expect(where).toContainText(repo);
  await expect(where).toContainText('On fix/cart-total');
  await expect(where).toContainText('Opus 5.5 (claude-opus-5-5)');
  await expect(inspector.getByTestId('agent-session-id')).toHaveText('git-e2e');
  await inspector.getByTestId('copy-session-id').click();
  await expect(inspector.getByTestId('copy-session-id')).toContainText(/Copied|Press Ctrl\+C/);
  if (SHOTS && test.info().project.name === 'desktop') await page.screenshot({ path: join(SHOTS, 'git-agent-details.png') });

  // Catch me up sets it apart from what the crew did.
  await inspector.getByRole('button', { name: 'Close agent details' }).click();
  await page.keyboard.press('w');
  const dialog = page.getByTestId('catch-up');
  await expect(dialog).toBeVisible();
  const entry = dialog.locator('[data-testid="catch-up-crew"][data-session-id="git-e2e"]');
  await expect(entry.getByTestId('catch-up-warning')).toHaveText('Check: Pushed while the last test run failed');
  await expect(entry).toContainText('tests failing, pushed');
  if (SHOTS && test.info().project.name === 'desktop') await page.screenshot({ path: join(SHOTS, 'git-catch-up.png') });
  await page.keyboard.press('Escape');

  // Set aside, it no longer counts.
  const setAside = test.info().project.name === 'mobile'
    ? (await row.click(), inspector.getByTestId('inspector-dismiss'))
    : page.locator('.hud-stations__item:has([data-agent-key="git-e2e:main"]) [data-testid="dismiss-need"]');
  await setAside.click();
  await expect(page.getByTestId('waiting-for-you')).toBeHidden();
});
