// The town at night stays readable: at 23:00 in Amman (the owner's evening), in the worst weather,
// with agents arriving through the portal, the 3D view must never go dark. Samples the middle of
// the canvas (where the town is) several times and fails below a minimum brightness. Before the
// fix, a NaN in the portal beam's vertex alpha was spread by bloom over the whole frame and the
// canvas went blank (only the dark page showed); and the night itself was too dim to read.
import { expect, test } from '@playwright/test';
import { startStatic, watchConsole } from './helpers/static.mjs';

/**
 * Mean sRGB luma (0–255) of the middle of the town view must stay at least this. A blank canvas
 * shows the dark night page at ~15.
 */
const MIN_LUMA = 45;

/** @type {Awaited<ReturnType<typeof startStatic>>} */
let site;
/** @type {string[]} */
let problems;

test.use({ timezoneId: 'Asia/Amman' });

test.beforeAll(async () => {
  site = await startStatic();
});

test.afterAll(async () => {
  await site?.stop();
});

test.beforeEach(async ({ page, isMobile }) => {
  problems = watchConsole(page);
  // A MacBook picks high quality (bloom, the pass that spread the NaN); test machines often have
  // few cores and would pick low, so desktop asks for high. The phone keeps its own choice (low).
  const quality = isMobile ? 'auto' : 'high';
  // A small view: a software renderer (CI) draws far more frames per second.
  if (!isMobile) await page.setViewportSize({ width: 480, height: 300 });
  await page.addInitScript((q) => {
    localStorage.setItem('andary:prefs', JSON.stringify({ setupSeen: true, panels: 'hidden', directorCam: 'off', quality: q }));
  }, quality);
});

test.afterEach(() => {
  expect(problems, 'console errors').toEqual([]);
});

/**
 * Mean sRGB luma of the middle half of the town view, from a real screenshot (what the user sees).
 * @param {import('@playwright/test').Page} page
 */
async function townLuma(page) {
  const box = await page.locator('canvas.tt-world__canvas').boundingBox();
  if (!box) throw new Error('no town canvas');
  const clip = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25, width: box.width * 0.5, height: box.height * 0.5 };
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
    }
    return sum / n;
  }, png.toString('base64'));
}

/** @param {import('@playwright/test').Page} page @param {string} hhmm local time in Amman */
async function openTownAt(page, hhmm) {
  await page.clock.setFixedTime(new Date(`2026-11-22T${hhmm}:00+03:00`));
  await page.goto(`${site.baseUrl}/?demo=1&speed=4&seed=7`);
  await page.waitForFunction(() => /** @type {any} */ (window).__andary?.world?.getTimeOfDay);
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__andary.world.getTimeOfDay())).toBeCloseTo(Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3)) / 60, 1);
}

/**
 * Holds the worst weather (the demo's own weather driver is shut out, the sky eased at once) and
 * triggers portal arrivals directly; returns the darker of two samples taken while beams show.
 * @param {import('@playwright/test').Page} page
 */
async function darkestInStorm(page) {
  await page.evaluate(() => {
    const world = /** @type {any} */ (window).__andary.world;
    const set = world.setTownWeather;
    world.setTownWeather = () => {};
    set({ kind: 'storm', overcast: 1, rain: 1, fog: 1, rainbow: 0, storm: true });
  });
  let darkest = Infinity;
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => /** @type {any} */ (window).__andary.world.effect('portal', { building: 'hall' }));
    await page.waitForTimeout(400);
    darkest = Math.min(darkest, await townLuma(page));
  }
  return darkest;
}

test.describe.configure({ retries: 0 });

test('at 23:00 the town is night but readable, and stays so in a foggy storm with arrivals', async ({ page, isMobile }) => {
  // High quality (bloom) on CI's software GPU takes minutes a frame, so CI checks the phone's
  // quality only; the NaN filter in the bloom path has its own unit tests, and this desktop
  // check runs locally on a real GPU or SwiftShader.
  test.skip(Boolean(process.env.CI) && !isMobile, 'bloom on a software GPU is too slow for CI');
  test.setTimeout(240_000);
  await openTownAt(page, '23:00');
  const clear = await townLuma(page);
  expect(clear, 'clear night brightness').toBeGreaterThanOrEqual(MIN_LUMA);
  const storm = await darkestInStorm(page);
  expect(storm, 'darkest frame in a foggy night storm with portal arrivals').toBeGreaterThanOrEqual(MIN_LUMA);
});
