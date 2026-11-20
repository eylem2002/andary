// A browser that cannot draw the 3D town: the panels carry everything, even on a static host where
// the town would otherwise fill the screen.
import { expect, test } from '@playwright/test';
import { startStatic, watchConsole } from './helpers/static.mjs';

/** @type {Awaited<ReturnType<typeof startStatic>>} */
let site;
/** @type {ReturnType<typeof watchConsole>} */
let problems;

// No WebGL at all: three.js cannot create a context, so the app falls back to the panels.
test.use({ launchOptions: { args: ['--disable-3d-apis'], executablePath: process.env.CHROME_PATH || undefined } });

test.beforeAll(async () => {
  site = await startStatic();
});

test.afterAll(async () => {
  await site?.stop();
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('without WebGL the side boards stay on screen, even on a static host or when put away before', async ({ page }) => {
  // Expected noise: the static host's 404 for /api/hello, and three.js reporting the missing context.
  problems = watchConsole(page, { ignore: [/Failed to load resource.*404/, /WebGL/i] });
  await page.addInitScript(() => localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true, panels: 'hidden' })));
  await page.goto(`${site.baseUrl}/`);
  await expect(page.getByRole('heading', { name: 'The 3D town could not start' })).toBeVisible({ timeout: 45_000 });
  const board = page.getByRole('complementary', { name: 'Town board' });
  await expect(board).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/hud-panels-hidden/);
  // No camera to direct and no town to fill the screen with: those buttons are not offered.
  await expect(page.locator('[data-tool="director"]')).toBeHidden();
  await expect(page.locator('[data-tool="toggle-panels"]')).toBeHidden();
  await page.keyboard.press('c');
  await page.keyboard.press('h');
  await expect(page.getByTestId('director-caption')).toBeHidden();
  await expect(board).toBeVisible();
});
