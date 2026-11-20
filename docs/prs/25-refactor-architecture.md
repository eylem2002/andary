# Architecture: one pipeline, clear layers, smaller modules

Part 25 of 30 · base: `feat/codex`

## What changed

An independent architecture review ([report](../reviews/architecture-review-2026-11-20.md)) found
the design sound but the seams loose. This branch tightens them without changing behaviour
(ADR 0014, [ARCHITECTURE.md](../ARCHITECTURE.md)):

- **One ingest pipeline** (`server/ingest.mjs`): routes authenticate and parse; a `POLICIES`
  table says what local and teammates' events do (usage, growth, notifications, approvals, relay).
- **Shared rules in one place**: `core/ids.js`, `core/dates.js`, `core/looks.js` replace copies
  that had started to differ; the HUD no longer reaches into the 3D world.
- **Smaller modules, one job each**: `events.js` → `text.js` + `summaries.js` + `events.js`;
  `store.js` → `store-model.js` + `crews.js` + `changes.js` + `store.js`; `director.js` →
  `director-queue.js` + `director.js`. The store's types are defined once.
- **Event sources together**: `public/js/sources/` (live, demo) behind one `EventSource` shape;
  `core/` is pure.
- **Tests mirror the source tree** (`test/unit/world/env/…`).
- **Enforced layers**: `npm run boundaries` checks the import rules (core is pure, the server
  reuses only listed core modules, the HUD never imports the world, the forwarder stands alone)
  as part of `check:fast` and CI.
- Docs: ARCHITECTURE.md (system design, layer rules, where to find things), CONTRACTS §2/§3/§5/§6
  brought up to date, ADR 0014.

## Tests

Behaviour is unchanged: the same 797 unit and integration tests pass, plus
`test/unit/scripts/check-boundaries.test.mjs` (areas, runtime-only imports, the forbidden
crossings). End-to-end suites are run on the whole stack.
