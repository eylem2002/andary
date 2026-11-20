#!/usr/bin/env node
// Lighthouse scores for desktop and mobile: node scripts/lighthouse.mjs [--url=<url>] [--runs=N]
// Starts a throwaway Andary server (demo mode, temp home) unless --url is given.
// Lighthouse runs through npx so its large dependency tree stays out of the project's lockfile.
// Note: in containers without a GPU, WebGL runs on SwiftShader (CPU), which depresses the
// performance score; accessibility, best-practices and SEO are unaffected.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIGHTHOUSE = 'lighthouse@13.6.0';
const flag = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const runs = Number(flag('runs', '1'));
const outDir = join(root, '.tmp', 'lighthouse');
mkdirSync(outDir, { recursive: true });

async function startServer() {
  const home = mkdtempSync(join(tmpdir(), 'tt-lh-'));
  const child = spawn(process.execPath, [join(root, 'bin', 'andary.mjs'), 'start', '--port', '0', '--no-open'], {
    env: { ...process.env, ANDARY_HOME: home },
    stdio: 'ignore',
  });
  const lock = join(home, 'server.json');
  for (let i = 0; i < 100 && !existsSync(lock); i++) await new Promise((r) => setTimeout(r, 100));
  if (!existsSync(lock)) throw new Error('Andary server did not start');
  const { port } = JSON.parse(readFileSync(lock, 'utf8'));
  return { url: `http://127.0.0.1:${port}/?demo=1`, stop: () => (child.kill(), rmSync(home, { recursive: true, force: true })) };
}

function audit(url, preset, run) {
  const out = join(outDir, `${preset}-${run}.json`);
  const args = [
    '-y', LIGHTHOUSE, url, '--quiet', '--output=json', `--output-path=${out}`,
    '--only-categories=performance,accessibility,best-practices,seo',
    '--chrome-flags=--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --no-sandbox',
    '--max-wait-for-load=60000',
  ];
  if (preset === 'desktop') args.push('--preset=desktop');
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`lighthouse failed for ${preset}`);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  return Object.fromEntries(Object.entries(report.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
}

const server = flag('url') ? { url: flag('url'), stop: () => {} } : await startServer();
try {
  for (const preset of ['desktop', 'mobile']) {
    for (let run = 1; run <= runs; run++) {
      const scores = audit(server.url, preset, run);
      console.log(`${preset} run ${run}: ${Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    }
  }
  console.log(`Reports: ${outDir}`);
} finally {
  server.stop();
}
