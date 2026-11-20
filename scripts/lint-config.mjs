#!/usr/bin/env node
// Lints everything that is not JavaScript: JSON files, shell scripts, GitHub workflows and YAML.
// External linters are optional locally (skipped with an install hint) and installed in CI:
//   shellcheck (preinstalled on GitHub's Ubuntu runners), actionlint (its release archive) and yamllint
//   (`pip install --require-hashes -r .github/lint-requirements.txt`); CI pins both by hash.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('node_modules/') && !f.startsWith('public/vendor/'));

const failures = [];
const skipped = [];

for (const file of tracked.filter((f) => f.endsWith('.json'))) {
  try {
    JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  } catch (err) {
    failures.push(`${file}: invalid JSON (${err.message})`);
  }
}

/** Runs an external linter when installed; a missing tool is reported, not fatal. */
function runTool(tool, args, files, hint) {
  if (!files.length) return;
  const probe = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (probe.error) {
    skipped.push(`${tool} (${hint})`);
    return;
  }
  const result = spawnSync(tool, [...args, ...files], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) failures.push(`${tool} reported problems`);
}

const shellScripts = tracked.filter((f) => f.endsWith('.sh') || f.startsWith('.githooks/'));
runTool('shellcheck', [], shellScripts, 'apt/brew install shellcheck');
runTool('actionlint', [], tracked.filter((f) => f.startsWith('.github/workflows/')), 'pip install actionlint-py');
runTool('yamllint', ['-c', '.yamllint.yml'], tracked.filter((f) => /\.ya?ml$/.test(f)), 'pip install yamllint');

if (skipped.length) console.log(`Skipped (not installed): ${skipped.join(', ')}`);
if (failures.length) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`Config lint passed (${tracked.filter((f) => f.endsWith('.json')).length} JSON files, ${shellScripts.length} shell scripts).`);
