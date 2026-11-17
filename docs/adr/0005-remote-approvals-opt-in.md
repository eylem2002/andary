# 0005 — Approving permission prompts from the town is opt-in and times out

Status: Accepted

## Context

A `PermissionRequest` hook can answer Claude Code's permission dialog. That makes an "approval
round-trip" possible: the agent waits at the Permit Office, you click Allow in the town. It also
changes Claude Code's behaviour: while the hook waits, the terminal prompt does not appear.

## Decision

- Off by default. When off, the server answers the hook immediately with no decision and the
  town shows a read-only card ("answer in your terminal").
- When on (UI toggle or `--remote-approvals`) **and** a browser is connected, the server holds
  the hook until someone decides or `approvalTimeoutMs` (default 120 s) passes; on timeout it
  answers with no decision and the normal terminal prompt appears. The hook's own timeout (150 s)
  is longer, so Claude Code never kills it first.
- Decisions come only from authenticated WebSocket clients. Denials tell Claude
  "Denied from Andary" so it can choose another approach.

## Consequences

- Turning it on is a conscious choice; forgetting the browser open costs at most the timeout.
- Approval state is in memory; restarting the server releases every held hook.
