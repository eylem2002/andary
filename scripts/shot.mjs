#!/usr/bin/env node
// Screenshot helper for visual checks: node scripts/shot.mjs <url> <out.png> [--wait=ms] [--size=WxH]
// Prints browser console errors so a broken page is obvious without opening the image.
import { chromium } from '@playwright/test';

const [url, out = 'shot.png', ...flags] = process.argv.slice(2);
if (!url) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [--wait=ms] [--size=WxH]');
  process.exit(2);
}
const option = (name, fallback) => flags.find((f) => f.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const [width, height] = option('size', '1440x900').split('x').map(Number);
const wait = Number(option('wait', '4000'));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
if (problems.length) console.log(problems.slice(0, 30).join('\n'));
