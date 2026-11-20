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
  await page.addInitScript(() => localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true, theme: 'light' })));
});

test.afterEach(() => {
  expect(problems, 'console errors').toEqual([]);
});

/** @param {import('@playwright/test').Page} page @param {string} [extra] */
async function openDemo(page, extra = '') {
  await page.goto(`${site.baseUrl}/?demo=1&speed=4&seed=7&world=fake${extra}`);
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
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
  await expect(dialog.getByRole('table')).toHaveCount(1);
  await expect(dialog.locator('.hud-usage__bar')).toHaveCount(14);
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
