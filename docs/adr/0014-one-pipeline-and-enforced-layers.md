# 0014 — One ingest pipeline, one event source, enforced layers

Status: Accepted

## Context

An independent architecture review (2026-11-20) found the design sound but the seams loose:

- what happened to an event on the server (usage, growth, notifications, approvals, the team
  relay) was decided inside each HTTP route, so a second source would have copied a route;
- the HUD imported a module from inside the 3D world, against CONTRACTS §2;
- the same rules were written several times and had started to differ (agent ids, local dates,
  the Claude config folder);
- the browser's live and demo sources lived in different folders with different shapes;
- three core files had grown past 700–1,400 lines, and the store's types existed twice.

## Decision

- `server/ingest.mjs` is the only way an event enters the town, with a per-origin `POLICIES`
  table. Source adapters (ADR 0013) run before it.
- Rules both sides must agree on live once, in pure core modules the server may import
  (`ids`, `dates`, `text`, `prices`, `growth`).
- The browser's sources sit in `public/js/sources/` behind one `TownSource` shape (named `EventSource` until part 27).
- `core/events.js`, `store.js` and `director.js` are split by job (`text`, `summaries`; `crews`,
  `changes`, `store-model`; `director-queue`), and the store's types are defined once.
- Tests mirror the source tree.
- `scripts/check-boundaries.mjs` (`npm run boundaries`, part of every check) enforces the layer
  rules in docs/ARCHITECTURE.md.

## Consequences

- A rule that changes is changed in one place; a layer that is crossed fails the check instead of
  waiting for a review.
- More, smaller files. Each starts with a comment saying what it is for, and ARCHITECTURE.md has a
  "where to find things" table.
- The server depends on a handful of browser-side core modules; the boundary check keeps that
  list explicit.

## Update (2026-11)

Modules that joined the server's list since this decision (`SERVER_CORE` in
`scripts/check-boundaries.mjs` keeps the full list):

- `dialogs` (`public/js/core/dialogs.js`), the one model of what an agent has asked you and had
  no answer to. The phone notes, the approval broker and the town's "needs you" must agree on
  when an agent waits for you and what the terminal answered, so that rule lives once, in core,
  where all three read it.
- `card-fields` (`public/js/core/card-fields.js`), the input fields an approval card shows for
  each tool: the server holds a request only when the card shows every field of it, so the card
  and that rule read one list.
- `permission-rules` (`public/js/core/permission-rules.js`), which says which permission rules an
  approval may offer to save with "Allow always". The server decides, and the demo plays the
  server's part, so both read the same rule.
- `loops` (`public/js/core/loops.js`), the rules that say when an agent seems stuck (the same
  step failing or repeating with nothing changed). The town's alert and the phone's note must
  agree on when an episode starts and ends, so the rules live once, in core, where both run them.
- `shell` (`public/js/core/shell.js`), the one reader of shell command lines: segments, programs,
  redirections, a shell's `-c` script, folder moves. `loops` reads commands through it, so the
  server needs it too, and every other rule about what an agent ran reads commands the same way.
- `summaries` (`public/js/core/summaries.js`), what a shell command is about: the catch-up counts
  test runs, commits and pushes, and must read a test run as the town's weather and records do.
- `digest` (`public/js/core/digest.js`), what each crew did, in five-minute buckets, for "Catch me
  up". The server keeps the counts so they outlive a page reload, and the demo plays the
  server's part, so both count the same way.
