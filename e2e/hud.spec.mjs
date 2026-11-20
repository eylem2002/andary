// Keyboard use of the HUD (shortcuts, toolbar, approvals, the log) against the stand-in world, whose
// recorded calls show what reached the 3D view; and the sign-in hint against a real server.
import { existsSync } from 'node:fs';
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

/** @param {import('@playwright/test').Page} page */
async function openDemo(page) {
  await page.addInitScript(() => localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true })));
  await page.goto(`${site.baseUrl}/?demo=1&speed=4&seed=7&world=fake`);
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
}

/** World methods called so far (the stand-in world records them). @param {import('@playwright/test').Page} page */
function worldCalls(page) {
  return page.evaluate(() => /** @type {any} */ (window).__andary.world.calls.map((/** @type {any} */ c) => [c.method, ...c.args]));
}

test.describe('keyboard', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard shortcuts are a desktop feature');

  test('shortcuts drive the camera, the time of day, sound and the demo', async ({ page }) => {
    await openDemo(page);
    await page.locator('body').click({ position: { x: 720, y: 450 } });
    for (const key of [']', '[', '+', '-', '0']) await page.keyboard.press(key);
    const calls = await worldCalls(page);
    expect(calls).toEqual(expect.arrayContaining([['rotateCamera', 1], ['rotateCamera', -1], ['resetCamera']]));
    const zooms = calls.filter(([method]) => method === 'zoomBy').map(([, factor]) => factor);
    expect(zooms.some((f) => f > 1) && zooms.some((f) => f < 1)).toBe(true);

    const time = page.locator('[data-tool="cycle-time"]');
    const before = await time.getAttribute('aria-label');
    await page.keyboard.press('n');
    await expect(time).not.toHaveAttribute('aria-label', before ?? '');
    await expect.poll(async () => (await worldCalls(page)).some(([method]) => method === 'setTimeOfDay')).toBe(true);

    await page.keyboard.press('m');
    await expect(page.locator('[data-tool="toggle-sound"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('m');
    await expect(page.locator('[data-tool="toggle-sound"]')).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press(' ');
    await expect(page.getByTestId('connection-status')).toContainText('paused');
    await page.keyboard.press(' ');
    await expect(page.getByTestId('connection-status')).not.toContainText('paused');
  });

  test('1–9 jump to a crew, F follows, Escape lets go', async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press('1');
    const inspector = page.getByTestId('agent-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('heading', { level: 2 })).toHaveText('Foreman');
    await page.keyboard.press('f');
    await expect(page.locator('[data-tool="follow"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await worldCalls(page)).toEqual(expect.arrayContaining([expect.arrayContaining(['focusAgent', expect.any(String), { follow: true }])]));
    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
    await expect(page.locator('[data-tool="follow"]')).toHaveAttribute('aria-pressed', 'false');
    expect((await worldCalls(page)).some(([method]) => method === 'stopFollow')).toBe(true);
  });

  test('? opens help and Escape closes it, returning focus', async ({ page }) => {
    await openDemo(page);
    await page.getByTestId('settings-button').focus();
    await page.keyboard.press('Shift+?');
    const help = page.getByRole('dialog', { name: 'How Andary works' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Jump to crew 1 to 9');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await expect(page.getByTestId('settings-button')).toBeFocused();
  });

  test('shortcuts pause while a form control has focus', async ({ page }) => {
    await openDemo(page);
    await page.getByRole('tab', { name: 'Activity' }).click();
    await page.getByLabel('Crew', { exact: true }).focus();
    await page.keyboard.press('m');
    await expect(page.locator('[data-tool="toggle-sound"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the toolbar is one tab stop with arrow keys and visible tooltips', async ({ page }) => {
    await openDemo(page);
    const follow = page.locator('[data-tool="follow"]');
    await follow.focus();
    await expect(follow.locator('.hud-tip')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    const rotate = page.locator('[data-tool="rotate-left"]');
    await expect(rotate).toBeFocused();
    await expect(rotate.locator('.hud-tip')).toBeVisible();
    await expect(rotate.locator('.hud-tip')).toContainText('Rotate left');
    await expect(follow).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(page.locator('[data-tool="help"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-tool="help"] .hud-tip')).toBeHidden();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('[data-tool]').filter({ has: page.locator(':focus') })).toHaveCount(0);
  });

  test('tabs, the log and an approval card work from the keyboard', async ({ page }) => {
    await openDemo(page);
    await page.keyboard.press('a');
    const approvalsTab = page.getByRole('tab', { name: /^Approvals/ });
    await expect(approvalsTab).toBeFocused();
    await expect(approvalsTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    const activityTab = page.getByRole('tab', { name: 'Activity' });
    await expect(activityTab).toHaveAttribute('aria-selected', 'true');

    const log = page.getByRole('list', { name: /Activity log/ });
    await log.focus();
    await page.keyboard.press('End');
    await expect(page.locator('.hud-log__row:focus')).toHaveCount(1);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('agent-inspector')).toBeVisible();

    const pending = page.locator('[data-testid="approval-card"][data-status="pending"]').first();
    await expect(pending).toBeAttached({ timeout: 60_000 });
    const id = await pending.getAttribute('data-approval-id');
    await approvalsTab.click();
    const card = page.locator(`[data-approval-id="${id}"]`);
    await card.focus();
    await page.keyboard.press('d');
    await expect(card).toHaveAttribute('data-status', 'denied');
    await expect(card).toContainText('Denied from the town');
  });
});

test('a building picked in the town shows its card, and its agents can be selected', async ({ page }) => {
  await openDemo(page);
  // The stand-in world can raise the same select event a click on a building sign does.
  await page.evaluate(() => /** @type {any} */ (window).__andary.world.emitSelect({ type: 'building', key: 'hall' }));
  const card = page.getByRole('region', { name: 'Town Hall' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Crews start here');
  await expect(card).toContainText(/visit|No visits yet/);
  await page.evaluate(() => /** @type {any} */ (window).__andary.world.emitSelect(null));
  await expect(card).toBeHidden();
});

test('a server without a token asks to sign in and still offers the demo', async ({ page }) => {
  test.skip(!existsSync(new URL('./helpers/town.mjs', import.meta.url)), 'needs e2e/helpers/town.mjs');
  const { startTown } = await import('./helpers/town.mjs');
  const town = await startTown();
  try {
    await page.goto(town.baseUrl);
    await expect(page.getByTestId('connection-status')).toContainText('Sign in');
    const hint = page.getByTestId('login-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Open the link printed in your terminal');
    await page.getByTestId('demo-button').click();
    await expect(page.getByTestId('connection-status')).toContainText('Demo');
    await expect(hint).toBeHidden();
    await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
    expect(new URL(page.url()).searchParams.get('demo')).toBe('1');
  } finally {
    await town.stop();
  }
});
