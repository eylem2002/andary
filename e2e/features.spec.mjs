// The features added after the first release, end to end in the demo: file diffs in the
// inspector, and more as they arrive. Each runs on desktop and on a phone.
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
  // Only on a fresh page: a reload (a new town look) keeps what the test changed.
  await page.addInitScript(() => {
    if (!localStorage.getItem('andary:prefs')) localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true, theme: 'light' }));
  });
});

test.afterEach(() => {
  expect(problems, 'console errors').toEqual([]);
});

/** @param {import('@playwright/test').Page} page @param {string} [extra] */
async function openDemo(page, extra = '') {
  await page.goto(`${site.baseUrl}/?demo=1&speed=4&seed=7&world=fake${extra}`);
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  // The crews show before the world is built; some of these tests read the world's calls.
  await page.waitForFunction(() => /** @type {any} */ (window).__andary?.world);
}

test('an agent\'s edits open as a diff', async ({ page }) => {
  await openDemo(page);
  const key = await expect
    .poll(() => page.evaluate(() => Object.values(/** @type {any} */ (window).__andary.store.getState().agents).find((a) => a.changes?.length && a.status !== 'done')?.key ?? null), { timeout: 60_000 })
    .not.toBeNull()
    .then(() => page.evaluate(() => Object.values(/** @type {any} */ (window).__andary.store.getState().agents).find((a) => a.changes?.length && a.status !== 'done')?.key));
  await page.locator(`[data-agent-key="${key}"]`).click();
  const changes = page.getByTestId('agent-changes');
  await expect(changes).toBeVisible();
  await changes.getByRole('button').first().click();
  const dialog = page.getByRole('dialog', { name: /^Changes to / });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.hud-diff__line--add').first()).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  // Escape closes the dialog only: the inspector behind it stays open.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('agent-inspector')).toBeVisible();
});

test('crews show what they cost, and U opens the usage chart', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByTestId('crew-cost').first()).toHaveText(/^\$\d|<\$0\.01/, { timeout: 30_000 });
  // The crew's cost opens the usage chart (on a phone there is no U key).
  await page.getByTestId('crew-cost').first().click();
  const dialog = page.getByRole('dialog', { name: 'Usage' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/Today: \$/);
  await expect(dialog.locator('.hud-usage__bar')).toHaveCount(14);
  // The chart's numbers, for everyone, behind a disclosure.
  await dialog.getByText('Numbers by day').click();
  await expect(dialog.getByRole('table')).toBeVisible();
  await expect(dialog.getByRole('row')).toHaveCount(14);
  await expect(dialog).toContainText('The demo makes these numbers up');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('failures bring weather to the town, and Settings can turn it off', async ({ page }) => {
  await openDemo(page);
  const lastWeather = () => page.evaluate(() => {
    const calls = /** @type {any} */ (window).__andary.world.calls.filter((c) => c.method === 'setTownWeather');
    return calls.at(-1)?.args[0]?.kind ?? null;
  });
  // The demo's first crew chases a failing test, so rain (or worse) comes early.
  await expect.poll(lastWeather, { timeout: 60_000 }).toMatch(/rain|storm|rainbow|fog/);
  await page.getByTestId('settings-button').click();
  const toggle = page.getByTestId('weather-toggle');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(lastWeather, { timeout: 5000 }).toBe('clear');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('andary:prefs') ?? '{}').weather);
  expect(saved).toBe(false);
});

test('finished work grows the town: a new landmark rises with a toast', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('andary:demo-progress', '99'));
  await openDemo(page);
  const landmarks = () => page.evaluate(() => /** @type {any} */ (window).__andary.world.calls.filter((c) => c.method === 'setLandmarks').at(-1)?.args[0] ?? []);
  await expect.poll(landmarks).toContain('statue');
  // The next finished turn or helper is point 100: the Ferris wheel.
  await expect(page.locator('.hud-toast', { hasText: 'The town grew' })).toContainText('Ferris wheel', { timeout: 60_000 });
  await expect.poll(landmarks).toContain('wheel');
});

test('L opens the leaderboard: the town, records and the busiest agents', async ({ page }) => {
  await openDemo(page);
  await expect(page.getByTestId('agent-row').nth(2)).toBeAttached({ timeout: 45_000 });
  await page.locator('[data-tool="leaderboard"]').click();
  const dialog = page.getByRole('dialog', { name: 'Leaderboard' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('growth-text')).toContainText(/points\. Next: /);
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /\d+/);
  await expect(dialog).toContainText('Busy 9 days in a row.');
  await expect(page.getByTestId('leaderboard-ranks').getByRole('listitem').first()).toContainText('tool call');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('notifications on this computer can be turned on in Settings', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await openDemo(page);
  await page.getByTestId('settings-button').click();
  const toggle = page.getByTestId('desktop-notify-toggle');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByText('Notifications are on while the town is in the background.')).toBeVisible();
  await expect(toggle).toBeChecked();
  // The demo has no server, so the phone setting is not offered.
  await expect(page.getByTestId('phone-notify-text')).toBeHidden();
});

test('ambient sound has its own switch in Settings, kept for next time', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('settings-button').click();
  const toggle = page.getByTestId('ambient-toggle');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('andary:prefs') ?? '{}').ambient)).toBe(false);
  await page.keyboard.press('Escape');
  // Turning sound on (a gesture) must not throw, with or without the ambient bed.
  await page.keyboard.press('m');
});

test('Settings switches the town\'s look, which rebuilds the town', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('settings-button').click();
  const look = page.getByLabel('Town look');
  await expect(look).toHaveValue('coast');
  await expect(look.locator('option')).toHaveText(['Sunset coast', 'Snowy village', 'Neon city', 'Desert oasis', 'Amman old town']);
  const apply = page.getByTestId('apply-look');
  await expect(apply).toBeDisabled();
  // Choosing alone does not reload (arrow keys can browse the list); the button does.
  await look.selectOption('neon');
  await look.selectOption('snow');
  await expect(apply).toBeEnabled();
  await Promise.all([page.waitForEvent('load'), apply.click()]);
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('andary:prefs') ?? '{}').townLook)).toBe('snow');
  await page.getByTestId('settings-button').click();
  await expect(page.getByLabel('Town look')).toHaveValue('snow');
});

test('a teammate\'s crew carries their name, in the crews board and on its foreman', async ({ page }) => {
  await openDemo(page);
  const member = page.getByTestId('crew-member').filter({ hasText: 'Lina' });
  await expect(member).toBeVisible({ timeout: 60_000 });
  await expect(member).toContainText('Shared by Lina');
  const crew = page.locator('[data-testid="crew"]').filter({ has: member });
  await expect(crew.getByTestId('agent-row').first()).toContainText('Lina');
  // Your own crews have no badge.
  await expect(page.locator('[data-testid="crew"]').first().getByTestId('crew-member')).toBeHidden();
});

test('a Codex crew says so on the crews board', async ({ page }) => {
  await openDemo(page);
  // A Codex session as the server delivers it (CONTRACTS §4.12): the town reads it like any other.
  await page.evaluate(() => {
    const payload = { session_id: 'thr_e2e', transcript_path: '/t.jsonl', cwd: '/home/dev/code/cli-tool', permission_mode: 'default', hook_event_name: 'SessionStart', source: 'startup', model: 'gpt-5.3-codex', andary_source: 'codex' };
    /** @type {any} */ (window).__andary.store.ingest({ id: 999_001, ts: Date.now(), rx: Date.now(), event: payload });
  });
  const crew = page.locator('[data-testid="crew"][data-session-id="thr_e2e"]');
  await expect(crew.getByTestId('crew-agent')).toHaveText('Codex');
  await expect(crew).toContainText('GPT-5.3 Codex');
  await expect(page.locator('[data-testid="crew"]').first().getByTestId('crew-agent')).toBeHidden();
});

test('you choose your character in the "You" dialog: tiles by keyboard, outfits, Random, Undo, names and Save', async ({ page }) => {
  await openDemo(page);
  // The demo is a small team town: you and Lina, both at home.
  await page.waitForFunction(() => /** @type {any} */ (window).__andary.world.hasAgent('person:Lina') && /** @type {any} */ (window).__andary.world.hasAgent('person:You'));
  await page.getByTestId('settings-button').click();
  await page.getByTestId('open-character').click();
  const dialog = page.getByRole('dialog', { name: 'You' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select')).toHaveCount(0);
  const preview = dialog.getByRole('img', { name: /^Preview of your character/ });
  await expect(preview).toHaveAttribute('aria-label', /short hair/);

  // Tabs move with the arrow keys; each choice is a radio group of named picture tiles.
  await dialog.getByRole('tab', { name: 'Body' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: 'Hair' })).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('radio', { name: 'Curly', exact: true }).check();
  await expect(preview).toHaveAttribute('aria-label', /curly hair/);
  await dialog.getByRole('tab', { name: 'Body' }).click();
  const skin = dialog.getByRole('group', { name: /^Skin/ });
  await skin.getByRole('radio', { name: 'Peach' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(skin.getByRole('radio', { name: 'Sand' })).toBeChecked();
  await expect(preview).toHaveAttribute('aria-label', /sand skin/);
  await expect(dialog.getByText('Skin: Sand')).toBeVisible();

  await dialog.getByRole('tab', { name: 'Clothes' }).click();
  await dialog.getByRole('button', { name: 'Wizard' }).click();
  await expect(preview).toHaveAttribute('aria-label', /plum kimono/);
  await dialog.getByTestId('character-undo').click();
  await expect(preview).not.toHaveAttribute('aria-label', /kimono/);
  await dialog.getByTestId('character-random').click();
  await expect(dialog.getByTestId('character-status')).toContainText('New look:');
  await dialog.getByRole('tab', { name: 'Accessories' }).click();
  await dialog.getByRole('group', { name: /^Hat/ }).getByRole('radio', { name: 'Beanie' }).check();
  await dialog.getByRole('group', { name: /^Extra/ }).getByRole('radio', { name: 'Cape' }).check();
  await dialog.getByRole('group', { name: /^Pet/ }).getByRole('radio', { name: 'Dog' }).check();
  await dialog.getByRole('tab', { name: 'Home and names' }).click();
  // Lina's colour is hers: it cannot be chosen, and it says whose it is.
  await expect(dialog.getByRole('radio', { name: "Raspberry (Lina's)" })).toBeDisabled();
  await dialog.getByLabel('Your character\'s name').fill('Captain  <b>Sam</b>');
  await dialog.getByLabel('One name for all your agents').fill('Pixel');
  await dialog.getByTestId('character-save').click();
  await expect(dialog).toBeHidden();
  const spec = await page.evaluate(() => {
    const calls = /** @type {any} */ (window).__andary.world.calls.filter((/** @type {any} */ c) => c.method === 'updateAgent' && c.args[0] === 'person:You');
    return calls.at(-1)?.args[1];
  });
  expect(spec.person).toMatchObject({ hat: 'beanie', extra: 'cape', pet: 'dog' });
  expect(spec.name).toBe('Captain bSamb');
  // Your crews' agents take your one name; their role stays in their details.
  await expect(page.getByTestId('agent-row').filter({ hasText: 'Pixel' }).first()).toBeVisible();
  // Kept in this browser, so the next visit (or the host after a reset) gets it back.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('andary:profile') ?? 'null')?.look.extra)).toBe('cape');
});

test('the "You" dialog fits a phone, with 44 px tiles', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phone layout');
  await openDemo(page);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('open-character').click();
  const dialog = page.getByRole('dialog', { name: 'You' });
  await expect(dialog).toBeVisible();
  const viewport = /** @type {{ width: number }} */ (page.viewportSize());
  const box = /** @type {{ x: number, width: number }} */ (await dialog.boundingBox());
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  const swatch = /** @type {{ width: number, height: number }} */ (await dialog.locator('.hud-tile').first().boundingBox());
  expect(swatch.width).toBeGreaterThanOrEqual(44);
  expect(swatch.height).toBeGreaterThanOrEqual(44);
  await dialog.getByTestId('character-save').scrollIntoViewIfNeeded();
  await dialog.getByTestId('character-save').click();
  await expect(dialog).toBeHidden();
});
