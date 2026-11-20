# 0002 — No bundler: plain ES modules, vendored three.js and fonts, import map

Status: Accepted

## Context

The UI is a few dozen modules plus three.js. A bundler (Vite, esbuild) would add a build step, a
dev server and a large dependency tree to a tool whose users just want `node bin/andary.mjs`.

## Decision

- Ship plain ES modules from `public/`. Browser code imports `three` and `three/addons/...`; an
  import map in each HTML page resolves them to `public/vendor/three/`.
- `scripts/vendor.mjs` copies three.js (core + the exact addons used, following their relative
  imports) and the Overpass fonts from `node_modules` into `public/vendor/`, together with their
  licence files. The vendored files are committed, so cloning the repo is enough to run it.
- The import map is the only inline script; the server whitelists it in the CSP by SHA-256 hash.

## Consequences

- Zero build time, readable sources in the browser, works offline, no third-party requests.
- three.js is served unminified (≈ 2.1 MB, ≈ 0.45 MB gzipped by the server). Acceptable for a
  local tool; a future release could vendor a minified build.
- Upgrading three.js = bump the devDependency, run `npm run vendor`, run the checks.
