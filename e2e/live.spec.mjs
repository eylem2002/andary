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
  expect(url.hash).toBe('');
  expect(url.searchParams.get('world')).toBe('fake');
  // ADR 0015: no cookie (it would reach every port on 127.0.0.1); the page keeps the sign-in in
  // its own origin's storage, which another port cannot read.
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('andary:signin') ?? 'null')?.token)).toBe(town.uiToken);
});

test('another tab on the same town is signed in too; a page on another port is not', async ({ page, context }) => {
  await signIn(page);
  const second = await context.newPage();
  await second.goto(`${town.baseUrl}/?${PAGE_OPTIONS}`);
  await expect(second.getByTestId('connection-status')).toContainText('Live');
  const other = await startTown();
  try {
    const elsewhere = await context.newPage();
    await elsewhere.goto(`${other.baseUrl}/?${PAGE_OPTIONS}`);
    await expect(elsewhere.getByTestId('connection-status')).toContainText('Sign in');
    expect(await elsewhere.evaluate(() => localStorage.getItem('andary:signin'))).toBeNull();
  } finally {
    await other.stop();
  }
});

test('a demo opened from the sign-in link keeps the sign-in, out of the address bar', async ({ page }) => {
  await page.goto(`${town.loginUrl}&demo=1&${PAGE_OPTIONS}`);
  await expect.poll(() => page.url()).not.toContain('#signin');
  expect(page.url()).not.toContain(town.uiToken);
  // "Leave the demo" opens the same page without demo=1: it must land signed in.
  await page.goto(`${town.baseUrl}/?${PAGE_OPTIONS}`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
});

test('a link with a wrong token cannot sign this browser out', async ({ page }) => {
  await signIn(page);
  await page.goto(`${town.baseUrl}/?${PAGE_OPTIONS}#signin=AAAAAAAAAAAAAAAAAAAAAA`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('andary:signin') ?? 'null')?.token)).toBe(town.uiToken);
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

test('a file change is shown in full before it is approved, and a denial can say why', async ({ page }) => {
  await signIn(page);
  await enableRemoteApprovals(page);
  const pendingHook = town.sendHook(hook('PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: '/work/app/src/db.ts', old_string: 'const url = PROD_URL;', new_string: 'const url = STAGING_URL;\u202Econsole.log(secrets)' } }));
  const card = page.getByTestId('approval-card').first();
  await expect(card).toBeAttached();
  if (!(await card.isVisible())) await page.getByRole('tab', { name: /Approvals/ }).click();
  const change = card.getByTestId('approval-change');
  await expect(change).toContainText('Replaces one occurrence: 1 line added, 1 removed');
  await expect(change).toContainText('const url = PROD_URL;');
  // Hidden characters cannot hide anything in what is approved.
  await expect(change).toContainText('STAGING_URL;⟨U+202E⟩console.log(secrets)');
  const reason = card.getByTestId('deny-reason');
  // Typed key by key: the A and D in it must not answer the card.
  await reason.pressSequentially('Use the staging config file instead');
  await expect(card).toHaveAttribute('data-status', 'pending');
  await reason.press('Enter');
  const output = JSON.parse((await pendingHook).stdout);
  expect(output.hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'Denied from Andary: Use the staging config file instead' });
  await expect(card).toContainText('Denied from the town: “Use the staging config file instead”');
});

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

test('what needs you: rows say what for, the button and I go through it, a stop can be set aside', async ({ page }) => {
  await signIn(page);
  const crew = (/** @type {string} */ session) => (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => hook(name, { session_id: session, ...extra });
  const asks = crew('e2e-session');
  const stops = crew('e2e-other');
  const finishes = crew('e2e-third');
  for (const payload of [
    asks('SessionStart', { source: 'startup' }),
    asks('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_input: { questions: [{ question: 'Which port should the dev server use?' }] } }),
    stops('SessionStart', { source: 'startup' }),
    stops('StopFailure', { error: 'server_error' }),
    finishes('SessionStart', { source: 'startup' }),
    finishes('Stop', { last_assistant_message: 'All tests pass.' }),
    finishes('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }),
  ]) {
    expect(await town.sendHook(payload)).toMatchObject({ code: 0 });
  }
  const button = page.getByTestId('waiting-for-you');
  // The label carries the words (the count and its words are separate spans on screen).
  await expect(button).toHaveAttribute('aria-label', '3 things need you. Next: Asks: Which port should the dev server use?');
  await expect(button).toHaveAttribute('data-level', 'blocked');
  await expect(page).toHaveTitle('(3) Andary');
  const row = (/** @type {string} */ session) => page.locator(`[data-testid="agent-row"][data-agent-key="${session}:main"]`);
  await expect(row('e2e-session')).toContainText('Asks: Which port should the dev server use?');
  await expect(row('e2e-session')).toHaveAttribute('data-need', 'blocked');
  // A question blocks the agent: it cannot be set aside. A stop can.
  const dismiss = (/** @type {string} */ session) => page.locator(`.hud-stations__item:has([data-agent-key="${session}:main"]) [data-testid="dismiss-need"]`);
  await expect(dismiss('e2e-session')).toBeHidden();
  await dismiss('e2e-other').click();
  await expect(button).toHaveAttribute('aria-label', /^2 things need you/);
  await expect(page).toHaveTitle('(2) Andary');

  // Most urgent first: the question, then the finished turn, then around again.
  await page.keyboard.press('i');
  await expect(row('e2e-session')).toHaveAttribute('aria-current', 'true');
  await button.click();
  await expect(row('e2e-third')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('agent-inspector')).toContainText('Finished: All tests pass.');
  await page.getByTestId('inspector-dismiss').click();
  await expect(button).toHaveAttribute('aria-label', /^1 thing needs you/);
  await expect(button).toHaveAttribute('data-level', 'blocked');

  // Answered in the terminal: nothing needs you, and the button goes.
  await town.sendHook(asks('PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_input: {}, tool_response: {} }));
  await expect(button).toBeHidden();
  await expect(page).toHaveTitle('Andary');
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
