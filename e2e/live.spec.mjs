// Live mode end to end: a real server, the real hook forwarder, and the HUD in a browser
// (CONTRACTS §8.1 test ids).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { HOOK_SOURCE } from '../server/config.mjs';
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

test('the context in use: the lead\'s row and the inspector read it from the transcript, a compaction clears it', async ({ page }) => {
  await signIn(page);
  // The town's own throw-away Claude Code folder (helpers/town.mjs), where transcripts are read.
  const project = join(dirname(town.home), 'claude', 'projects', '-work-e2e-app');
  mkdirSync(project, { recursive: true });
  const transcript = join(project, 'e2e-session.jsonl');
  const message = (/** @type {string} */ id, /** @type {Record<string, number>} */ usage, /** @type {number} */ ms) =>
    `${JSON.stringify({ type: 'assistant', isSidechain: false, sessionId: 'e2e-session', timestamp: new Date(ms).toISOString(), requestId: `req_${id}`, message: { id, role: 'assistant', model: 'claude-opus-5-5', usage } })}\n`;
  writeFileSync(transcript, message('msg_1', { input_tokens: 4, cache_creation_input_tokens: 1520, cache_read_input_tokens: 180_816, output_tokens: 312 }, Date.now() - 121_000));
  const send = async (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => expect(await town.sendHook(hook(name, { transcript_path: transcript, ...extra }))).toMatchObject({ code: 0 });
  await send('SessionStart', { source: 'startup', model: 'claude-opus-5-5' });
  await send('PostToolUse', { tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: { command: 'npm test' }, tool_response: {} });
  const lead = page.locator('[data-testid="agent-row"][data-agent-key="e2e-session:main"]');
  // On the lead's row, under its time: the crew's name keeps its room.
  await expect(lead.getByTestId('crew-context')).toHaveText('182k in context');
  await lead.click();
  const exact = page.getByTestId('agent-inspector').getByTestId('agent-context');
  await expect(exact).toHaveText('182,340 tokens in context, as of 2m ago.');
  // A compaction (PreCompact alone proves nothing): the old count no longer holds until the next message.
  await send('PreCompact', { trigger: 'manual', custom_instructions: '' });
  await send('PostCompact', { trigger: 'manual', compact_summary: 'Fixed the flaky test.' });
  await expect(lead.getByTestId('crew-context')).toHaveText('context compacted');
  // "just now" for ten seconds: a slow machine may already read "10s ago".
  await expect(exact).toHaveText(/^Context compacted (just now|\d0s ago); the new count comes with the next message\.$/);
  appendFileSync(transcript, message('msg_2', { input_tokens: 9, cache_creation_input_tokens: 23_000, cache_read_input_tokens: 8000, output_tokens: 40 }, Date.now()));
  await send('Stop', { last_assistant_message: 'Done.', stop_hook_active: false });
  await expect(lead.getByTestId('crew-context')).toHaveText('31k in context');
  await expect(exact).toHaveText(/^31,009 tokens in context, as of (just now|\d0s ago)\.$/);
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

test('a card that slides up when the one above goes back to the terminal takes no click at once', async ({ page }) => {
  await signIn(page);
  await enableRemoteApprovals(page);
  const lower = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  const cards = page.getByTestId('approval-card');
  await expect(cards).toHaveCount(1);
  // The request listed above it comes through a forwarder that Claude Code will cancel, which
  // hands the request back to the terminal.
  const upper = spawn(process.execPath, [HOOK_SOURCE], { env: { ...process.env, ANDARY_HOME: town.home }, stdio: ['pipe', 'ignore', 'ignore'] });
  upper.stdin.end(JSON.stringify(hook('PermissionRequest', { session_id: 'e2e-upper', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })));
  await expect(cards).toHaveCount(2);
  if (!(await cards.first().isVisible())) await page.getByRole('tab', { name: /Approvals/ }).click();
  const lowerCard = cards.filter({ hasText: '$ npm test' });
  const allow = lowerCard.getByTestId('approve');
  await expect(allow).not.toHaveAttribute('aria-disabled', 'true');
  const before = await allow.boundingBox();
  upper.kill('SIGKILL');
  // Its buttons and countdown hide, and the card below slides up into their place, still second.
  await cards.filter({ hasText: '$ rm -rf build' }).locator('.hud-approval__terminal').waitFor({ state: 'visible' });
  const box = await allow.boundingBox();
  if (!before || !box) throw new Error('the Allow button has no box');
  expect(box.y).toBeLessThan(before.y - 50);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await expect(lowerCard).toHaveAttribute('data-status', 'pending');
  // A moment later, the same click counts.
  await allow.click();
  expect(JSON.parse((await lower).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
});

test('a request that arrived while the Approvals tab was hidden takes no click for a moment once it opens', async ({ page }) => {
  await signIn(page);
  await enableRemoteApprovals(page);
  await page.getByRole('tab', { name: 'Activity' }).click();
  const pending = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  const card = page.getByTestId('approval-card');
  await expect(card).toHaveCount(1);
  await expect(card).toBeHidden();
  // Longer than the delay: only the tab opening can start it again.
  await page.waitForTimeout(1500);
  await page.getByRole('tab', { name: /Approvals/ }).click();
  const allow = card.getByTestId('approve');
  await expect(allow).toHaveAttribute('aria-disabled', 'true');
  await allow.click({ force: true });
  await page.waitForTimeout(300);
  await expect(card).toHaveAttribute('data-status', 'pending');
  await allow.click();
  expect(JSON.parse((await pending).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
});

test('a request that arrived while the side boards were put away takes no click for a moment once they are back', async ({ page }) => {
  await signIn(page);
  await enableRemoteApprovals(page);
  await page.getByRole('tab', { name: /Approvals/ }).click();
  const boards = page.locator('[data-tool="toggle-panels"]');
  await boards.click();
  await expect(boards).toHaveAttribute('aria-pressed', 'true');
  const pending = town.sendHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } }));
  const card = page.getByTestId('approval-card');
  await expect(card).toHaveCount(1);
  // Longer than the delay: only the boards coming back can start it again.
  await page.waitForTimeout(1500);
  await boards.click();
  await expect(boards).toHaveAttribute('aria-pressed', 'false');
  const allow = card.getByTestId('approve');
  await expect(allow).toHaveAttribute('aria-disabled', 'true');
  // Once the boards have slid into place, a click on Allow still waits.
  await page.locator('.hud-board').evaluate((board) => Promise.all(board.getAnimations().map((animation) => animation.finished)));
  await allow.click({ force: true });
  await page.waitForTimeout(300);
  await expect(card).toHaveAttribute('data-status', 'pending');
  await allow.click();
  expect(JSON.parse((await pending).stdout).hookSpecificOutput.decision.behavior).toBe('allow');
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
  // Its name starts with what it shows, then says where a click goes.
  await expect(button).toHaveAttribute('aria-label', '3 need you. Next: Asks: Which port should the dev server use?');
  await expect(button).toHaveAttribute('data-level', 'blocked');
  await expect(page).toHaveTitle('(3) Andary');
  const row = (/** @type {string} */ session) => page.locator(`[data-testid="agent-row"][data-agent-key="${session}:main"]`);
  await expect(row('e2e-session')).toContainText('Asks: Which port should the dev server use?');
  await expect(row('e2e-session')).toHaveAttribute('data-need', 'blocked');
  // A question blocks the agent: it cannot be set aside. A stop can.
  const dismiss = (/** @type {string} */ session) => page.locator(`.hud-stations__item:has([data-agent-key="${session}:main"]) [data-testid="dismiss-need"]`);
  await expect(dismiss('e2e-session')).toBeHidden();
  await dismiss('e2e-other').click();
  await expect(button).toHaveAttribute('aria-label', /^2 need you/);
  await expect(page).toHaveTitle('(2) Andary');

  // Most urgent first: the question, then the finished turn, then around again.
  await page.keyboard.press('i');
  await expect(row('e2e-session')).toHaveAttribute('aria-current', 'true');
  await expect(button).toHaveAttribute('aria-label', '2 need you. Next: Finished: All tests pass.');
  await button.click();
  await expect(row('e2e-third')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('agent-inspector')).toContainText('Finished: All tests pass.');
  await page.getByTestId('inspector-dismiss').click();
  await expect(button).toHaveAttribute('aria-label', /^1 needs you/);
  await expect(button).toHaveAttribute('data-level', 'blocked');

  // Answered in the terminal: nothing needs you, and the button goes.
  await town.sendHook(asks('PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_input: {}, tool_response: {} }));
  await expect(button).toBeHidden();
  await expect(page).toHaveTitle('Andary');
});

test('a crew whose npm test fails three times with nothing changed seems stuck, and counts', async ({ page }) => {
  await signIn(page);
  const failure = (/** @type {string} */ id) => hook('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: id, tool_input: { command: 'npm test 2>&1 | tail -40' }, error: 'Exit code 1\nFAIL test/app.test.js', is_interrupt: false });
  for (const payload of [hook('SessionStart', { source: 'startup' }), failure('t1'), failure('t2'), failure('t3')]) {
    expect(await town.sendHook(payload)).toMatchObject({ code: 0 });
  }
  const words = 'Seems stuck: `npm test` failed 3 times, nothing changed';
  const row = page.locator('[data-testid="agent-row"][data-agent-key="e2e-session:main"]');
  await expect(row).toContainText(words);
  await expect(row).toHaveAttribute('data-need', 'alert');
  const button = page.getByTestId('waiting-for-you');
  await expect(button).toHaveAttribute('aria-label', `1 needs you. Next: ${words}`);
  await expect(page).toHaveTitle('(1) Andary');
  await expect(page.getByTestId('log-entry').filter({ hasText: words })).toHaveCount(1);

  // An edit is progress: the alert ends, and nothing needs you.
  await town.sendHook(hook('PostToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: '/work/e2e-app/src/app.js', old_string: 'a', new_string: 'b' }, tool_response: {} }));
  await expect(button).toBeHidden();
  await expect(row).not.toContainText('Seems stuck');
});

test('two crews in one folder: an edit of the same file is a note on both rows, a write over it needs you', async ({ page }) => {
  await signIn(page);
  const crew = (/** @type {string} */ session) => (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => hook(name, { session_id: session, ...extra });
  const first = crew('e2e-first');
  const second = crew('e2e-second');
  const file = '/work/e2e-app/src/app.ts';
  /** @param {string} tool @param {string} id @param {Record<string, unknown>} input */
  const done = (tool, id, input) => ({ tool_name: tool, tool_use_id: id, tool_input: { file_path: file, ...input }, tool_response: {} });
  for (const payload of [
    first('SessionStart', { source: 'startup' }),
    second('SessionStart', { source: 'startup' }),
    first('PostToolUse', done('Edit', 'e1', { old_string: 'light', new_string: 'dark' })),
    second('PostToolUse', done('Edit', 'e2', { old_string: 'dark', new_string: 'dim' })),
  ]) {
    expect(await town.sendHook(payload)).toMatchObject({ code: 0 });
  }
  const row = (/** @type {string} */ session) => page.locator(`[data-testid="agent-row"][data-agent-key="${session}:main"]`);
  // An edit must match what is there: a note under what both agents do, and nothing counted.
  const note = 'Foreman (crew 2) edited src/app.ts, which Foreman (crew 1) changed just now';
  for (const session of ['e2e-first', 'e2e-second']) await expect(row(session).getByTestId('agent-note')).toHaveText(note);
  const button = page.getByTestId('waiting-for-you');
  await expect(button).toBeHidden();
  await row('e2e-second').click();
  const inspector = page.getByTestId('agent-inspector');
  await expect(inspector.getByTestId('inspector-note')).toHaveText(note);
  await expect(inspector.getByTestId('inspector-dismiss')).toBeHidden();

  // A write over the first crew's change needs you, on both rows.
  await town.sendHook(second('PostToolUse', done('Write', 'w1', { content: 'export const theme = "dim";' })));
  const words = 'Foreman (crew 2) wrote over src/app.ts, which Foreman (crew 1) changed just now';
  await expect(button).toHaveAttribute('aria-label', `1 needs you. Next: ${words}`);
  await expect(button).toHaveAttribute('data-level', 'alert');
  await expect(page).toHaveTitle('(1) Andary');
  for (const session of ['e2e-first', 'e2e-second']) {
    await expect(row(session)).toContainText(words);
    await expect(row(session)).toHaveAttribute('data-need', 'alert');
    await expect(row(session).getByTestId('agent-note')).toBeHidden();
  }
  await expect(inspector).toContainText(words);
  await expect(inspector.getByTestId('inspector-note')).toBeHidden();
  await expect(inspector.getByTestId('inspector-dismiss')).toBeVisible();
  await expect(page.getByTestId('log-entry').filter({ hasText: words })).toHaveCount(1);

  // Set aside from either row, it is gone from both.
  await page.locator('.hud-stations__item:has([data-agent-key="e2e-first:main"]) [data-testid="dismiss-need"]').click();
  await expect(button).toBeHidden();
  await expect(row('e2e-second')).not.toContainText(words);
});

test('catch me up: W shows what each crew did, crews that need you first, and remembers when you looked', async ({ page }) => {
  await signIn(page);
  const crew = (/** @type {string} */ session, /** @type {string} */ cwd) => (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => hook(name, { session_id: session, cwd, ...extra });
  const api = crew('e2e-session', '/work/api-server');
  const web = crew('e2e-other', '/work/web-app');
  const docs = crew('e2e-third', '/work/docs-site');
  const edit = { file_path: '/work/api-server/src/login.ts', old_string: 'if (user)', new_string: 'if (user && token)' };
  for (const payload of [
    api('SessionStart', { source: 'startup' }),
    api('UserPromptSubmit', { prompt: 'Fix the login bug' }),
    api('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: edit }),
    api('PostToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: edit, tool_response: {} }),
    api('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } }),
    api('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b2', tool_input: { command: 'git commit -am "Fix the login" && git push' }, tool_response: {} }),
    api('Stop', { last_assistant_message: 'Fixed the login bug and pushed it.' }),
    web('SessionStart', { source: 'startup' }),
    web('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_input: { questions: [{ question: 'Which port should the dev server use?' }] } }),
    docs('SessionStart', { source: 'startup' }),
  ]) {
    expect(await town.sendHook(payload)).toMatchObject({ code: 0 });
  }
  await expect(page.locator('[data-testid="crew"][data-session-id="e2e-third"]')).toBeAttached();

  await page.keyboard.press('w');
  const dialog = page.getByTestId('catch-up');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('catch-up-period')).toHaveText('Everything the town remembers, up to a day back.');
  const lines = dialog.getByTestId('catch-up-crew');
  await expect(lines).toHaveCount(2);
  // The crew that needs you first, with the way to what it needs; then what the other one did.
  await expect(lines.nth(0)).toHaveAttribute('data-session-id', 'e2e-other');
  await expect(lines.nth(0).getByTestId('catch-up-need')).toContainText('Asks: Which port should the dev server use?');
  await expect(lines.nth(1)).toContainText('api-server: 1 turn, tests passing, 1 commit pushed, 1 file changed');
  await expect(lines.nth(1)).toContainText('Last turn: Fixed the login bug and pushed it.');
  await expect(dialog.getByTestId('catch-up-quiet')).toHaveText('Quiet: docs-site.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The browser remembers what you saw: the next look starts there.
  await page.keyboard.press('W');
  await expect(dialog.getByTestId('catch-up-period')).toHaveText('Since you last looked, a moment ago.');
  await lines.nth(0).getByTestId('catch-up-need').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-testid="agent-row"][data-agent-key="e2e-other:main"]')).toHaveAttribute('aria-current', 'true');
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
