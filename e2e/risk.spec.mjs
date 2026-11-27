// Risk marks and approval batching end to end (CONTRACTS §4.3 step 4b, §5.1): a real server, the
// real hook forwarder and the HUD. A risky request gets its red band; the same request from two
// crews shares one card with a checkbox each; answered cards fold under "Earlier"; a risky command
// that ran without asking counts in "need you"; and "Always hold risky commands for me" makes the
// hold check answer `ask`.
import { expect, test } from '@playwright/test';
import { startTown } from './helpers/town.mjs';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;

test.beforeEach(async () => {
  town = await startTown();
});

test.afterEach(async () => {
  await town?.stop();
});

/** @param {string} name @param {Record<string, unknown>} [extra] */
function hook(name, extra = {}) {
  return { session_id: 'e2e-session', transcript_path: '/tmp/t.jsonl', cwd: '/work/e2e-app', permission_mode: 'default', hook_event_name: name, ...extra };
}

/** @param {import('@playwright/test').Page} page */
async function signIn(page) {
  await page.goto(`${town.loginUrl}&world=fake`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
}

/** Opens Settings and sets a switch, then waits for the server to have it. @param {import('@playwright/test').Page} page @param {string} testId @param {string} setting */
async function turnOn(page, testId, setting) {
  const toggle = page.getByTestId(testId);
  if (!(await toggle.isVisible())) await page.getByTestId('settings-button').click();
  await toggle.check();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await (await fetch(`${town.baseUrl}/api/hello`)).json()).settings[setting]).toBe(true);
}

/** @param {import('@playwright/test').Page} page */
async function showApprovals(page) {
  const tab = page.getByRole('tab', { name: /^Approvals/ });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

test('a risky request shows a red band naming why', async ({ page }) => {
  await signIn(page);
  await turnOn(page, 'remote-approvals-toggle', 'remoteApprovals');
  const pending = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf ../shared/cache' } }));
  const card = page.getByTestId('approval-card').first();
  await expect(card).toBeAttached();
  await showApprovals(page);
  await expect(card).toHaveAttribute('data-risky', 'true');
  const band = card.getByTestId('approval-risk');
  await expect(band).toBeVisible();
  await expect(band).toHaveText('Risky: deletes recursively; deletes outside the project: /work/shared/cache');
  await expect(card).toHaveAccessibleDescription(/^Risky: deletes recursively/);
  await card.getByTestId('deny').click();
  expect(JSON.parse((await pending).stdout).hookSpecificOutput.decision.behavior).toBe('deny');
  // Answered, it stays in place with its result while it has focus, then folds into "Earlier".
  await expect(card).toContainText('Denied from the town');
  await expect(card).toBeFocused();
  await page.getByRole('tab', { name: /^Approvals/ }).focus();
  const earlier = page.getByTestId('approvals-earlier');
  await expect(earlier).toBeVisible();
  await expect(earlier.locator('summary')).toHaveText('Earlier (1)');
  await expect(earlier).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('approvals')).toContainText('Nothing needs your approval right now.');
});

test('the same request from two crews shares one card; the answer goes to the ticked crews', async ({ page }) => {
  await signIn(page);
  await turnOn(page, 'remote-approvals-toggle', 'remoteApprovals');
  const input = { command: 'git push --force-with-lease' };
  const first = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: input }));
  const second = town.sendHook(hook('PermissionRequest', { session_id: 'e2e-other', cwd: '/work/e2e-api', tool_name: 'Bash', tool_input: input }));
  const cards = page.locator('[data-testid="approvals"] .hud-approvals__list:not(.hud-approvals__list--earlier) [data-testid="approval-card"]');
  const checks = page.getByTestId('approval-crew-check');
  await expect(checks).toHaveCount(2);
  await expect(cards).toHaveCount(1);
  await showApprovals(page);
  const card = cards.first();
  await expect(card.getByTestId('approval-crews')).toContainText('2 crews ask for this');
  // Different folders: each row names its own.
  await expect(card.getByTestId('approval-crews')).toContainText('/work/e2e-app');
  await expect(card.getByTestId('approval-crews')).toContainText('/work/e2e-api');
  await expect(card.getByTestId('approval-risk')).toHaveText('Risky: rewrites remote history (force push)');
  // The request that came first is ticked; one that joined the card on screen starts unticked
  // (the two may arrive in either order, a moment apart). Answer the first crew only.
  const row = (/** @type {string} */ folder) => card.locator('label').filter({ hasText: folder }).getByTestId('approval-crew-check');
  await row('/work/e2e-app').setChecked(true);
  await row('/work/e2e-api').setChecked(false);
  await expect(card.getByTestId('approve')).not.toHaveAttribute('aria-disabled', 'true');
  await card.getByTestId('approve').click();
  const settled = await Promise.race([first.then(() => 'first'), second.then(() => 'second')]);
  expect(settled).toBe('first');
  expect(JSON.parse((await first).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
  // The other request still waits, unticked: it is answered only once ticked again.
  await expect(cards).toHaveCount(1);
  await expect(checks).toHaveCount(1);
  await expect(checks).not.toBeChecked();
  await expect(cards.first().getByTestId('deny')).toBeDisabled();
  await checks.check();
  await expect(cards.first().getByTestId('deny')).not.toHaveAttribute('aria-disabled', 'true');
  await cards.first().getByTestId('deny').click();
  expect(JSON.parse((await second).stdout).hookSpecificOutput.decision.behavior).toBe('deny');
  await page.getByRole('tab', { name: /^Approvals/ }).focus();
  await expect(page.getByTestId('approvals-earlier').locator('summary')).toHaveText('Earlier (2)');
});

test('a risky command an allow rule let through still counts in "need you"', async ({ page }) => {
  await signIn(page);
  await town.sendHook(hook('SessionStart', { source: 'startup' }));
  const call = { tool_name: 'Bash', tool_input: { command: 'git reset --hard origin/main' }, tool_use_id: 'toolu_risky' };
  await town.sendHook(hook('PreToolUse', call));
  await town.sendHook(hook('PostToolUse', { ...call, tool_response: { stdout: 'HEAD is now at 1a2b3c4', stderr: '' } }));
  const button = page.getByTestId('waiting-for-you');
  await expect(button).toHaveAccessibleName(/^1 needs you\. Next: Ran without asking: git reset --hard origin\/main/);
  await expect(page.locator('[data-testid="agent-row"][data-agent-key="e2e-session:main"]')).toContainText('Ran without asking: git reset --hard origin/main');
});

test('"Always hold risky commands for me" makes the hold check ask, even under an allow rule', async ({ page }) => {
  await signIn(page);
  const risky = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git push -f origin main' }, tool_use_id: 'toolu_hold' });
  expect((await town.sendHook(risky, { args: ['hold'] })).stdout).toBe('');
  await turnOn(page, 'hold-risky-toggle', 'holdRisky');
  // This town's Claude Code has no Andary hooks at all: Settings says nothing is held yet.
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('hold-risky-missing')).toBeVisible();
  await expect(page.getByTestId('hold-risky-missing')).toContainText('run andary install again');
  await page.keyboard.press('Escape');
  const output = JSON.parse((await town.sendHook(risky, { args: ['hold'] })).stdout);
  expect(output.hookSpecificOutput).toEqual({
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'Andary holds risky commands for you: rewrites remote history (force push)',
  });
  expect((await town.sendHook(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }), { args: ['hold'] })).stdout).toBe('');
});

test('a request that joins a card on screen waits a moment, unticked, and a key answer then skips it', async ({ page }) => {
  await signIn(page);
  await turnOn(page, 'remote-approvals-toggle', 'remoteApprovals');
  const input = { command: 'git push --force-with-lease' };
  const first = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: input }));
  const second = town.sendHook(hook('PermissionRequest', { session_id: 'e2e-other', cwd: '/work/e2e-api', tool_name: 'Bash', tool_input: input }));
  const checks = page.getByTestId('approval-crew-check');
  await expect(checks).toHaveCount(2);
  await showApprovals(page);
  const card = page.locator('[data-testid="approval-card"][data-status="pending"]');
  const allow = card.getByTestId('approve');
  // Both crews ticked by the viewer, who has read the card.
  for (const box of await checks.all()) await box.setChecked(true);
  await expect(allow).not.toHaveAttribute('aria-disabled', 'true');
  await card.focus();
  // The viewer has read the card; a third crew asks the same thing just now.
  const third = town.sendHook(hook('PermissionRequest', { session_id: 'e2e-prod', cwd: '/home/me/prod-repo', tool_name: 'Bash', tool_input: input }));
  await expect(checks).toHaveCount(3);
  await page.keyboard.press('a');
  await page.waitForTimeout(300);
  await expect(card).toHaveCount(1);
  await expect(checks).toHaveCount(3, { timeout: 1000 });
  const newcomer = card.locator('label').filter({ hasText: '/home/me/prod-repo' }).getByTestId('approval-crew-check');
  await expect(newcomer).not.toBeChecked();
  // Once the card has stayed as it is, A answers the crews that were ticked, not the newcomer.
  await expect(allow).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('a');
  for (const pending of [first, second]) expect(JSON.parse((await pending).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
  const left = page.locator('[data-testid="approval-card"][data-status="pending"]');
  await expect(left).toHaveCount(1);
  await expect(left).toContainText('$ git push --force-with-lease');
  // Still unticked: it is answered only once the viewer ticks it.
  await expect(left.getByTestId('deny')).toBeDisabled();
  await left.getByTestId('approval-crew-check').check();
  await expect(left.getByTestId('deny')).not.toHaveAttribute('aria-disabled', 'true');
  await left.getByTestId('deny').click();
  expect(JSON.parse((await third).stdout).hookSpecificOutput.decision.behavior).toBe('deny');
});

test('a request that joins a card in its first moment starts unticked, and a key pressed too soon says so', async ({ page }) => {
  await signIn(page);
  await turnOn(page, 'remote-approvals-toggle', 'remoteApprovals');
  await showApprovals(page);
  const input = { command: 'git reset --hard origin/main' };
  const first = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: input }));
  const card = page.locator('[data-testid="approval-card"][data-status="pending"]');
  await expect(card).toHaveCount(1);
  // A second crew asks the same thing while the card is still new on screen.
  const second = town.sendHook(hook('PermissionRequest', { session_id: 'e2e-prod', cwd: '/home/me/prod-repo', tool_name: 'Bash', tool_input: input }));
  const newcomer = card.locator('label').filter({ hasText: '/home/me/prod-repo' }).getByTestId('approval-crew-check');
  await expect(newcomer).toBeAttached();
  await expect(newcomer).not.toBeChecked();
  await card.focus();
  await page.keyboard.press('a');
  await expect(card.getByTestId('approval-wait')).toBeVisible();
  await expect(card.getByTestId('approval-wait')).toContainText('Not yet');
  await expect(card.getByTestId('approve')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(card.getByTestId('approval-wait')).toBeHidden();
  await page.keyboard.press('a');
  expect(JSON.parse((await first).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
  const left = page.locator('[data-testid="approval-card"][data-status="pending"]');
  await expect(left).toHaveCount(1);
  await left.getByTestId('approval-crew-check').check();
  await expect(left.getByTestId('deny')).not.toHaveAttribute('aria-disabled', 'true');
  await left.getByTestId('deny').click();
  expect(JSON.parse((await second).stdout).hookSpecificOutput.decision.behavior).toBe('deny');
});
