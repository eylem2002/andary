#!/usr/bin/env node
// Licence gate for everything installed and everything shipped.
// Andary has no runtime npm dependencies; what ships to users is our own code plus the
// vendored three.js and Overpass fonts, so those are checked explicitly as well.
// Usage: node scripts/check-licenses.mjs [--md <file>]   (writes a Markdown table when asked)
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Permissive licences, plus file-level copyleft (MPL-2.0) and font (OFL-1.1) licences that impose
// no obligations on Andary's own code when used unmodified as dev tools or vendored assets.
const ALLOWED = new Set([
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC-BY-3.0', 'CC-BY-4.0', 'CC0-1.0',
  'ISC', 'MIT', 'MIT-0', 'MPL-2.0', 'OFL-1.1', 'Python-2.0', 'Unlicense', 'W3C-20150513',
]);

/** Normalises the many ways package.json declares a licence into SPDX ids. */
function licenceOf(pkg) {
  const raw = pkg.license ?? pkg.licenses ?? 'UNKNOWN';
  if (Array.isArray(raw)) return raw.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
  if (typeof raw === 'object') return raw.type ?? 'UNKNOWN';
  return String(raw);
}

/** An SPDX expression passes when every AND-term (or at least one OR-alternative) is allowed. */
function isAllowed(expression) {
  const cleaned = expression.replace(/[()]/g, '').trim();
  if (cleaned.includes(' OR ')) return cleaned.split(' OR ').some((part) => isAllowed(part));
  return cleaned.split(' AND ').every((part) => ALLOWED.has(part.trim()));
}

/** Every installed package (all node_modules levels, scoped packages included). */
function* installedPackages(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (name.startsWith('@')) {
      yield* installedPackages(full);
      continue;
    }
    const manifest = join(full, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name && pkg.version) yield { name: pkg.name, version: pkg.version, license: licenceOf(pkg) };
    }
    yield* installedPackages(join(full, 'node_modules'));
  }
}

const SHIPPED_ASSETS = [
  { name: 'three.js (vendored)', file: 'public/vendor/three/LICENSE', expect: /MIT License/, license: 'MIT' },
  { name: 'Overpass font (vendored)', file: 'public/vendor/fonts/overpass.LICENSE', expect: /SIL OPEN FONT LICENSE/i, license: 'OFL-1.1' },
  { name: 'Overpass Mono font (vendored)', file: 'public/vendor/fonts/overpass-mono.LICENSE', expect: /SIL OPEN FONT LICENSE/i, license: 'OFL-1.1' },
];

const ownLicence = licenceOf(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
const unique = new Map();
for (const pkg of installedPackages(join(root, 'node_modules'))) unique.set(`${pkg.name}@${pkg.version}`, pkg);
const packages = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
const rejected = packages.filter((p) => !isAllowed(p.license));

const assetProblems = SHIPPED_ASSETS.filter((a) => {
  const path = join(root, a.file);
  return !existsSync(path) || !a.expect.test(readFileSync(path, 'utf8'));
});

const counts = {};
for (const p of packages) counts[p.license] = (counts[p.license] ?? 0) + 1;
console.log(`Project licence: ${ownLicence}`);
console.log(`Installed packages: ${packages.length} (dev tooling only; no runtime dependencies)`);
for (const [licence, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${licence}`);
console.log('Shipped third-party assets:');
for (const a of SHIPPED_ASSETS) console.log(`  ${assetProblems.includes(a) ? 'MISSING' : 'ok     '} ${a.name}: ${a.license}`);

const mdIndex = process.argv.indexOf('--md');
if (mdIndex > -1) {
  const rows = packages.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${isAllowed(p.license) ? 'yes' : '**no**'} |`);
  const assetRows = SHIPPED_ASSETS.map((a) => `| ${a.name} | — | ${a.license} | ${assetProblems.includes(a) ? '**missing**' : 'yes'} |`);
  writeFileSync(process.argv[mdIndex + 1], ['| Package | Version | Licence | Allowed |', '| --- | --- | --- | --- |', ...assetRows, ...rows].join('\n') + '\n');
}

if (rejected.length || assetProblems.length || ownLicence !== 'MIT') {
  for (const p of rejected) console.error(`Not allowed: ${p.name}@${p.version} (${p.license})`);
  for (const a of assetProblems) console.error(`Licence file missing or wrong: ${a.file}`);
  process.exit(1);
}
console.log('All licences allowed.');
