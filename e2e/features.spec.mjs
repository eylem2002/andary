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
