# 0018 — Notes to agents come only from the owner, never from the team

Status: Accepted

## Context

A note from the town (CONTRACTS §4.15) is text the agent reads as context at its next step,
through `hookSpecificOutput.additionalContext`. That is a steering channel: whoever can write a
note can tell an agent what to do next, in the session of the person who started it, with that
person's permissions. ADR 0012 closed this channel to everything but rebuilt permission decisions,
because a reply that injects context is as dangerous as one that approves a command. A team town
(§4.11) lets other people watch the host's town and lets teammates' Andarys post their own events
to it; neither must gain a way to steer anyone's agent.

## Decision

- **Only the owner sends notes.** A note is a WebSocket message from a browser signed in with the
  town's own token (`owner` role). A team viewer is refused, like every other message but `ping`.
  Notes have their own budget (12 a minute, 5 at once), charged only for a note that would be
  queued.
- **Only to agents on this computer.** The server queues a note only for a session (and helper)
  that this computer's forwarder posted to `/api/hook`, with the hook secret. A teammate's sessions
  arrive through `/api/team` and are never registered, so a note for one is refused whatever its
  id. `/api/team` never answers with notes, and notes are never relayed: a team host cannot steer
  a member's agents, nor a member the host's.
- **Signed, declared, re-checked.** Notes travel only in the signed reply to a hook (ADR 0012). The
  server sends them only to a forwarder that declares the `notes` capability, and only on the
  hooks whose output the agent reads as context. The forwarder checks the signature, the hook,
  the number of notes (at most 4) and each note again (a string of at most 2,000 characters after
  removing control and format characters), drops all of them if one fails, and builds the
  `additionalContext` text itself, with its own header naming the user it runs as. A reply's own
  `hookSpecificOutput` is never passed on for these hooks.
- **Stopping is not a note.** "Deny and stop" is a permission decision (`interrupt: true` on a
  deny), from a held approval only, so remote approvals must be on (ADR 0005). The forwarder passes
  the flag only to Claude Code; Codex fails closed on it today.

## Consequences

- A stolen view link, or a teammate's key, can never steer an agent; only the owner's token can,
  and that token could already approve commands with remote approvals on.
- Notes reach only agents whose forwarder is current: an older copy gets none, and the town says
  why. Agents on a teammate's computer must be steered by that teammate, in their own town.
- Delivery is at the agent's next step, not at once; the cross-session inbox socket that could
  start a turn is left for later (ASSUMPTIONS).
