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
  (`ids`, `dates`, `text`, `prices`, `growth`, `dialogs`).
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
