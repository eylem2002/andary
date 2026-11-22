// Walking your character, end to end in the demo (a small team town): walk mode by keyboard only,
// the "Walk to…" list and the line that says where you are, emotes, and on a phone a tap on the
// ground of the real 3D town. Each runs on desktop and on a phone unless it says otherwise.
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
  await page.addInitScript(() => localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true, theme: 'light', directorCam: 'off' })));
});

test.afterEach(() => {
  expect(problems, 'console errors').toEqual([]);
});

/** @param {import('@playwright/test').Page} page @param {string} [world] */
async function openDemo(page, world = '&world=fake') {
  await page.goto(`${site.baseUrl}/?demo=1&speed=4&seed=7${world}`);
  await page.waitForFunction(() => /** @type {any} */ (window).__andary?.world?.hasAgent('person:You'), null, { timeout: 60_000 });
}

/** The walks the world was asked to play for your character. @param {import('@playwright/test').Page} page */
function myWalks(page) {
  return page.evaluate(() => /** @type {any} */ (window).__andary.world.calls
    .filter((/** @type {any} */ c) => c.method === 'placePerson' && c.args[0] === 'person:You' && c.args[1].walk)
    .map((/** @type {any} */ c) => c.args[1].walk.path));
}

test('keyboard only: G walks, arrows step, "Walk to…" goes there, and the live region says where you are', async ({ page, isMobile }) => {
  await openDemo(page);
  const where = page.getByTestId('walk-where');
  await page.keyboard.press('g');
  const panel = page.getByRole('region', { name: 'Walk' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Walk mode' })).toHaveAttribute('aria-pressed', 'true');
  // The town takes the keyboard, and the line under the live region says where you stand.
  await expect(page.getByTestId('world')).toBeFocused();
  await expect(where).toHaveText('You are at your home.');
  await expect(where).toHaveAttribute('role', 'status');

  // W is a step here, not Catch me up; there is no street that way from home.
  await page.keyboard.press('w');
  await expect(where).toHaveText('You cannot walk that way.');
  await expect(page.getByRole('dialog', { name: /Catch me up/ })).toBeHidden();
  // One step a press, on the walking grid.
  await page.keyboard.press('d');
  await expect.poll(() => myWalks(page)).toHaveLength(1);
  const [[from, to]] = await myWalks(page);
  expect([to[0] - from[0], to[1] - from[1]]).toEqual([1, 0]);
  await expect(where).toHaveText('You are at the street.');

  // "Walk to…" is a plain list: buildings, homes and teammates.
  const list = page.getByLabel('Walk to');
  await expect(list.locator('optgroup')).toHaveCount(3);
  await expect(list.locator('option', { hasText: "Lina's home" })).toHaveCount(1);
  await list.focus();
  await list.selectOption({ label: 'Library' });
  await expect(where).toHaveText('Walking to the Library door…');
  await expect(where).toHaveText('You are at the Library door.', { timeout: 30_000 });

  // An emote shows over your figure (on a phone the emotes fold away with the phrases).
  if (isMobile) {
    await panel.getByText('Emotes, phrases and come look').focus();
    await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: 'Wave' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__andary.world.calls.some((/** @type {any} */ c) => c.method === 'emote' && c.args[0] === 'person:You' && c.args[1] === '👋'))).toBe(true);

  const results = await new AxeBuilder({ page }).include('[data-testid="walk-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // G again (from the town) ends walk mode.
  await page.getByTestId('world').focus();
  await page.keyboard.press('g');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: 'Walk mode' })).toHaveAttribute('aria-pressed', 'false');
});

test('a teammate\'s "come look" is a note with Go and Not now, and Settings can turn it off', async ({ page }) => {
  await openDemo(page);
  // The demo has no teammate who asks: the HUD's entry point for the server's look-ask stands in.
  const ask = () => page.evaluate(() => /** @type {any} */ (window).__andary.hud.lookAsked({ from: 'Lina', at: { building: 'library' } }));
  await ask();
  const note = page.locator('.hud-toast', { hasText: 'Lina asks you to come look' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('the Library');
  await note.getByRole('button', { name: 'Not now' }).click();
  await expect(note).toBeHidden();
  await ask();
  await note.getByRole('button', { name: 'Go' }).click();
  await expect(page.getByRole('region', { name: 'Library' })).toBeVisible();

  await page.getByTestId('settings-button').click();
  await page.getByRole('switch', { name: '"Come look" notes' }).click();
  await page.keyboard.press('Escape');
  await ask();
  await expect(note).toBeHidden();
});

test('on a phone, a tap on the ground of the 3D town walks there', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'tap to walk is the phone\'s way');
  test.setTimeout(120_000);
  await openDemo(page, '');
  await page.getByRole('button', { name: 'Walk mode' }).click();
  const where = page.getByTestId('walk-where');
  await expect(where).toHaveText('You are at your home.');
  // The step pad is there too, with 44 px targets.
  const step = /** @type {{ width: number, height: number }} */ (await page.getByRole('button', { name: 'Step up' }).boundingBox());
  expect(Math.min(step.width, step.height)).toBeGreaterThanOrEqual(44);
  // Tap the ground beside your figure (left of it, where the street runs past the homes).
  const at = /** @type {{ x: number, y: number }} */ (await page.evaluate(() => /** @type {any} */ (window).__andary.world.getScreenPosition('person:You')));
  const box = /** @type {{ x: number, y: number }} */ (await page.getByTestId('world').boundingBox());
  await page.touchscreen.tap(box.x + at.x - 70, box.y + at.y + 10);
  await expect(where).not.toHaveText('You are at your home.', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Boolean(/** @type {any} */ (window).__andary.world.crowd.agents.get('person:You')?.track)), { timeout: 10_000 }).toBe(true);
});
