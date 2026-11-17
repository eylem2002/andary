# 0008 — One simulation drives the demo and the `simulate` command

Status: Accepted

## Context

People should see the town without running Claude Code (the hosted demo, first-run curiosity),
and developers need repeatable traffic to test the server and UI.

## Decision

`public/js/sim/simulation.js` is a seeded, DOM-free module that emits raw hook payloads exactly
as Claude Code would. The browser's demo mode feeds them straight into the client pipeline; the
CLI's `andary simulate` posts them to `/api/hook`, exercising the real server path.

## Consequences

- Demo mode exercises the same normalisation, store and director code as live mode.
- The simulation must track the documented hook schema; its tests validate every payload shape.
