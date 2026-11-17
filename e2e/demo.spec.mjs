// Demo mode end to end, on desktop and on a phone: the simulation fills the town, the HUD's crews,
// log, tasks, inspector, approvals and toolbar all work, and nothing logs a console error.
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
});

test.afterEach(() => {
  expect(problems, 'console errors').toEqual([]);
});

/** Forced demo, fast and reproducible. @param {string} [extra] */
const demoUrl = (extra = '') => `${site.baseUrl}/?demo=1&speed=4&seed=7${extra}`;

/** @param {import('@playwright/test').Page} page @param {string} name */
async function openTab(page, name) {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

test('crews fill with agents, the log grows and tasks appear', async ({ page }) => {
  await page.goto(demoUrl());
  await expect(page.getByTestId('connection-status')).toContainText('Demo');
  const rows = page.getByTestId('agent-row');
  await expect.poll(() => rows.count(), { timeout: 45_000 }).toBeGreaterThanOrEqual(3);
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('[data-testid="crew"][data-session-id]').first()).toBeVisible();
  await expect(rows.first()).toContainText('Foreman');

  await openTab(page, 'Activity');
  const entries = page.getByTestId('log-entry');
  await expect(entries.first()).toBeVisible();
  const before = await entries.count();
  await expect.poll(() => entries.count(), { timeout: 30_000 }).toBeGreaterThan(before);

  await openTab(page, 'Tasks');
  await expect(page.getByTestId('task-item').first()).toBeVisible({ timeout: 45_000 });
});

test('the toolbar is placed above the board from the first frame (no layout shift)', async ({ page }) => {
  await page.addInitScript(() => {
    /** @type {any} */ (window).__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of /** @type {any[]} */ (list.getEntries())) {
        /** @type {any} */ (window).__shifts.push({ value: entry.value, nodes: entry.sources.map((/** @type {any} */ s) => s.node?.className ?? '') });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(demoUrl('&world=fake'));
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  const shifts = await page.evaluate(() => /** @type {any} */ (window).__shifts);
  expect(shifts.filter((/** @type {any} */ s) => s.nodes.some((/** @type {string} */ n) => String(n).includes('hud-toolbar')))).toEqual([]);
});

test('an agent row opens the inspector', async ({ page }) => {
  await page.goto(demoUrl());
  const row = page.getByTestId('agent-row').first();
  await expect(row).toBeVisible({ timeout: 45_000 });
  const name = (await row.locator('.hud-station__name').textContent())?.trim() ?? '';
  await row.click();
  const inspector = page.getByTestId('agent-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('heading', { level: 2 })).toHaveText(name);
  await expect(inspector).toContainText('Tools used');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(inspector).toBeHidden();
});

test('a demo permission request can be allowed from the town', async ({ page }) => {
  // The approval round trip does not involve the 3D view; without it the story runs at full pace
  // even on a software renderer.
  await page.goto(demoUrl('&world=fake'));
  const pending = page.locator('[data-testid="approval-card"][data-status="pending"]').first();
  await expect(pending).toBeAttached({ timeout: 60_000 });
  const id = await pending.getAttribute('data-approval-id');
  const card = page.locator(`[data-testid="approval-card"][data-approval-id="${id}"]`);
  await openTab(page, 'Approvals');
  await expect(card).toBeVisible();
  await expect(card.locator('.hud-approval__code')).toContainText('$ ');
  await expect(card).toContainText('left');
  await card.getByTestId('approve').click();
  await expect(card).toHaveAttribute('data-status', 'allowed');
  await expect(card).toContainText('Allowed from the town');
  await expect(card.getByTestId('approve')).toBeHidden();
});

test('toolbar buttons drive the camera, time, sound and the demo', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'mobile';
  await page.goto(demoUrl('&world=fake'));
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  const tool = (/** @type {string} */ id) => page.locator(`[data-tool="${id}"]`);

  await tool('rotate-left').click();
  await tool('rotate-right').click();
  await tool('reset-view').click();
  if (!phone) {
    await tool('zoom-in').click();
    await tool('zoom-out').click();
  }
  const calls = await page.evaluate(() => /** @type {any} */ (window).__andary.world.calls.map((/** @type {any} */ c) => c.method));
  expect(calls).toEqual(expect.arrayContaining(['rotateCamera', 'resetCamera', ...(phone ? [] : ['zoomBy'])]));

  await tool('follow').click();
  await expect(tool('follow')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('agent-inspector')).toBeVisible();
  await tool('follow').click();
  await expect(tool('follow')).toHaveAttribute('aria-pressed', 'false');

  const time = await tool('cycle-time').getAttribute('aria-label');
  await tool('cycle-time').click();
  await expect(tool('cycle-time')).not.toHaveAttribute('aria-label', time ?? '');

  await tool('toggle-sound').click();
  await expect(tool('toggle-sound')).toHaveAttribute('aria-pressed', 'true');
  await tool('toggle-sound').click();
  await expect(tool('toggle-sound')).toHaveAttribute('aria-pressed', 'false');

  await tool('pause').click();
  await expect(page.getByTestId('connection-status')).toContainText('paused');
  await tool('pause').click();
  await expect(page.getByTestId('connection-status')).not.toContainText('paused');

  await expect(tool('cycle-speed')).toHaveAccessibleName('Demo speed: 4×');
  await tool('cycle-speed').click();
  await expect(tool('cycle-speed')).toHaveAccessibleName('Demo speed: 1×');

  if (!phone) {
    await tool('toggle-quality').click();
    await expect(tool('toggle-quality')).toHaveAttribute('aria-pressed', 'false');
    await tool('help').click();
    const help = page.getByRole('dialog', { name: 'How Andary works' });
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
  }
});

test('without a server the demo starts by itself and offers the setup steps', async ({ page, context }) => {
  // A static host answers /api/hello with a 404, which Chrome logs: that one is expected here.
  problems = watchConsole(page, { ignore: [/Failed to load resource.*404/] });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${site.baseUrl}/`);
  const dialog = page.getByRole('dialog', { name: 'Run it with your own Claude Code' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('connection-status')).toContainText('Demo');
  await expect(dialog.getByText('npm install -g github:eylem2002/andary')).toBeVisible();
  await expect(dialog.getByText('andary install', { exact: true })).toBeVisible();
  const copy = dialog.locator('.hud-steps__step').first().getByRole('button');
  await copy.click();
  await expect(copy).toHaveText(/Copied|Press Ctrl\+C/);
  await dialog.getByRole('button', { name: 'Keep watching the demo' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('connection-status')).toContainText('Demo');
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  await expect(dialog).toBeHidden();
});

test('a forced demo (as `andary demo` opens it) offers the way back to the live town', async ({ page }) => {
  // Leaving reloads without ?demo=1; this static host has no server, so that check logs a 404.
  problems = watchConsole(page, { ignore: [/Failed to load resource.*404/] });
  await page.goto(demoUrl('&world=fake'));
  await page.getByTestId('settings-button').click();
  const leave = page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Leave the demo' });
  await expect(leave).toBeVisible();
  await leave.click();
  await expect(page).not.toHaveURL(/demo=1/);
});
