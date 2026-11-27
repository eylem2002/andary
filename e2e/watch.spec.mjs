// Cost alerts and leftovers end to end (core/watch.js, server/leftovers.mjs): a real server
// reading a real transcript, the real hook forwarder, and the HUD in a browser.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startTown } from './helpers/town.mjs';

const PAGE_OPTIONS = 'world=fake';

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
  return { session_id: 'e2e-watch', transcript_path: '/tmp/t.jsonl', cwd: '/work/e2e-app', permission_mode: 'default', hook_event_name: name, ...extra };
}

/** @param {import('@playwright/test').Page} page */
async function signIn(page) {
  await page.goto(`${town.loginUrl}&${PAGE_OPTIONS}`);
  await expect(page.getByTestId('connection-status')).toContainText('Live');
}

test('a crew spending fast with no files changed: an alert on its row that counts, and Settings for it', async ({ page }) => {
  await signIn(page);
  const project = join(dirname(town.home), 'claude', 'projects', '-work-e2e-app');
  mkdirSync(project, { recursive: true });
  const transcript = join(project, 'e2e-watch.jsonl');
  const message = (/** @type {string} */ id, /** @type {number} */ input) =>
    `${JSON.stringify({ type: 'assistant', isSidechain: false, sessionId: 'e2e-watch', timestamp: new Date().toISOString(), requestId: `req_${id}`, message: { id, role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n`;
  writeFileSync(transcript, message('m1', 1000));
  const send = async (/** @type {string} */ name, /** @type {Record<string, unknown>} */ extra = {}) => expect(await town.sendHook(hook(name, { transcript_path: transcript, ...extra }))).toMatchObject({ code: 0 });
  await send('SessionStart', { source: 'startup', model: 'claude-opus-5-5' });
  await send('UserPromptSubmit', { prompt: 'Find why the build is slow' });
  const lead = page.locator('[data-testid="agent-row"][data-agent-key="e2e-watch:main"]');
  await expect(lead).toBeVisible();
  // The first total the town hears of is not spending; wait until it has it.
  await expect(page.getByTestId('crew-cost')).toBeVisible();
  // About $4.80 more, and no file changed.
  appendFileSync(transcript, message('m2', 1_200_000));
  await send('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm run build' }, tool_response: {} });
  const words = /^\$4\.\d\d \(estimate, 1\.2M tokens\) in the last 10 min, no files changed$/;
  await expect(lead.locator('.hud-station__doing')).toHaveText(words);
  await expect(lead).toHaveAttribute('data-need', 'alert');
  await expect(page.getByTestId('waiting-for-you')).toHaveAttribute('aria-label', /^1 needs you\. Next: \$4\./);
  await expect(page.getByTestId('log-entry').filter({ hasText: 'no files changed' })).toHaveCount(1);
  // Set aside: it stops counting.
  await page.getByTestId('dismiss-need').click();
  await expect(page.getByTestId('waiting-for-you')).toBeHidden();

  // Settings: the thresholds, kept by the server.
  await page.getByTestId('settings-button').click();
  const helpers = page.getByTestId('watch-helpers');
  await expect(helpers).toHaveValue('10');
  await helpers.fill('4');
  await helpers.press('Tab');
  const saved = join(town.home, 'watch.json');
  await expect.poll(() => (existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')).helpers : null)).toBe(4);
  await page.keyboard.press('Escape');
  for (let i = 0; i < 4; i += 1) await send('SubagentStart', { agent_id: `h${i}`, agent_type: 'Explore' });
  await expect(page.getByTestId('log-entry').filter({ hasText: 'Started 4 helpers this turn' })).toHaveCount(1);
  await expect(page.getByTestId('waiting-for-you')).toHaveAttribute('aria-label', '1 needs you. Next: Started 4 helpers this turn');
});

test('a dev server a session left running: its ended crew shows it with a command to copy, and nothing is stopped', async ({ page }) => {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    await signIn(page);
    await town.sendHook(hook('SessionStart', { source: 'startup' }));
    await town.sendHook(hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: `node dev-server.js --port ${port}`, run_in_background: true }, tool_response: {} }));
    await town.sendHook(hook('SessionEnd', { reason: 'prompt_input_exit' }));
    const crew = page.locator('[data-testid="crew"][data-session-id="e2e-watch"]');
    const block = crew.getByTestId('crew-leftovers');
    await expect(block).toBeVisible({ timeout: 10_000 });
    await expect(block.getByTestId('leftover')).toHaveAttribute('data-port', String(port));
    await expect(block).toContainText(`node dev-server.js --port ${port}`);
    await expect(block).toContainText(`kill $(lsof -t -iTCP:${port} -sTCP:LISTEN)`);
    await expect(block).toContainText('Andary never stops anything itself');
    await expect(page.getByTestId('log-entry').filter({ hasText: `Left running: node dev-server.js --port ${port} (port ${port})` })).toHaveCount(1);
    expect(server.listening).toBe(true);
    // A reload keeps it: the server sends it with the hello.
    await page.reload();
    await expect(block).toBeVisible();
    await block.getByTestId('leftovers-dismiss').click();
    await expect(block).toBeHidden();
  } finally {
    server.close();
  }
});
