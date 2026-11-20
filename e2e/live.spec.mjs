// Live mode end to end: a real server, the real hook forwarder, and the HUD in a browser
// (CONTRACTS §8.1 test ids).
import { expect, test } from '@playwright/test';
import { startTown } from './helpers/town.mjs';

// These tests cover the live pipeline and the HUD, not the 3D scene: ?world=fake skips WebGL,
// which is slow to emulate in CI. The sign-in redirect keeps the parameter.
const PAGE_OPTIONS = 'world=fake';

/** @type {Awaited<ReturnType<typeof startTown>>} */
let town;

test.beforeEach(async () => {
  town = await startTown();
});

test.afterEach(async () => {
  await town?.stop();
});

/**
 * @param {string} name
 * @param {Record<string, unknown>} [extra]
 */
function hook(name, extra = {}) {
  return { session_id: 'e2e-session', transcript_path: '/tmp/t.jsonl', cwd: '/work/e2e-app', permission_mode: 'default', hook_event_name: name, ...extra };
}

/** @param {import('@playwright/test').Page} page */
async function signIn(page) {
  await page.goto(`${town.loginUrl}&${PAGE_OPTIONS}`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
}

/**
 * Switches remote approvals on through the HUD and waits until the server has it.
 * @param {import('@playwright/test').Page} page
 */
async function enableRemoteApprovals(page) {
  const toggle = page.getByTestId('remote-approvals-toggle');
  if (!(await toggle.isVisible())) await page.getByTestId('settings-button').click();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await (await fetch(`${town.baseUrl}/api/hello`)).json()).settings.remoteApprovals)
    .toBe(true);
}

test('a browser without the token is asked to sign in', async ({ page }) => {
  await page.goto(`${town.baseUrl}/?${PAGE_OPTIONS}`);
  await expect(page.getByTestId('login-hint')).toBeVisible();
  await expect(page.getByTestId('connection-status')).toContainText('Sign in');
});

test('the sign-in link connects live and drops the token from the address bar', async ({ page }) => {
  await signIn(page);
  const url = new URL(page.url());
  expect(url.searchParams.has('token')).toBe(false);
  expect(url.searchParams.get('world')).toBe('fake');
  const cookies = await page.context().cookies();
  const cookie = cookies.find((c) => c.name === 'andary_ui');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Strict');
});

test('hook events show up as a crew, agent rows and log entries', async ({ page }) => {
  await signIn(page);
  for (const payload of [
    hook('SessionStart', { source: 'startup', model: 'claude-opus-5-5' }),
    hook('UserPromptSubmit', { prompt: 'Add a dark mode toggle' }),
    hook('PreToolUse', { tool_name: 'Read', tool_use_id: 'tu-1', tool_input: { file_path: 'src/theme.ts' } }),
    hook('PostToolUse', { tool_name: 'Read', tool_use_id: 'tu-1', tool_input: { file_path: 'src/theme.ts' }, tool_response: {} }),
  ]) {
    expect(await town.sendHook(payload)).toMatchObject({ code: 0, stdout: '' });
  }
  await expect(page.locator('[data-testid="crew"][data-session-id="e2e-session"]')).toBeAttached();
  await expect(page.locator('[data-testid="agent-row"][data-agent-key="e2e-session:main"]')).toBeAttached();
  await expect(page.locator('[data-testid="agent-row"]').first()).toContainText('Foreman');
  expect(await page.getByTestId('log-entry').count()).toBeGreaterThan(0);
});

for (const decision of /** @type {const} */ (['allow', 'deny'])) {
  test(`a permission prompt can be answered from the town (${decision})`, async ({ page }) => {
    await signIn(page);
    await enableRemoteApprovals(page);
    const pendingHook = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }));
    const card = page.getByTestId('approval-card').first();
    await expect(card).toBeAttached();
    // The approvals panel may sit behind a tab of the HUD's board.
    if (!(await card.isVisible())) await page.getByRole('tab', { name: /Approvals/ }).click();
    await expect(card).toBeVisible();
    await card.getByTestId(decision === 'allow' ? 'approve' : 'deny').click();
    const result = await pendingHook;
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(output.hookSpecificOutput.decision.behavior).toBe(decision);
  });
}

test('a click meant for one request cannot answer another that just slid under the pointer', async ({ page }) => {
  await signIn(page);
  await enableRemoteApprovals(page);
  const first = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  const cards = page.getByTestId('approval-card');
  await expect(cards).toHaveCount(1);
  if (!(await cards.first().isVisible())) await page.getByRole('tab', { name: /Approvals/ }).click();
  const target = cards.first().getByTestId('approve');
  await expect(target).not.toHaveAttribute('aria-disabled', 'true');
  const box = await target.boundingBox();
  if (!box) throw new Error('the Allow button has no box');
  const firstId = await cards.first().getAttribute('data-approval-id');
  // A second request arrives and is listed first, right where the viewer is about to click.
  const second = town.sendHook(hook('PermissionRequest', { session_id: 'e2e-other', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }));
  await expect(cards).toHaveCount(2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  for (const card of await cards.all()) await expect(card).toHaveAttribute('data-status', 'pending');
  // Once the list has been still for a moment, a deliberate click answers the card it lands on.
  await page.locator(`[data-testid="approval-card"]:not([data-approval-id="${firstId}"])`).getByTestId('deny').click();
  await page.locator(`[data-testid="approval-card"][data-approval-id="${firstId}"]`).getByTestId('deny').click();
  for (const pending of [first, second]) expect(JSON.parse((await pending).stdout).hookSpecificOutput.decision.behavior).toBe('deny');
});

test('with --notify-url, Settings shows the phone topic and sends a test', async ({ page }) => {
  await town.stop();
  town = await startTown({ args: ['--notify-url', 'http://127.0.0.1:9/e2e-topic'] });
  await signIn(page);
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('phone-notify-text')).toContainText('On. Install the free ntfy app');
  await expect(page.getByText('http://127.0.0.1:9/e2e-topic')).toBeVisible();
  await page.getByTestId('phone-notify-test').click();
  // Nothing listens on port 9, so the server says it could not send it.
  await expect(page.getByText('The test notification was not sent')).toBeVisible({ timeout: 10_000 });
});
