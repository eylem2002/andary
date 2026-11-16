#!/usr/bin/env node
// Secret scanner for the working tree and the whole git history.
// Usage: node scripts/scan-secrets.mjs [--tree-only]
// Tests deliberately contain fake credentials (to prove redaction works); a match is ignored when
// the matched text itself says it is fake (EXAMPLE, FAKE, DUMMY, TEST, …), mirroring gitleaks'
// stopword approach. Private keys, like in gitleaks, count only as a whole block with a body, so
// a test that builds a fake key at runtime is not reported but a pasted real key always is.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Single-line credential formats. */
export const RULES = [
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { id: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'stripe-key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: 'generic-assignment', re: /\b[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_TOKEN|AUTH_TOKEN)[A-Z0-9_]*\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{16,}/ },
];

/**
 * A PEM private key: BEGIN line, at least 64 characters of body, END line. The body may hold only
 * what a key holds (base64, line breaks, PEM header punctuation, and literal "\n" escapes as in
 * a JSON service-account file), so code that builds a fake key at runtime does not match.
 */
const PRIVATE_KEY_BLOCK =
  /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----(?:\\[nr]|[A-Za-z0-9+/=\s:,.-]){64,}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g;

const STOPWORDS = /example|fake|dummy|test|sample|placeholder|redacted|xxxx|0000|abcdef|notreal|your[-_]/i;
const SKIP_PATHS = [/^node_modules\//, /^public\/vendor\//, /package-lock\.json$/, /\.(?:png|jpe?g|gif|woff2?|ico|pdf)$/];

/**
 * @param {string} text
 * @param {string} where  label for the findings, e.g. a path
 * @returns {{rule: string, where: string, snippet: string}[]}
 */
export function scanText(text, where) {
  const findings = [];
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      const match = line.match(rule.re);
      if (match && !STOPWORDS.test(match[0])) {
        findings.push({ rule: rule.id, where: `${where}:${i + 1}`, snippet: `${match[0].slice(0, 12)}…` });
      }
    }
  });
  // No stopwords here: a long base64 body can contain "test" or "0000" by chance.
  for (const match of text.matchAll(PRIVATE_KEY_BLOCK)) {
    const line = text.slice(0, match.index).split('\n').length;
    findings.push({ rule: 'private-key', where: `${where}:${line}`, snippet: `${match[0].slice(0, 12)}…` });
  }
  return findings;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

function scanTree() {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const findings = [];
  for (const file of files) {
    if (SKIP_PATHS.some((re) => re.test(file))) continue;
    const path = join(root, file);
    if (!existsSync(path)) continue;
    // Only regular files: an untracked symlink to a folder (say, a shared node_modules) is listed too.
    const info = statSync(path);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
    findings.push(...scanText(readFileSync(path, 'utf8'), file));
  }
  return { files: files.length, findings };
}

/**
 * Scans every line ever added in any commit on any ref, so deleted secrets are still caught.
 * Added lines are scanned per file and commit as one text, so multi-line keys are seen whole;
 * line numbers count added lines.
 */
function scanHistory() {
  const commits = git(['rev-list', '--all']).split('\n').filter(Boolean);
  const findings = [];
  for (const sha of commits) {
    /** @type {Map<string, string[]>} */
    const added = new Map();
    let file = '';
    for (const line of git(['show', '--format=', '--no-color', '--unified=0', sha]).split('\n')) {
      if (line.startsWith('+++ ')) file = line.startsWith('+++ b/') ? line.slice(6) : '';
      else if (line.startsWith('+') && file && !SKIP_PATHS.some((re) => re.test(file))) {
        if (!added.has(file)) added.set(file, []);
        added.get(file).push(line.slice(1));
      }
    }
    for (const [path, lines] of added) findings.push(...scanText(lines.join('\n'), `${sha.slice(0, 8)}:${path}`));
  }
  return { commits: commits.length, findings };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const tree = scanTree();
  const history = process.argv.includes('--tree-only') ? { commits: 0, findings: [] } : scanHistory();
  console.log(`Scanned ${tree.files} files in the working tree and ${history.commits} commits of history.`);
  const all = [...tree.findings, ...history.findings];
  for (const f of all) console.error(`  ${f.rule.padEnd(20)} ${f.where}  ${f.snippet}`);
  if (all.length) {
    console.error(`${all.length} possible secret(s) found.`);
    process.exit(1);
  }
  console.log('No secrets found.');
}
