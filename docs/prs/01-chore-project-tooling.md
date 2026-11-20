# Project tooling, shared town plan and quality scripts

Part 1 of 12 · base: `main` · merge first

## What changed

Andary has no runtime dependencies, so this PR sets up everything around the code: dev tooling,
the interfaces every later PR is built against, and the scripts behind the quality gates.

- **package.json**: every script the project uses (`lint`, `lint:config`, `typecheck`, `test`,
  `test:e2e`, `perf`, `licenses`, `secrets`, `check`, `check:fast`, `hooks:install`). Dev tools
  only: ESLint 10, TypeScript 5.9 (`checkJs`), Playwright 1.65, axe-core, three.js typings.
- **ESLint config** with a rule that bans `innerHTML`, `outerHTML`, `insertAdjacentHTML` and
  `document.write`: hook data comes from untrusted repositories and must never become HTML.
- **Vendored libraries** (`scripts/vendor.mjs`): three.js r187 (core plus the exact addons used,
  with their relative imports) and the Overpass fonts, copied with their licence files.
- **Shared vocabulary** `public/js/core/catalog.js`: the fifteen buildings, which tool sends an
  agent where (including `git push` → Post Office, `mcp__*` → Harbor), animations, crew colours,
  model hats. Lookups use `Object.hasOwn`, so a tool named `constructor` is harmless.
- **Town plan** `public/js/world/layout.js`: the 26 × 26 tile map, building lots and doors, work
  spots, queues and breadth-first path finding.
- **App shell** `public/index.html`: the import map the server whitelists in its CSP by hash.
- **Scripts**: `check.mjs` (every gate in one command), `check-licenses.mjs` (allow-list over
  all installed packages and vendored assets), `scan-secrets.mjs` (working tree **and** full
  git history; like gitleaks, a private key counts only as a complete PEM block, so tests that
  build fake keys at runtime pass while a pasted key, even inside a JSON string, is caught),
  `lint-config.mjs` (JSON, shellcheck, actionlint, yamllint), `lighthouse.mjs`,
  `shot.mjs` (WebGL screenshots), `publish-github.sh` (secrets scan → repo → branches → PRs).
- **docs/CONTRACTS.md**: the architecture and the interfaces between server, world, core and HUD.
- MIT licence and third-party notices.

## Tests and results

| Check | Result |
| --- | --- |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm run lint:config` | pass |
| `npm test` | 24 / 24 pass (layout, catalog and secret scanner) |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `npm run licenses` | 98 packages, all allowed; vendored three.js (MIT) and fonts (OFL-1.1) present |
| `npm run secrets` | no findings in the tree or history |

Each branch in this stack was checked out on its own and passed the whole pre-push gate (lint,
config lint, typecheck, tests, licences, secrets), so every PR passes on its own.

## Assumptions

- No bundler (ADR 0002): plain ES modules and an import map, so cloning is enough to run it.
- Lighthouse runs through a pinned `npx`, not as a devDependency, because it pulls in an FSL
  (source-available) package that the licence gate rejects (ADR 0011).
- See `docs/ASSUMPTIONS.md` for the full list, added in the documentation PR.

## Open items

- three.js is served unminified (≈ 2.1 MB, ≈ 0.45 MB gzipped). Fine for a local tool.
