# 0011 — Lighthouse kept out of the project's dependency tree

Status: Accepted

## Context

The licence gate (`npm run licenses`) allows permissive licences plus MPL-2.0 and OFL-1.1.
Installing `lighthouse` as a devDependency pulled in `sentry@0.49.0`, licensed FSL-1.1
(source-available, not open source), via `@sentry/node`.

## Decision

Remove Lighthouse from `devDependencies`. Lighthouse is a local measurement tool, not part of
CI. It lives in its own folder, `tools/lighthouse`, with its own `package.json` and lockfile:
`scripts/lighthouse.mjs` runs `npm ci --ignore-scripts` there on first use, outside the
project's lockfile, audit surface and licence report. (It first ran as `npx -y
lighthouse@13.6.0`, which pinned only Lighthouse itself; the lockfile pins every package it
pulls in by integrity hash.)

## Consequences

- The project's installed tree is 98 packages, all on the allow-list.
- The first `npm run perf` downloads Lighthouse, exactly as locked; `npm run licenses` does not
  look at `tools/lighthouse` (Lighthouse is never shipped or run by CI).
