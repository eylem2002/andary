import { defineConfig, devices } from '@playwright/test';

// WebGL needs a software rasterizer on CI machines and in containers without a GPU.
const chromiumArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// CHROME_PATH lets the suite use an installed Chrome when Playwright's own browser isn't downloaded.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Playwright's full Chromium in new headless mode, not its stripped "headless shell" (which
    // cannot grant notification permission, among other gaps): the same kind of browser as a
    // local CHROME_PATH run.
    channel: executablePath ? undefined : 'chromium',
    launchOptions: { args: chromiumArgs, executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
