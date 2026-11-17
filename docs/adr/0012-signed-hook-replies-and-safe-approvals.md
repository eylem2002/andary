# 0012 — Signed hook replies; approvals only for what the town can show

Status: Accepted (from the security review, findings SR-01 to SR-04)

## Context

The forwarder can steer Claude Code: its stdout is read as hook output. Two weaknesses came up in
the security review:

- The forwarder trusted the port in `server.json`. After a crash the file stays behind; whoever
  then listens on that port received every prompt plus the hook secret, and its reply could have
  rewritten commands, added permanent allow rules or injected context.
- An approval card could hide what it approves: redaction (`TOKEN="$(curl …|sh)"` shown as
  `TOKEN=[redacted]`), truncation, shortened paths, invisible or text-reversing characters, or a
  new card taking the place of the one the user was about to click.

## Decision

- **Live server only.** The forwarder sends nothing unless the `pid` in `server.json` is a live
  process of the same user.
- **Signed replies.** Each start creates a `responseKey` that stays in the 0600 state file and is
  never sent. The forwarder sends a random nonce with each request; the server signs its reply
  with `HMAC-SHA256(responseKey, nonce + "\n" + body)`. The forwarder prints a decision only for
  `PermissionRequest`, only with a valid signature, and only as a rebuilt plain allow or deny;
  every other field is dropped.
- **Show it in full or don't hold it.** A request whose input was changed by sanitising (a value
  masked or cut) is never held for the town; it goes straight to the terminal, which shows it in
  full. Cards show exact paths and every argument, with hidden characters made visible.
- **No click races.** Allow and Deny ignore pointer clicks for 1 s after a card appears or moves.
  Keyboard answers are not delayed.

## Consequences

- A forwarder from this version ignores answers from an older server (no signature); prompts then
  fall back to the terminal, which is safe. `andary start` refreshes the installed forwarder.
- Long Write/Edit inputs and anything with a masked secret are always answered in the terminal.
- A recycled pid of the same user could still receive payloads (it cannot steer Claude Code).
