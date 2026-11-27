#!/usr/bin/env node
// Layer boundaries (docs/ARCHITECTURE.md): which part of the code may import which. Lint checks
// each file; this checks the shape of the whole: the hook forwarder stands alone, core is pure and
// shared, the server reuses only the pure core modules listed below, the HUD never reaches into
// the 3D world, the world's environment and characters only meet in world.js, and a Claude Code
// mod (mods/) stands alone: Claude Code copies only its folder and runs it with no Node.js APIs.
// Runtime imports only: JSDoc `import('…')` type references are free to cross (they vanish at
// run time). Usage: node scripts/check-boundaries.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Core modules the server may import: pure, no DOM, no browser globals. */
export const SERVER_CORE = Object.freeze([
  'public/js/core/prices.js',
  'public/js/core/growth.js',
  'public/js/core/ids.js',
  'public/js/core/dates.js',
  'public/js/core/text.js',
  'public/js/core/dialogs.js',
  'public/js/core/card-fields.js',
  'public/js/core/permission-rules.js',
  'public/js/core/loops.js',
  'public/js/core/shell.js',
  'public/js/core/summaries.js',
  'public/js/core/digest.js',
  'public/js/core/limits.js',
  'public/js/core/town-map.js',
  'public/js/core/profile.js',
  'public/js/core/presence.js',
  'public/js/core/notes.js',
  'public/js/core/watch.js',
  'public/js/core/leftovers.js',
]);

/**
 * Areas, most specific first: the first matching prefix wins.
 * @type {ReadonlyArray<[string, string]>}
 */
const AREAS = Object.freeze([
  ['cli/', 'cli'],
  ['server/cli/', 'cli'],
  ['server/', 'server'],
  ['hooks/', 'hooks'],
  ['mods/', 'mods'],
  ['scripts/', 'scripts'],
  ['public/js/main.js', 'main'],
  ['public/js/page.js', 'page'],
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
  mods: { areas: ['mods'], bare: null },
  scripts: { areas: ['scripts', 'server', 'core'], bare: /./ },
  main: { areas: ['core', 'page', 'sources', 'ui', 'sim', 'dev', 'world'], bare: null },
  page: { areas: ['core'], bare: null },
  core: { areas: ['core'], bare: null },
  sources: { areas: ['sources', 'core'], bare: null },
  ui: { areas: ['ui', 'page', 'core'], bare: null },
  sim: { areas: ['sim'], bare: null },
  dev: { areas: ['dev', 'core'], bare: null },
  world: { areas: ['world', 'env', 'agents', 'layout', 'core'], bare: /^three(\/|$)/ },
  env: { areas: ['env', 'layout', 'page', 'core'], bare: /^three(\/|$)/ },
  agents: { areas: ['agents', 'layout', 'core'], bare: /^three(\/|$)/ },
  layout: { areas: ['core'], bare: null },
  lab: { areas: ['lab', 'world', 'env', 'agents', 'layout', 'page', 'core', 'dev'], bare: /^three(\/|$)/ },
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
    // …and what those modules load comes with them, so it must be shared too.
    applies: (/** @type {string} */ from, /** @type {string} */ to) => SERVER_CORE.includes(from) && areaOf(to) === 'core',
    allowed: (/** @type {string} */ _from, /** @type {string} */ to) => SERVER_CORE.includes(to),
    why: 'a module the server shares may only import other modules listed in SERVER_CORE',
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

/** `import … from '…'` and `import '…'` at the start of a line; the names may span lines. */
const STATIC_IMPORT = /^[ \t]*import\s*(?:[\w$*{}\s,]+?\s*from\s*)?['"]([^'"]+)['"]/gm;
/** `export * from '…'`, `export { … } from '…'`; the braces may span lines. */
const RE_EXPORT = /^[ \t]*export\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm;
/** `import('…')` with a literal path. */
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]/g;

/**
 * Runtime import specifiers of a module, in order: static imports and re-exports (also when they
 * are wrapped over several lines), and dynamic imports with a literal path. Dynamic imports on
 * comment lines (JSDoc type references) are skipped.
 * @param {string} text
 * @returns {string[]}
 */
export function importsOf(text) {
  /** @type {{ at: number, spec: string }[]} */
  const found = [];
  for (const pattern of [STATIC_IMPORT, RE_EXPORT]) {
    for (const match of text.matchAll(pattern)) found.push({ at: match.index ?? 0, spec: match[1] });
  }
  let offset = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const comment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    if (!comment) for (const match of line.matchAll(DYNAMIC_IMPORT)) found.push({ at: offset + (match.index ?? 0), spec: match[1] });
    offset += line.length + 1;
  }
  return found.sort((a, b) => a.at - b.at).map(({ spec }) => spec);
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
