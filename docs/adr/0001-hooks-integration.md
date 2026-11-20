# 0001 — Connect to Claude Code through hooks, not transcript files

Status: Accepted

## Context

Andary must see what every Claude Code agent is doing, live. There are two ways in:

1. **Hooks**, the documented extension point: Claude Code runs a command (or calls a URL) for
   each lifecycle event and passes a JSON payload. Payloads carry `agent_id`/`agent_type` for
   subagents and in-process teammates, so attribution is exact. `PermissionRequest` hooks can
   return an allow/deny decision.
2. **Tailing transcript files** (`~/.claude/projects/**.jsonl`), as some visualisers do. No setup,
   but the format is internal and undocumented, it can change in any release, and it cannot
   answer permission prompts.

## Decision

Use hooks. A tiny forwarder (`hooks/hook.mjs`) receives each payload and POSTs it to the local
server. Observation-only events are registered with `"async": true` so they never slow Claude
down; `PermissionRequest` is synchronous (it may return a decision); `SessionEnd` is synchronous
with a 3 s timeout because async hooks can be killed while the session exits. Hooks that change
Claude Code's behaviour when present (`WorktreeCreate`, `WorktreeRemove`) are never registered.

We use command hooks rather than `type: "http"` hooks: an unreachable HTTP hook surfaces as a
hook error on every event when the town isn't running, while the forwarder exits 0 silently.

## Consequences

- One `andary install` (or the plugin) is needed; `uninstall` removes exactly our entries.
- Each event costs one short-lived Node process (async, so off Claude's critical path).
- Async hooks may arrive slightly out of order; the client tolerates a `tool.end` before its
  `tool.start` and orders by the forwarder's own timestamp.
- We depend only on the documented hook schema (`docs/CONTRACTS.md` §4.2).
