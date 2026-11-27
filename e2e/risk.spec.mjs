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
  await expect(checks.nth(0)).toBeChecked();
  await expect(checks.nth(1)).toBeChecked();
  // Leave the second crew's request waiting (the two may have arrived in either order).
  await card.locator('label').filter({ hasText: '/work/e2e-api' }).getByTestId('approval-crew-check').uncheck();
  await card.getByTestId('approve').click();
  const settled = await Promise.race([first.then(() => 'first'), second.then(() => 'second')]);
  expect(settled).toBe('first');
  expect(JSON.parse((await first).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
  // The other request still waits on a card of its own, then is denied.
  await expect(page.getByTestId('approval-crew-check')).toHaveCount(0);
  await expect(cards).toHaveCount(1);
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
  const output = JSON.parse((await town.sendHook(risky, { args: ['hold'] })).stdout);
  expect(output.hookSpecificOutput).toEqual({
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'Andary holds risky commands for you: rewrites remote history (force push)',
  });
  expect((await town.sendHook(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }), { args: ['hold'] })).stdout).toBe('');
});
