# Architecture review (2026-11-20)

An independent reviewer who had not seen the code mapped the import graph of the whole repository
(at `fix/feature-review`), read every area and ran `npm run check:fast` (all passed). There were no
runtime import cycles; the environment and the characters never imported each other; every file
had a header saying why it exists. Findings and what was done, on `refactor/architecture`:

| # | Finding | Severity | Outcome |
|---|---------|----------|---------|
| 1 | What happens to an event (usage, growth, notifications, approvals, relay) was spread over the HTTP routes; a second source would copy a route | must | `server/ingest.mjs`: one pipeline, a `POLICIES` table per origin; routes only authenticate and parse |
| 2 | The HUD imported `world/env/look.js` (CONTRACTS §2: only `world.js`), and that module hard-coded the HUD's storage key | must | `core/looks.js` owns the looks and the key; the environment re-exports `LOOK` |
| 3 | The same rule written several times, already drifting: agent ids (3), local dates (5), the Claude config folder (2), the doctor's prefix (3), `isObject` (4) | should | `core/ids.js`, `core/dates.js`, one config helper, one `isObject`; the server imports the pure core modules |
| 4 | `events.js` did three jobs | should | Split into `text.js`, `summaries.js`, `events.js` |
| 5 | `director.js` (1,395 lines) and `store.js` (1,241) too large | should | `director-queue.js`; `store-model.js`, `crews.js`, `changes.js` (store 798, director 1,124 lines) |
| 6 | Store types defined twice and drifting (`Achievement.icon`, `Session.endedAt`) | should | `ui/types.js` re-exports the core types |
| 7 | Live and demo sources in different folders, different shapes; `core/` did I/O | should | `public/js/sources/` with one `EventSource` shape; `core/` has no I/O |
| 8 | Tests did not mirror the source tree | should | `test/unit/<source path>/…` |
| 9 | config.mjs claimed all limits lived there | nice | Rule written down: shared limits in `LIMITS`, single-use ones at the top of their module |
| 10 | CONTRACTS drift (`setUsage`, `usage` changes, town looks) | nice | Updated |
| 11 | Class vs factory style not written down | nice | CONTRACTS §3 and ARCHITECTURE.md |
| 12 | The director camera re-implemented the director's "historic" test | nice | `isHistoric()` exported from `core/director.js` |
| 13 | A JSDoc block above the wrong declaration in `events.js` | nice | Fixed |

The reviewer's proposed boundary rules became `scripts/check-boundaries.mjs` (`npm run
boundaries`, part of every check) and the table in [ARCHITECTURE.md](../ARCHITECTURE.md). For a
second event source the reviewer recommended a server-side adapter producing the existing hook
contract, which is what the Codex connection does (ADR 0013); its alternative of tailing Codex
session files is not needed because Codex now has hooks.
