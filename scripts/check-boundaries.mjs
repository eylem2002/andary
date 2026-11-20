#!/usr/bin/env node
// Layer boundaries (docs/ARCHITECTURE.md): which part of the code may import which. Lint checks
// each file; this checks the shape of the whole: the hook forwarder stands alone, core is pure and
// shared, the server reuses only the pure core modules listed below, the HUD never reaches into
// the 3D world, and the world's environment and characters only meet in world.js.
// Runtime imports only: JSDoc `import('…')` type references are free to cross (they vanish at
// run time). Usage: node scripts/check-boundaries.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Core modules the server may import: pure, no DOM, no browser globals. */
export const SERVER_CORE = Object.freeze(['public/js/core/prices.js', 'public/js/core/growth.js', 'public/js/core/ids.js', 'public/js/core/dates.js', 'public/js/core/text.js']);

/**
 * Areas, most specific first: the first matching prefix wins.
 * @type {ReadonlyArray<[string, string]>}
 */
const AREAS = Object.freeze([
  ['bin/', 'cli'],
  ['server/cli/', 'cli'],
  ['server/', 'server'],
  ['hooks/', 'hooks'],
  ['scripts/', 'scripts'],
  ['public/js/main.js', 'main'],
  ['public/js/core/', 'core'],
  ['public/js/sources/', 'sources'],
  ['public/js/ui/', 'ui'],
  ['public/js/sim/', 'sim'],
  ['public/js/dev/', 'dev'],
  ['public/js/world/lab/', 'lab'],
  ['public/js/world/env/lab/', 'lab'],
  ['public/js/world/env/', 'env'],
  ['public/js/world/agents/', 'agents'],
  ['public/js/world/world.js', 'world'],
  ['public/js/world/layout.js', 'layout'],
]);

/**
 * What each area may import at run time: other areas, and bare module names (node:…, three).
 * @type {Readonly<Record<string, { areas: string[], bare: RegExp|null }>>}
 */
export const RULES = Object.freeze({
  cli: { areas: ['cli', 'server', 'sim', 'core'], bare: /^node:/ },
  server: { areas: ['server', 'core'], bare: /^node:/ },
  hooks: { areas: [], bare: /^node:/ },
  scripts: { areas: ['scripts', 'server', 'core'], bare: /./ },
  main: { areas: ['core', 'sources', 'ui', 'sim', 'dev', 'world'], bare: null },
  core: { areas: ['core'], bare: null },
  sources: { areas: ['sources', 'core'], bare: null },
  ui: { areas: ['ui', 'core'], bare: null },
  sim: { areas: ['sim'], bare: null },
  dev: { areas: ['dev', 'core'], bare: null },
  world: { areas: ['world', 'env', 'agents', 'layout', 'core'], bare: /^three(\/|$)/ },
  env: { areas: ['env', 'layout', 'core'], bare: /^three(\/|$)/ },
  agents: { areas: ['agents', 'layout', 'core'], bare: /^three(\/|$)/ },
  layout: { areas: ['core'], bare: null },
  lab: { areas: ['lab', 'world', 'env', 'agents', 'layout', 'core', 'dev'], bare: /^three(\/|$)/ },
});

/** Narrower rules on top of the area table. */
const EXTRA = Object.freeze([
  {
    // The server shares only pure core modules with the browser.
    applies: (/** @type {string} */ from, /** @type {string} */ to) => (areaOf(from) === 'server' || areaOf(from) === 'cli') && areaOf(to) === 'core',
    allowed: (/** @type {string} */ _from, /** @type {string} */ to) => SERVER_CORE.includes(to),
    why: 'the server may only use the pure core modules listed in SERVER_CORE',
  },
  {
    // The town's environment is reached through its facade only.
    applies: (/** @type {string} */ from, /** @type {string} */ to) => areaOf(from) === 'world' && areaOf(to) === 'env',
    allowed: (/** @type {string} */ _from, /** @type {string} */ to) => to === 'public/js/world/env/environment.js',
    why: 'world.js reaches the environment through environment.js only',
  },
]);

/**
 * @param {string} file  repo-relative, forward slashes
 * @returns {string|null}
 */
export function areaOf(file) {
  for (const [prefix, area] of AREAS) if (file === prefix || file.startsWith(prefix)) return area;
  return null;
}

/**
 * Runtime import specifiers of a module: static imports and re-exports, and dynamic imports with
 * a literal path. Comment lines (JSDoc type references) are skipped.
 * @param {string} text
 * @returns {string[]}
 */
export function importsOf(text) {
  const specs = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const match of trimmed.matchAll(/(?:^import\s[^'"]*?from\s*|^import\s*|^export\s[^'"]*?from\s*|\bimport\(\s*)['"]([^'"]+)['"]/g)) specs.push(match[1]);
  }
  return specs;
}

/**
 * The boundary violations among some files.
 * @param {{ file: string, text: string }[]} files  repo-relative paths with their content
 * @returns {{ file: string, spec: string, why: string }[]}
 */
export function violations(files) {
  /** @type {{ file: string, spec: string, why: string }[]} */
  const found = [];
  for (const { file, text } of files) {
    const area = areaOf(file);
    if (!area) continue;
    const rule = RULES[area];
    for (const spec of importsOf(text)) {
      if (!spec.startsWith('.')) {
        if (!rule.bare?.test(spec)) found.push({ file, spec, why: `${area} may not import packages (${spec})` });
        continue;
      }
      const target = normalize(join(dirname(file), spec)).split('\\').join('/');
      const targetArea = areaOf(target);
      if (!targetArea || !rule.areas.includes(targetArea)) {
        found.push({ file, spec, why: `${area} may not import ${targetArea ?? target}` });
        continue;
      }
      for (const extra of EXTRA) {
        if (extra.applies(file, target) && !extra.allowed(file, target)) found.push({ file, spec, why: extra.why });
      }
    }
  }
  return found;
}

function main() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.m?js$/.test(f) && areaOf(f) && existsSync(join(root, f)))
    .map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));
  const found = violations(files);
  console.log(`Checked ${files.length} files against ${Object.keys(RULES).length} layer rules.`);
  if (found.length === 0) {
    console.log('No boundary crossed.');
    return;
  }
  for (const v of found) console.log(`  ${v.file}: import '${v.spec}': ${v.why}`);
  console.log(`${found.length} boundary violation(s).`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
