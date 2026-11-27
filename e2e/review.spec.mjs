// The review queue, the resume and handoff card, and the standup export, end to end: a real
// server, the real hook forwarder, the HUD in a browser and the clipboard (CONTRACTS §8.1 test ids).
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

/** One crew's hooks. @param {string} session @param {string} cwd */
const crew = (session, cwd) => (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) =>
  ({ session_id: session, transcript_path: '/tmp/t.jsonl', cwd, permission_mode: 'default', hook_event_name: name, ...extra });

/** @param {(name: string, extra?: Record<string, unknown>) => Record<string, unknown>} c @param {string} file @param {string} id */
const edit = (c, file, id) => {
  const input = { file_path: file, old_string: 'if (user)', new_string: 'if (user && token)' };
  return [c('PreToolUse', { tool_name: 'Edit', tool_use_id: id, tool_input: input }), c('PostToolUse', { tool_name: 'Edit', tool_use_id: id, tool_input: input, tool_response: {} })];
};

/** @param {unknown[]} payloads */
async function send(payloads) {
  for (const payload of payloads) expect(await town.sendHook(payload)).toMatchObject({ code: 0 });
}

/** @param {import('@playwright/test').Page} page */
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());

test('review queue: R lists crews with unreviewed turns, warnings first; copy the diff, mark reviewed, kept on reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${town.loginUrl}&world=fake`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  const api = crew('e2e-session', '/work/api-server');
  const web = crew('e2e-other', '/work/web-app');
  await send([
    api('SessionStart', { source: 'startup' }),
    api('UserPromptSubmit', { prompt: 'Fix the login bug' }),
    ...edit(api, '/work/api-server/src/login.ts', 'e1'),
    api('Stop', { last_assistant_message: 'Fixed the login bug.' }),
    web('SessionStart', { source: 'startup' }),
    web('UserPromptSubmit', { prompt: 'Tidy the header' }),
    ...edit(web, '/work/web-app/src/header.tsx', 'e2'),
    web('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } }),
    web('Stop', { last_assistant_message: 'Header tidied, tests pass.' }),
  ]);
  const badge = page.getByTestId('review-count');
  await expect(badge).toHaveText('2');
  await expect(page.locator('[data-tool="review"]')).toHaveAttribute('aria-label', 'Review: 2 crews have turns to review');

  await page.keyboard.press('r');
  const dialog = page.getByTestId('review');
  await expect(dialog).toBeVisible();
  const cards = dialog.getByTestId('review-crew');
  await expect(cards).toHaveCount(2);
  // The crew whose turn said done without a test comes first, though it finished first.
  await expect(cards.nth(0)).toHaveAttribute('data-session-id', 'e2e-session');
  await expect(cards.nth(0).getByTestId('review-warnings')).toContainText('Said done, but no test ran this turn after the edits');
  await expect(cards.nth(0)).toContainText('src/login.ts');
  await expect(cards.nth(1)).toContainText('npm test: passed');
  await expect(cards.nth(1)).toContainText('No warnings in these turns.');
  const diff = cards.nth(0).getByTestId('review-diff');
  await expect(diff).toHaveText(/^git -C \/work\/api-server diff 'HEAD@\{\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\}'$/);
  await expect(cards.nth(0).getByTestId('review-status')).toHaveText('git -C /work/api-server status --short');
  await cards.nth(0).getByTestId('review-copy-diff').click();
  await expect.poll(() => clipboard(page)).toBe(await diff.textContent());

  await page.screenshot({ path: test.info().outputPath('review.png') });
  await cards.nth(0).getByTestId('review-mark').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.nth(0)).toHaveAttribute('data-session-id', 'e2e-other');
  // Focus moves on to the next crew's button.
  await expect(cards.nth(0).getByTestId('review-mark')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(badge).toHaveText('1');

  // Kept in this browser: a reload still knows what you reviewed.
  await page.reload();
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  await expect(badge).toHaveText('1');

  // A new turn of the reviewed crew brings it back, counted from your mark.
  await send([api('UserPromptSubmit', { prompt: 'Add a test' }), ...edit(api, '/work/api-server/test/login.test.ts', 'e3'), api('Stop', { last_assistant_message: 'Added.' })]);
  await expect(badge).toHaveText('2');
  await page.keyboard.press('R');
  await expect(dialog.locator('[data-session-id="e2e-session"] [data-testid="review-period"]')).toHaveText(/^1 turn since you marked it reviewed (just now|\d+s ago)$/);
  await dialog.getByTestId('review-mark').first().click();
  await expect(cards).toHaveCount(1);
  await dialog.getByTestId('review-mark').first().click();
  await expect(dialog.getByTestId('review-empty')).toHaveText('Nothing to review: every crew\'s finished turns are marked reviewed.');
  await page.keyboard.press('Escape');
  await expect(badge).toBeHidden();
});

test('resume and handoff in the agent details; Catch me up copies a standup for today', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${town.loginUrl}&world=fake`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
  const api = crew('e2e-session', '/work/api-server');
  await send([
    api('SessionStart', { source: 'startup' }),
    api('UserPromptSubmit', { prompt: 'Fix the login bug' }),
    api('PostToolUse', { tool_name: 'TodoWrite', tool_use_id: 't1', tool_input: { todos: [{ content: 'Find the bug', status: 'completed' }, { content: 'Add a test', status: 'pending' }] }, tool_response: {} }),
    ...edit(api, '/work/api-server/src/login.ts', 'e1'),
    api('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } }),
    api('Stop', { last_assistant_message: 'Fixed the login bug.' }),
  ]);
  await page.keyboard.press('1');
  const inspector = page.getByTestId('agent-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId('handoff-resume')).toHaveText('cd /work/api-server && claude --resume e2e-session');
  await inspector.getByTestId('handoff-copy-resume').click();
  await expect.poll(() => clipboard(page)).toBe('cd /work/api-server && claude --resume e2e-session');
  await inspector.getByTestId('handoff-copy').click();
  await expect.poll(() => clipboard(page)).toMatch(/^# Handoff: api-server\n/);
  const handoff = await clipboard(page);
  expect(handoff).toContain('## Goal\n\nFix the login bug\n');
  expect(handoff).toContain('- `src/login.ts` (+1 −1)');
  expect(handoff).toContain('- Last test: npm test: passed');
  expect(handoff).toContain('- [x] Find the bug\n- [ ] Add a test');
  expect(handoff).toMatch(/## Last messages\n\n- .+ UTC \(.+ turn\): Fixed the login bug\.\n$/);
  await inspector.getByText('Show the handoff').click();
  await expect(inspector.getByTestId('handoff-preview')).toContainText('# Handoff: api-server');
  await inspector.getByTestId('handoff-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('handoff.png') });

  await page.keyboard.press('Escape');
  await page.keyboard.press('w');
  const dialog = page.getByTestId('catch-up');
  await expect(dialog.getByTestId('catch-up-crew')).toContainText('api-server: 1 turn, tests passing, 1 file changed');
  await dialog.getByTestId('catch-up-scope-today').click();
  await expect(dialog.getByTestId('catch-up-period')).toHaveText(/^Today(, since midnight|\. The town only remembers since \d\d:\d\d \(it restarted\))\.$/);
  await expect(dialog.getByTestId('catch-up-scope-today')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByTestId('catch-up-crew')).toContainText('api-server: 1 turn, tests passing, 1 file changed');
  await dialog.getByTestId('catch-up-copy').click();
  await expect.poll(() => clipboard(page)).toMatch(/^# Standup: /);
  expect(await clipboard(page)).toContain('## api-server\n\n- 1 turn, tests passing, 1 file changed\n- Last turn: Fixed the login bug.');
  await dialog.getByText('Show the Markdown').click();
  await page.screenshot({ path: test.info().outputPath('standup.png') });
});
