// The timeline under the town, end to end in the demo, on desktop and on a phone: lanes per
// agent, keyboard moves between moments, Enter goes to one, the list view, the phone's way in
// (Settings).
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
  await page.goto(`${site.baseUrl}/?demo=1&speed=4&seed=7&world=fake`);
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  await page.waitForFunction(() => /** @type {any} */ (window).__andary?.world);
}

/** @param {import('@playwright/test').Page} page */
async function axe(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

/** Opens the timeline where it is not shown by default (phones: from Settings). @param {import('@playwright/test').Page} page @param {boolean} mobile */
async function showTimeline(page, mobile) {
  const timeline = page.getByTestId('timeline');
  if (mobile) {
    await expect(timeline).toBeHidden();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByTestId('settings-timeline').click();
  }
  await expect(timeline).toBeVisible();
  return timeline;
}

test('the timeline: lanes per agent, keys move between moments, Enter goes to one', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await openDemo(page);
  const timeline = await showTimeline(page, mobile);
  // A lead with a few moments on its lane.
  const lane = timeline.locator('.hud-timeline__lane').first();
  await expect.poll(() => lane.locator('.hud-timeline__item').count(), { timeout: 60_000 }).toBeGreaterThan(2);

  // One tab stop; the arrow keys move along the lane.
  const stop = timeline.locator('.hud-timeline__item[tabindex="0"]');
  await expect(stop).toHaveCount(1);
  await stop.focus();
  await page.keyboard.press('Home');
  const first = await page.evaluate(() => document.activeElement?.getAttribute('data-item'));
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-item'))).not.toBe(first);
  await expect(timeline.locator('.hud-timeline__tip')).toBeVisible();

  // Enter goes to the moment: its agent's details say what it was.
  await page.keyboard.press('Enter');
  const inspector = page.getByTestId('agent-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId('inspector-moment')).not.toBeEmpty();
  const diff = page.getByRole('dialog', { name: /^Changes to / });
  if (await diff.isVisible()) await page.keyboard.press('Escape');

  // The same items as a list.
  await timeline.getByTestId('timeline-list-toggle').click();
  await expect(timeline.getByTestId('timeline-list').getByRole('button').first()).toBeVisible();
  await timeline.getByRole('button', { name: 'Today' }).click();
  expect(await axe(page)).toEqual([]);

  // Closed with its own button (T on a keyboard).
  await timeline.getByRole('button', { name: 'Close the timeline' }).click();
  await expect(timeline).toBeHidden();
  if (!mobile) {
    await page.keyboard.press('t');
    await expect(timeline).toBeVisible();
  }
});
