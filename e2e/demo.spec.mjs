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

test('place labels sit on the buildings: names where they fit, more as you zoom in', async ({ page, isMobile }) => {
  test.skip(isMobile, 'zoom and P are keyboard shortcuts');
  await page.addInitScript(() => localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true, directorCam: 'off', panels: 'hidden' })));
  await page.goto(demoUrl());
  const signs = page.locator('.tt-sign[data-building]');
  await expect.poll(() => signs.count(), { timeout: 45_000 }).toBe(15);
  // A name shows as "full" (with its stat chip) or "name" (the chip waits for room).
  const selector = (/** @type {string} */ state) => (state === 'name' ? '.tt-sign[data-building]:is(.is-full, .is-name)' : `.tt-sign[data-building].is-${state}`);
  const count = (/** @type {string} */ state) => page.locator(selector(state)).count();
  // The whole town: the small places show just their icon.
  await expect.poll(() => count('icon'), { timeout: 30_000 }).toBeGreaterThan(0);
  const namesBefore = await count('name');
  for (let i = 0; i < 4; i++) await page.keyboard.press('+');
  await expect.poll(() => count('name'), { timeout: 10_000 }).toBeGreaterThan(namesBefore);
  await page.keyboard.press('0');
  await page.keyboard.press('p'); // always
  await expect.poll(() => count('icon'), { timeout: 10_000 }).toBe(0);
  await page.keyboard.press('p'); // off
  await expect.poll(async () => (await count('name')) + (await count('icon')), { timeout: 10_000 }).toBe(0);
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

test('the crews show before the 3D world is ready, and the town plays them once it is', async ({ page }) => {
  // Hold the world's module back, as a slow device would: the HUD must not wait for it.
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => (release = () => resolve(undefined)));
  await page.route('**/js/dev/fake-world.js', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(demoUrl('&world=fake'));
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  await openTab(page, 'Activity');
  await expect(page.getByTestId('log-entry').first()).toBeVisible();
  expect(await page.evaluate(() => /** @type {any} */ (window).__andary.world)).toBeNull();
  release();
  // The director plays what happened meanwhile: the first crew still arrives by bus.
  const firstArrival = () =>
    page.evaluate(() => /** @type {any} */ (window).__andary.world?.calls.find((/** @type {any} */ c) => c.method === 'addAgent')?.args[0].entrance ?? null);
  await expect.poll(firstArrival).toBe('bus');
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
  // Waiting for you: the page title (for a background tab) and a button that leads to it.
  await expect(page).toHaveTitle(/^\(\d+\) Andary$/);
  await page.getByTestId('waiting-for-you').click();
  await expect(page.getByRole('tab', { name: /^Approvals/ })).toHaveAttribute('aria-selected', 'true');
  await expect(card).toBeVisible();
  await expect(card.locator('.hud-approval__code')).toContainText('$ ');
  await expect(card).toContainText('left');
  await card.getByTestId('approve').click();
  await expect(card).toHaveAttribute('data-status', 'allowed');
  await expect(card).toContainText('Allowed from the town');
  await expect(card.getByTestId('approve')).toBeHidden();
});

test('a demo permission request can be allowed always, and the card names the rule first', async ({ page }) => {
  await page.goto(demoUrl('&world=fake'));
  const pending = page.locator('[data-testid="approval-card"][data-status="pending"]').first();
  await expect(pending).toBeAttached({ timeout: 60_000 });
  const id = await pending.getAttribute('data-approval-id');
  const card = page.locator(`[data-testid="approval-card"][data-approval-id="${id}"]`);
  await page.getByTestId('waiting-for-you').click();
  const always = card.getByTestId('approve-always');
  await expect(always).toBeVisible();
  // The literal rule and where it is kept, written out above the button and read as its description.
  const saves = /^Allow always saves the rule Bash\(.+\) for this project, only you\.$/;
  await expect(card.getByTestId('approve-always-rule')).toHaveText(saves);
  await expect(always).toHaveAccessibleDescription(saves);
  const rule = (await card.getByTestId('approve-always-rule').locator('code').textContent()) ?? '';
  await always.click();
  await expect(card).toHaveAttribute('data-status', 'allowed');
  await expect(card).toContainText(`Allowed; asked Claude Code to save ${rule} for this project, only you`);
  await expect(always).toBeHidden();
  await openTab(page, 'Activity');
  await expect(page.getByTestId('activity-log')).toContainText(`Allowed; asked to save ${rule}`);
});

test('a click on Allow always right after its card appears does not count', async ({ page }) => {
  await page.goto(demoUrl('&world=fake'));
  // The Approvals tab is open before any request, so a card is on screen the moment it arrives.
  await openTab(page, 'Approvals');
  const first = page.locator('[data-testid="approval-card"][data-status="pending"] [data-testid="approve-always"]').first();
  await first.waitFor({ state: 'visible', timeout: 60_000 });
  const { id, armed } = await first.evaluate((button) => ({
    id: button.closest('[data-approval-id]')?.getAttribute('data-approval-id') ?? '',
    armed: button.getAttribute('aria-disabled') === 'true',
  }));
  expect(armed, 'the card is still inside its one-second guard').toBe(true);
  const card = page.locator(`[data-testid="approval-card"][data-approval-id="${id}"]`);
  const always = card.getByTestId('approve-always');
  // A real pointer click, past Playwright's own wait for the button to be enabled.
  await always.click({ force: true });
  await page.waitForTimeout(300);
  await expect(card).toHaveAttribute('data-status', 'pending');
  await expect(card.locator('.hud-approval__result')).toBeHidden();
  // Once the guard is over, the same click counts.
  await always.click();
  await expect(card).toHaveAttribute('data-status', 'allowed');
});

test.describe('on a smaller laptop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the waiting-for-you button stays clickable while the approval toast is up', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a desktop layout');
    await page.goto(demoUrl('&world=fake'));
    const toast = page.locator('.hud-toast--approval');
    await expect(toast.first()).toBeVisible({ timeout: 60_000 });
    // A click on a covered element fails (another element would receive it).
    await page.getByTestId('waiting-for-you').click({ timeout: 5000 });
    await expect(page.getByRole('tab', { name: /^Approvals/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test('toolbar buttons drive the camera, time, sound and the demo', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'mobile';
  await page.goto(demoUrl('&world=fake'));
  await expect(page.getByTestId('agent-row').first()).toBeAttached({ timeout: 45_000 });
  await page.waitForFunction(() => /** @type {any} */ (window).__andary?.world);
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

  const board = page.getByRole('complementary', { name: 'Town board' });
  await tool('toggle-panels').click();
  await expect(tool('toggle-panels')).toHaveAttribute('aria-pressed', 'true');
  await expect(board).toBeHidden();
  await tool('toggle-panels').click();
  await expect(tool('toggle-panels')).toHaveAttribute('aria-pressed', 'false');
  await expect(board).toBeVisible();

  await expect(tool('director')).toHaveAttribute('aria-pressed', 'true');
  await tool('director').click();
  await expect(tool('director')).toHaveAttribute('aria-pressed', 'false');
  await tool('director').click();
  await expect(tool('director')).toHaveAttribute('aria-pressed', 'true');

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

test('without a server the town fills the screen, then offers the setup steps', async ({ page, context }) => {
  // The full 3D town loads twice here, at real-time demo speed: on a CPU renderer under load
  // that takes longer than the default.
  test.setTimeout(180_000);
  // A static host answers /api/hello with a 404, which Chrome logs: that one is expected here.
  problems = watchConsole(page, { ignore: [/Failed to load resource.*404/] });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${site.baseUrl}/`);
  await expect(page.getByTestId('connection-status')).toContainText('Demo');
  await expect(page.locator('html')).toHaveClass(/hud-panels-hidden/);
  await expect(page.getByRole('complementary', { name: 'Town board' })).toBeHidden();
  await expect(page.locator('[data-tool="toggle-panels"]')).toHaveAttribute('aria-pressed', 'true');

  const dialog = page.getByRole('dialog', { name: 'Run it with your own Claude Code' });
  await expect(dialog).toBeHidden();
  const offer = page.getByRole('button', { name: 'How to connect' });
  await expect(offer).toBeVisible({ timeout: 30_000 });
  await offer.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('npm install -g github:eylem2002/andary')).toBeVisible();
  await expect(dialog.getByText('andary install', { exact: true })).toBeVisible();
  const copy = dialog.locator('.hud-steps__step').first().getByRole('button');
  await copy.click();
  // The button says "Copied" for a moment only, which a busy software-rendered page can outlast, so
  // the clipboard itself is checked.
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('npm install -g github:eylem2002/andary');
  await dialog.getByRole('button', { name: 'Keep watching the demo' }).click();
  await expect(dialog).toBeHidden();
  // Seen once, it is not offered again.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('andary:prefs') ?? '{}').setupSeen)).toBe(true);

  // The boards come back with one press, and stay back on the next visit.
  await page.locator('[data-tool="toggle-panels"]').click();
  await expect(page.getByRole('complementary', { name: 'Town board' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('agent-row').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('html')).not.toHaveClass(/hud-panels-hidden/);
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
