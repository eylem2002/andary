// A busy town: ten crews on the crews board (urgent first, ended ones folded, finished helpers
// folded, headers that stay in view), a goal that survives "continue", the Ctrl-K command
// palette, the Settings order with Quiet town, and the activity log's search box.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { startStatic, watchConsole } from './helpers/static.mjs';

/** @type {Awaited<ReturnType<typeof startStatic>>} */
let site;
/** @type {string[]} */
let problems;

test.beforeAll(async () => {
  site = await startStatic();
});

test.afterAll(async () => {
  await site?.stop();
});

test.beforeEach(async ({ page }) => {
  problems = watchConsole(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('andary:prefs')) localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true, theme: 'light' }));
  });
});

test.afterEach(() => {
  expect(problems, 'console errors').toEqual([]);
});

/** @param {import('@playwright/test').Page} page */
async function openDemo(page) {
  await page.goto(`${site.baseUrl}/?demo=1&speed=1&seed=7&world=fake`);
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  await page.waitForFunction(() => /** @type {any} */ (window).__andary?.world);
}

/**
 * Ten crews of our own, as the server would deliver their hooks: e2e-0 asks for a permission,
 * e2e-1…e2e-3 are at work, e2e-4 and e2e-7 have ended, e2e-5 has six helpers, two of which
 * finished minutes ago, and the rest are idle after their turn.
 * @param {import('@playwright/test').Page} page
 */
async function tenCrews(page) {
  await page.evaluate(() => {
    const now = Date.now();
    let id = 990_000;
    const send = (/** @type {Record<string, unknown>} */ payload, ts = now) => /** @type {any} */ (window).__andary.store.ingest({ id: ++id, ts, rx: ts, event: { transcript_path: '/t.jsonl', permission_mode: 'default', ...payload } });
    const names = ['billing-api', 'docs-site', 'mobile-app', 'infra', 'search', 'auth', 'design-system', 'cli', 'data-jobs', 'web'];
    names.forEach((name, i) => {
      const at = (/** @type {Record<string, unknown>} */ p, ts = now) => send({ session_id: `e2e-${i}`, cwd: `/home/dev/code/${name}`, ...p }, ts);
      at({ hook_event_name: 'SessionStart', source: 'startup', model: 'claude-opus-5-5' }, now - 300_000);
      at({ hook_event_name: 'UserPromptSubmit', prompt: `Fix the flaky tests in ${name}` }, now - 290_000);
      if (i === 0) at({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm publish' } });
      else if (i <= 3) at({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: `t${i}` });
      else if (i === 4 || i === 7) at({ hook_event_name: 'SessionEnd', reason: 'other' });
      else if (i === 5) {
        for (let n = 0; n < 6; n++) {
          at({ hook_event_name: 'SubagentStart', agent_id: `h${n}`, agent_type: 'Explore' }, now - 250_000 + n);
          at({ hook_event_name: 'PreToolUse', agent_id: `h${n}`, agent_type: 'Explore', tool_name: 'Read', tool_input: { file_path: `/home/dev/code/auth/f${n}.js` }, tool_use_id: `r${n}` }, now - 240_000 + n);
        }
        at({ hook_event_name: 'SubagentStop', agent_id: 'h0', agent_type: 'Explore' }, now - 200_000);
        at({ hook_event_name: 'SubagentStop', agent_id: 'h1', agent_type: 'Explore' }, now - 190_000);
      } else at({ hook_event_name: 'Stop', last_assistant_message: 'Done.' }, now - 100_000);
    });
  });
}

/** Our crews on the board, in order. @param {import('@playwright/test').Page} page @param {string} list */
const order = (page, list) => page.locator(`${list} > [data-testid="crew"]`).evaluateAll((els) => els.map((el) => /** @type {HTMLElement} */ (el).dataset.sessionId).filter((id) => id?.startsWith('e2e-')));

test('ten crews: the one that needs you first, ended crews folded, finished helpers folded, numbers on 1–9', async ({ page, isMobile }) => {
  await openDemo(page);
  await tenCrews(page);
  const board = page.getByTestId('crew-list');
  if (isMobile) await page.getByRole('tab', { name: 'Crews' }).click();
  await expect(board.locator('[data-session-id="e2e-9"]')).toBeAttached();

  const live = await order(page, '.hud-lines:not(.hud-lines--ended)');
  expect(live[0]).toBe('e2e-0');
  expect(live.indexOf('e2e-1')).toBeLessThan(live.indexOf('e2e-6'));
  expect(live.indexOf('e2e-3')).toBeLessThan(live.indexOf('e2e-9'));
  expect(live).not.toContain('e2e-4');

  // The header counts the crews listed at work; the ended ones wait under "Ended (2)".
  const listed = await board.locator('.hud-lines:not(.hud-lines--ended) > [data-testid="crew"]').count();
  await expect(page.getByTestId('crew-count')).toHaveText(`${listed} active`);
  const ended = page.getByTestId('crews-ended-toggle');
  await expect(ended).toHaveText('Ended (2)');
  await expect(ended).toHaveAttribute('aria-expanded', 'false');
  await expect(board.locator('[data-session-id="e2e-4"]')).toHaveCount(0);
  await ended.click();
  await expect(ended).toHaveAttribute('aria-expanded', 'true');
  expect(await order(page, '.hud-lines--ended')).toEqual(expect.arrayContaining(['e2e-4', 'e2e-7']));
  await expect(board.locator('[data-session-id="e2e-4"] .hud-roundel')).toHaveText('');

  // Every crew at work has its own number, and an ended crew gave its number to a newer one.
  const numbers = await board.locator('.hud-lines:not(.hud-lines--ended) > [data-testid="crew"] .hud-line__head .hud-roundel').allTextContents();
  expect(new Set(numbers).size).toBe(numbers.length);
  expect(Math.max(...numbers.map(Number))).toBe(numbers.length);

  // Two of crew e2e-5's helpers finished minutes ago: they fold into "+2 finished".
  const auth = board.locator('[data-session-id="e2e-5"]');
  const finished = auth.getByTestId('crew-finished');
  await expect(finished).toHaveText('+2 finished');
  await expect(auth.getByTestId('agent-row')).toHaveCount(5);
  await finished.click();
  await expect(auth.getByTestId('agent-row')).toHaveCount(7);
  await expect(finished).toHaveText('Hide finished helpers');
});

test('the crews board opens at its top and keeps a crew\'s name in view while it scrolls', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop board');
  await openDemo(page);
  await tenCrews(page);
  const body = page.locator('#hud-crews-body');
  await expect(body.locator('[data-session-id="e2e-9"]')).toBeAttached();
  expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
  const head = body.locator('[data-session-id="e2e-5"] .hud-line__head');
  // Reading the list holds the crews' places; scroll the long crew's head past the top: it stays
  // there while its stations go under it.
  await body.hover();
  await body.evaluate((el, line) => {
    const target = /** @type {HTMLElement} */ (el.querySelector(`[data-session-id="${line}"]`));
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top + 60;
  }, 'e2e-5');
  const top = await body.evaluate((el) => el.getBoundingClientRect().top);
  const headBox = await head.boundingBox();
  expect(Math.abs((headBox?.y ?? 0) - top)).toBeLessThan(2);
  await page.screenshot({ path: test.info().outputPath('crews-board.png') });
});

/** Sends one hook to a crew of tenCrews. @param {import('@playwright/test').Page} page @param {string} session @param {Record<string, unknown>} payload */
async function crewHook(page, session, payload) {
  await page.evaluate(([sessionId, extra]) => {
    const now = Date.now();
    /** @type {any} */ (window).__andary.store.ingest({ id: 996_000 + Math.floor(Math.random() * 1000), ts: now, rx: now, event: { session_id: sessionId, cwd: '/home/dev/code/x', transcript_path: '/t.jsonl', permission_mode: 'default', ...extra } });
  }, /** @type {const} */ ([session, payload]));
}

test('a row clicked with the mouse does not hold the order once the pointer leaves; an ending crew waits under the pointer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop board, with a pointer');
  await openDemo(page);
  await tenCrews(page);
  const body = page.locator('#hud-crews-body');
  const row = body.locator('[data-session-id="e2e-6"]').getByTestId('agent-row');
  await row.click();
  const key = await row.getAttribute('data-agent-key');
  await page.mouse.move(800, 500);
  await crewHook(page, 'e2e-9', { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push -f' } });
  await expect.poll(async () => {
    const live = await order(page, '.hud-lines:not(.hud-lines--ended)');
    return live.indexOf('e2e-9') < live.indexOf('e2e-1');
  }).toBe(true);
  expect(await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.dataset.agentKey)).toBe(key);

  // Under the pointer, a crew that ends keeps its place, dimmed; it folds away once you leave.
  await body.hover();
  await crewHook(page, 'e2e-2', { hook_event_name: 'SessionEnd', reason: 'other' });
  const ending = body.locator('.hud-lines:not(.hud-lines--ended) > [data-session-id="e2e-2"]');
  await expect(ending).toHaveClass(/is-ended/);
  await expect(page.getByTestId('crews-ended-toggle')).toHaveText('Ended (2)');
  await page.mouse.move(800, 500);
  await expect(ending).toHaveCount(0);
  await expect(page.getByTestId('crews-ended-toggle')).toHaveText('Ended (3)');
});

test('a crew keeps its goal when the prompt is "continue"', async ({ page }) => {
  await openDemo(page);
  await tenCrews(page);
  await page.evaluate(() => {
    const now = Date.now();
    /** @type {any} */ (window).__andary.store.ingest({ id: 995_000, ts: now, rx: now, event: { session_id: 'e2e-1', cwd: '/home/dev/code/docs-site', hook_event_name: 'UserPromptSubmit', prompt: 'continue' } });
  });
  const goal = page.locator('[data-session-id="e2e-1"]').getByTestId('crew-goal');
  await expect(goal).toHaveText('Fix the flaky tests in docs-site');
});

test('Ctrl-K finds a crew, an agent or an action from the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a keyboard feature; phones use the search button');
  await openDemo(page);
  await tenCrews(page);
  await page.locator('body').click({ position: { x: 720, y: 450 } });
  await page.keyboard.press('Control+k');
  const palette = page.getByTestId('palette');
  await expect(palette).toBeVisible();
  const input = page.getByTestId('palette-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('role', 'combobox');

  const axe = await new AxeBuilder({ page }).include('#hud-palette').analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  await input.fill('design sys');
  const first = page.getByTestId('palette-option').first();
  await expect(first).toContainText('design-system');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('aria-activedescendant', /hud-palette-opt-0/);
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  const lead = await page.evaluate(() => /** @type {any} */ (window).__andary.store.getState().sessions.find((/** @type {any} */ s) => s.id === 'e2e-6').agentKeys[0]);
  await expect(page.locator(`[data-testid="agent-row"][data-agent-key="${lead}"]`)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('agent-inspector')).toBeVisible();

  // Actions: the arrow keys move, Enter runs. "Open approvals" shows the Approvals tab.
  await page.keyboard.press('Control+k');
  await input.fill('approvals');
  await expect(page.getByTestId('palette-option').first()).toContainText('Open approvals');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /Approvals/ })).toHaveAttribute('aria-selected', 'true');

  // A toggle says what it will do; Escape closes without doing anything.
  await page.keyboard.press('Control+k');
  await input.fill('quiet');
  await expect(page.getByTestId('palette-option').first()).toContainText('Turn quiet town on');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('andary:prefs') ?? '{}').quietTown)).toBe(true);
  await page.keyboard.press('Control+k');
  await input.fill('zzzzqqq');
  await expect(page.getByTestId('palette-option')).toHaveCount(0);
  await expect(palette).toContainText('Nothing matches');
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('the search button opens the palette too', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('palette-button').click();
  await expect(page.getByTestId('palette')).toBeVisible();
  await expect(page.getByTestId('palette-option').first()).toBeVisible();
});

test('Settings open on the work settings, with Quiet town; the looks come after', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('settings-button').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const groups = await dialog.locator('.hud-setting-group__title').allTextContents();
  expect(groups).toEqual(['Work', 'Sound and reading', 'Town and looks']);
  const quiet = dialog.getByRole('switch', { name: 'Quiet town' });
  await expect(quiet).not.toBeChecked();
  await quiet.check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('andary:prefs') ?? '{}').quietTown)).toBe(true);
  // The character comes after the work settings.
  const work = await dialog.getByRole('switch', { name: 'Notifications on this computer' }).boundingBox();
  const look = await dialog.getByLabel('Town look').boundingBox();
  expect((work?.y ?? 0)).toBeLessThan(look?.y ?? 0);
});

test('the activity log has a search box', async ({ page, isMobile }) => {
  await openDemo(page);
  await tenCrews(page);
  if (isMobile) await page.getByRole('tab', { name: 'Activity' }).click();
  else await page.getByRole('tab', { name: 'Activity' }).click();
  const search = page.getByTestId('log-search');
  await expect(search).toBeVisible();
  await search.fill('npm publish');
  const rows = page.getByTestId('log-entry');
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allTextContents()) expect(text.toLowerCase()).toContain('npm publish');
  await search.fill('zzzz nothing here');
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId('activity-log')).toContainText('Nothing in the log matches');
  await search.fill('');
  await expect(rows.first()).toBeVisible();
});
