#!/usr/bin/env node
// Dead-code check that lint and tsc cannot do: exports nobody imports.
//   dead        exported, never imported, never used in its own file      → fails the check
//   test-only   imported only by tests, unused by the app and its own file → reported
//   private     never imported but used inside its own file (drop `export`) → reported
// Usage: node scripts/find-unused-exports.mjs [--verbose]
// The parser is regex-based and tuned to this codebase's style: ES modules, one statement per line
// start, no `export *`. Type-only references in JSDoc (`import('./x.js').Name`) count as uses.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Modules loaded through a computed path, which a static scan cannot follow. Each entry says
 * which file loads it, so the list stays honest.
 */
const COMPUTED_IMPORTS = [
  { file: 'public/js/sim/simulation.js', names: ['createSimulation'], by: 'server/cli/simulate.mjs' },
  { file: 'eslint.config.js', names: ['default'], by: 'eslint' },
  { file: 'mods/andary-limits/hooks/register.js', names: ['register'], by: 'Claude Code, which loads the mod (hooks.json)' },
  { file: 'playwright.config.mjs', names: ['default'], by: 'playwright' },
];

const isTest = (/** @type {string} */ file) => file.startsWith('test/') || file.startsWith('e2e/');

/** Tracked and untracked files, minus those deleted or moved in the working tree but not yet staged. */
function sourceFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(m?js)$/.test(f) && !f.startsWith('node_modules/') && !f.startsWith('public/vendor/'))
    .filter((f) => existsSync(join(root, f)));
}

/** @param {string} from importing file (repo-relative) @param {string} spec */
function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  return normalize(relative(root, resolve(root, dirname(from), spec.split('?')[0]))).split('\\').join('/');
}

/** Names in `{ a, b as c, type d }` → the imported (left-hand) names. @param {string} list */
function namesIn(list) {
  return list
    .split(',')
    .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
    .filter((name) => /^\w+$/.test(name));
}

/** @param {string} text */
function declaredExports(text) {
  const names = new Set();
  const patterns = [
    /^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm,
    /^export\s+(?:const|let|var)\s+(\w+)/gm,
    /^export\s+class\s+(\w+)/gm,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias && /^\w+$/.test(alias)) names.add(alias);
    }
  }
  if (/^export\s+default\b/m.test(text)) names.add('default');
  return names;
}

/**
 * Every (module, name) a file uses from another module. `'*'` means "all of its exports".
 * @param {string} file @param {string} text
 * @returns {{target: string, names: string[] | '*'}[]}
 */
function importsOf(file, text) {
  /** @type {{target: string, names: string[] | '*'}[]} */
  const uses = [];
  const add = (/** @type {string} */ spec, /** @type {string[] | '*'} */ names) => {
    const target = resolveSpec(file, spec);
    if (target) uses.push({ target, names });
  };
  for (const m of text.matchAll(/^import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const clause = m[1].trim();
    const named = clause.match(/\{([^}]*)\}/);
    if (named) add(m[2], namesIn(named[1]));
    if (/^\w+\s*(,|$)/.test(clause)) add(m[2], ['default']);
    const ns = clause.match(/\*\s+as\s+(\w+)/);
    if (ns) add(m[2], membersOf(text, ns[1]));
  }
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm)) add(m[2], namesIn(m[1]));
  for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[2], namesIn(m[1]));
  for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[2], membersOf(text, m[1]));
  for (const m of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)\.(\w+)/g)) add(m[1], [m[2]]);
  return uses;
}

/** Members read from a namespace object; '*' if the object itself is passed around. @param {string} text @param {string} ns */
function membersOf(text, ns) {
  const members = [...text.matchAll(new RegExp(`\\b${ns}\\.(\\w+)`, 'g'))].map((m) => m[1]);
  const bareUses = [...text.matchAll(new RegExp(`\\b${ns}\\b(?!\\s*\\.)`, 'g'))].length;
  // One bare use is the import itself; any other means the whole namespace escapes.
  return bareUses > 1 ? '*' : members;
}

/**
 * Uses of a name inside its own file, beyond declaring and exporting it. Only the declaration
 * itself is discounted: `export function f(max = LIMIT)` is a real use of LIMIT.
 * @param {string} text @param {string} name
 */
function usesInOwnFile(text, name) {
  const count = (/** @type {string} */ pattern) => [...text.matchAll(new RegExp(pattern, 'gm'))].length;
  const declaration = `(?:async\\s+)?(?:function\\s*\\*?|const|let|var|class)\\s*${name}\\b`;
  const listed = [...text.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)].filter((m) => namesIn(m[1]).includes(name)).length;
  // A name exported through `export { name }` is declared on its own line, without `export`.
  const localDeclaration = listed ? count(`^${declaration}`) : 0;
  return count(`\\b${name}\\b`) - count(`^export\\s+${declaration}`) - listed - localDeclaration;
}

const files = sourceFiles();
const texts = new Map(files.map((f) => [f, readFileSync(join(root, f), 'utf8')]));
/** @type {Map<string, Set<string>>} key `file#name` → importing files */
const importers = new Map();
const mark = (/** @type {string} */ target, /** @type {string} */ name, /** @type {string} */ by) => {
  const key = `${target}#${name}`;
  if (!importers.has(key)) importers.set(key, new Set());
  importers.get(key).add(by);
};

for (const [file, text] of texts) {
  for (const use of importsOf(file, text)) {
    const names = use.names === '*' ? [...declaredExports(texts.get(use.target) ?? '')] : use.names;
    for (const name of names) mark(use.target, name, file);
  }
}
for (const entry of COMPUTED_IMPORTS) for (const name of entry.names) mark(entry.file, name, entry.by);

const dead = [];
const testOnly = [];
const needless = [];
for (const [file, text] of texts) {
  for (const name of declaredExports(text)) {
    const by = [...(importers.get(`${file}#${name}`) ?? [])];
    const internal = name !== 'default' && usesInOwnFile(text, name) > 0;
    if (by.length === 0 && !internal) dead.push(`${file}: ${name}`);
    else if (by.length === 0) needless.push(`${file}: ${name}`);
    else if (!isTest(file) && by.every(isTest) && !internal) testOnly.push(`${file}: ${name}  (${by.join(', ')})`);
  }
}

const verbose = process.argv.includes('--verbose');
const section = (/** @type {string} */ title, /** @type {string[]} */ list) => {
  console.log(`${title}: ${list.length}`);
  if (verbose || title.startsWith('Dead')) for (const line of list) console.log(`  ${line}`);
};
section('Dead exports (never imported or used)', dead);
section('Exports used only by tests', testOnly);
section('Exports used only inside their own file', needless);
if (dead.length) process.exit(1);
console.log('No dead exports.');
