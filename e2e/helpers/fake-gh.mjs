// A stand-in for the GitHub CLI, for tests of PR and CI status (CONTRACTS §4.16): a `gh` program
// on a PATH of its own that answers `gh pr view --json …` with whatever the test last set, and
// writes down how it was called. No network, no account. A script with a `#!` line, so not on
// Windows (where Andary runs only gh.exe); tests that use it skip there.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.FAKE_GH_DIR;
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), prompt: process.env.GH_PROMPT_DISABLED || null }) + '\\n');
const answer = JSON.parse(fs.readFileSync(path.join(dir, 'answer.json'), 'utf8'));
if (answer.stdout) process.stdout.write(answer.stdout);
if (answer.stderr) process.stderr.write(answer.stderr);
process.exitCode = answer.code || 0;
`;

/**
 * @typedef {object} FakeGh
 * @property {string} bin   the folder to put first on the PATH
 * @property {Record<string, string>} env  PATH and FAKE_GH_DIR, for the town's environment
 * @property {(answer: { stdout?: string, stderr?: string, code?: number }) => void} answer  what the next runs print
 * @property {(view: Record<string, unknown>) => void} view  the next runs print this pull request
 * @property {() => { args: string[], cwd: string, prompt: string|null }[]} calls
 */

/**
 * @param {string} dir  an empty folder of the test's own
 * @returns {FakeGh}
 */
export function createFakeGh(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), SCRIPT);
  chmodSync(join(bin, 'gh'), 0o755);
  const answer = (/** @type {{ stdout?: string, stderr?: string, code?: number }} */ value) => writeFileSync(join(dir, 'answer.json'), JSON.stringify(value));
  answer({ stderr: 'no pull requests found for branch "main"', code: 1 });
  return {
    bin,
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_GH_DIR: dir },
    answer,
    view: (view) => answer({ stdout: JSON.stringify(view) }),
    calls: () => (existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []),
  };
}

/**
 * `gh pr view --json …` for a pull request whose checks are in a state.
 * @param {'pending'|'failing'|'passing'} state
 * @param {Record<string, unknown>} [extra]
 */
export function prView(state, extra = {}) {
  const check = (/** @type {string} */ name, /** @type {string} */ conclusion, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, status, conclusion });
  const rollup = {
    pending: [check('test', '', 'IN_PROGRESS'), check('lint', 'SUCCESS')],
    failing: [check('test (ubuntu-latest)', 'FAILURE'), check('lint', 'SUCCESS')],
    passing: [check('test (ubuntu-latest)', 'SUCCESS'), check('lint', 'SUCCESS')],
  }[state];
  return { number: 123, url: 'https://github.com/acme/api-server/pull/123', state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED', headRefName: 'feat/login', headRefOid: `sha-${state}`, statusCheckRollup: rollup, ...extra };
}
