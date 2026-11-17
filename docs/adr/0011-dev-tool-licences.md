# 0011 — Lighthouse runs through npx to keep the dependency tree permissive

Status: Accepted

## Context

The licence gate (`npm run licenses`) allows permissive licences plus MPL-2.0 and OFL-1.1.
Installing `lighthouse` as a devDependency pulled in `sentry@0.49.0`, licensed FSL-1.1
(source-available, not open source), via `@sentry/node`.

## Decision

Remove Lighthouse from `devDependencies`. `scripts/lighthouse.mjs` runs a pinned
`npx -y lighthouse@13.6.0`, which installs into npm's cache, outside the project's lockfile,
audit surface and licence report. Lighthouse is a local measurement tool, not part of CI.

## Consequences

- The project's installed tree is 98 packages, all on the allow-list.
- The first `npm run perf` downloads Lighthouse.
