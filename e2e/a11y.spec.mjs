// Accessibility (WCAG 2.2 AA) with axe, on desktop and on a phone: the main view, the agent
// inspector, the dialogs and an approval card, in the light and the dark theme.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { startStatic, watchConsole } from './helpers/static.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

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
  // Scan a settled page: no toast mid-fade, no animation between two colours.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(() => {
  expect(problems, 'console errors').toEqual([]);
});

/**
 * Opens the demo with a fixed theme (the HUD is dark at night, so the clock must not decide).
 * @param {import('@playwright/test').Page} page
 * @param {{ theme?: 'light'|'dark', world?: 'fake' }} [options]
 */
async function openDemo(page, { theme = 'light', world } = {}) {
  await page.addInitScript((prefs) => localStorage.setItem('andary:prefs', prefs), JSON.stringify({ theme, setupSeen: true }));
  await page.goto(`${site.baseUrl}/?demo=1&speed=4&seed=7${world ? `&world=${world}` : ''}`);
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
}

/**
 * Runs axe and returns readable violations ("rule: selector, selector").
 * @param {import('@playwright/test').Page} page
 */
async function violations(page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((node) => node.target.join(' ')).slice(0, 6).join(' | ')}`);
}

for (const theme of /** @type {const} */ (['light', 'dark'])) {
  test(`main view has no violations (${theme})`, async ({ page }) => {
    await openDemo(page, { theme });
    await page.waitForTimeout(1500);
    expect(await violations(page)).toEqual([]);
  });
}

test('headings descend in order, on the phone too (where the Crews panel moves into a tab)', async ({ page }) => {
  await openDemo(page, { world: 'fake' });
  // heading-order is an axe best practice rather than a WCAG rule, so the scans above skip it.
  const results = await new AxeBuilder({ page }).withRules(['heading-order']).analyze();
  expect(results.violations.map((v) => v.nodes.map((node) => node.target.join(' ')))).toEqual([]);
});

test('agent inspector has no violations', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('agent-row').first().click();
  await expect(page.getByTestId('agent-inspector')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('help dialog has no violations', async ({ page }, testInfo) => {
  await openDemo(page, { theme: 'dark' });
  if (testInfo.project.name === 'mobile') {
    await page.getByTestId('settings-button').click();
    await page.getByRole('button', { name: 'Shortcuts and help' }).click();
  } else {
    await page.keyboard.press('Shift+?');
  }
  await expect(page.getByRole('dialog', { name: 'How Andary works' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('settings and setup dialogs have no violations', async ({ page }) => {
  await openDemo(page, { world: 'fake' });
  await page.getByTestId('settings-button').click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Use your own Claude Code' }).click();
  await expect(page.getByRole('dialog', { name: 'Run it with your own Claude Code' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('every visible control is at least 24 × 24 CSS pixels (WCAG 2.5.8)', async ({ page }) => {
  await openDemo(page, { world: 'fake' });
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, input, select, a[href], [role="tab"]'))
      .filter((el) => /** @type {HTMLElement} */ (el).offsetParent !== null)
      // A control inside its <label> is clicked through the label, so the label is the target.
      .map((el) => ({ el, box: (el.closest('label') ?? el).getBoundingClientRect() }))
      .filter(({ box }) => box.width < 24 || box.height < 24)
      .map(({ el, box }) => `${el.getAttribute('aria-label') || el.textContent?.trim() || el.id}: ${Math.round(box.width)}×${Math.round(box.height)}`),
  );
  expect(small).toEqual([]);
});

test('an approval card has no violations', async ({ page }) => {
  await openDemo(page, { theme: 'dark', world: 'fake' });
  await expect(page.locator('[data-testid="approval-card"][data-status="pending"]').first()).toBeAttached({ timeout: 60_000 });
  await page.getByRole('tab', { name: /^Approvals/ }).click();
  await expect(page.getByTestId('approve').first()).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
