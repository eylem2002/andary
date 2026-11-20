# 0013 — Connect Codex through its hooks and a server-side adapter

Status: Accepted

## Context

People run OpenAI's Codex CLI next to (or instead of) Claude Code and want both in the town. Codex
offers three ways in:

1. **Hooks** (`~/.codex/hooks.json` or `[hooks]` in `config.toml`): a command per lifecycle event
   with a JSON payload on stdin. The events and fields follow Claude Code's (`session_id`,
   `transcript_path`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`, `tool_response`…), and
   `PermissionRequest` reads the same `hookSpecificOutput.decision`.
2. **`notify`**: one program run when a turn completes; far too little detail for the town.
3. **Session rollout files** under `~/.codex/sessions`: rich, but an internal format, the same
   reason ADR 0001 rejected Claude Code's transcripts.

The town has one event contract (the Claude Code hook payload, CONTRACTS §4.2) that history,
recordings, replay, the team relay, the demo and the browser store all read.

## Decision

- Codex registers the same forwarder (`hooks/hook.mjs`) with the argument `codex`; the forwarder
  adds `"source":"codex"` to the body. `andary install codex` writes the hooks file
  (`server/clients.mjs` holds what differs per agent: file, scopes, events, argument).
- The server translates at the edge, before ingest (`server/adapters/`): an adapter turns one
  source payload into one or more payloads of the town's contract. Codex's differences
  (`apply_patch`, `spawn_agent`, exit codes, `Interrupt`) are translated there; permission requests
  are never rewritten.
- Payloads are marked `andary_source`, which only the server sets, so the town can say "Codex".

## Consequences

- Nothing after ingest changes: the store, director, world, demo, recordings and the team relay
  work for Codex as they are, and a third agent is one more adapter.
- The town's contract stays Claude-shaped. A Codex idea with no Claude Code equivalent is either
  mapped to the nearest one (a multi-file patch becomes one edit per file) or passed through.
- Codex payload details come from its documentation, not from a live Codex here; the adapter
  reads unknown shapes defensively and passes anything it does not understand through.
- Codex asks users to trust new hooks before they run, so installing is a two-step setup.
