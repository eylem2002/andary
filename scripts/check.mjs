#!/usr/bin/env node
// One command for every quality gate: `npm run check` (full) or `npm run check:fast` (pre-push).
// Runs each step even after a failure so one run shows everything that needs fixing.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const fast = process.argv.includes('--fast');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

/** @type {{name: string, cmd: string, args: string[], full?: boolean, needsBrowser?: boolean}[]} */
const STEPS = [
  { name: 'Dependency audit (high/critical)', cmd: npm, args: ['audit', '--audit-level=high'], full: true },
  { name: 'Lint', cmd: npm, args: ['run', '--silent', 'lint'] },
  { name: 'Config lint (JSON, shell, workflows)', cmd: npm, args: ['run', '--silent', 'lint:config'] },
  { name: 'Typecheck', cmd: npm, args: ['run', '--silent', 'typecheck'] },
  { name: 'Dead code', cmd: npm, args: ['run', '--silent', 'deadcode'] },
  { name: 'Layer boundaries', cmd: npm, args: ['run', '--silent', 'boundaries'] },
  { name: 'Unit + integration tests', cmd: npm, args: ['run', '--silent', 'test'] },
  { name: 'Licences', cmd: npm, args: ['run', '--silent', 'licenses'] },
  { name: 'Secrets scan', cmd: npm, args: ['run', '--silent', 'secrets'] },
  { name: 'End-to-end + accessibility', cmd: npx, args: ['playwright', 'test'], full: true, needsBrowser: true },
];

/** Playwright either has its own Chromium download or is pointed at an installed Chrome. */
function browserAvailable() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return true;
  const probe = spawnSync(process.execPath, ['-e', "import('@playwright/test').then(m=>process.stdout.write(m.chromium.executablePath()))"], {
    encoding: 'utf8',
  });
  return probe.status === 0 && existsSync(probe.stdout.trim());
}

const results = [];
for (const step of STEPS) {
  if (fast && step.full) continue;
  if (step.needsBrowser && !browserAvailable()) {
    results.push({ name: step.name, status: 'SKIPPED', seconds: 0, note: 'no browser: run `npx playwright install chromium` or set CHROME_PATH' });
    continue;
  }
  console.log(`\n▶ ${step.name}`);
  const started = Date.now();
  const run = spawnSync(step.cmd, step.args, { stdio: 'inherit', shell: process.platform === 'win32' });
  results.push({ name: step.name, status: run.status === 0 ? 'PASS' : 'FAIL', seconds: (Date.now() - started) / 1000 });
}

console.log('\nSummary');
const nameWidth = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  const note = r.note ? `  (${r.note})` : '';
  console.log(`  ${r.status.padEnd(7)} ${r.name.padEnd(nameWidth)} ${r.seconds.toFixed(1).padStart(6)}s${note}`);
}
const failed = results.filter((r) => r.status === 'FAIL');
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${fast ? 'fast ' : ''}checks passed.`);
