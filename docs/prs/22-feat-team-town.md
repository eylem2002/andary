# Shared team town

Part 22 of 22 · base: `feat/town-looks`

## What changed

Several people's Claude Code sessions in one town (CONTRACTS §4.11):

- **Hosting**: `andary start --team` listens on the network and keeps a team secret in
  `~/.andary/team.json`. `andary team invite <name>` prints a teammate's key with the command
  to share, and a view-only link; `andary team reset` revokes them all.
- **Sharing**: `andary start --share-to <address> --team-key <key>` runs the teammate's own town
  as usual and also relays its sanitized events to the host in small batches, keeping the
  newest 1,000 and retrying while the host is away.
- **On the host**: `POST /api/team` checks the key (an HMAC of the name), rate-limits per member,
  and ingests each event as theirs (`andary_member`, session id prefixed with their name). Their
  crews count toward the town's growth, but not costs, notifications or approvals.
- **Watching**: `/?view=<token>` gives a view-only cookie. Viewers see the town but not the
  host's held prompts, costs, settings or ntfy topic, cannot send anything but pings, and can
  never take the owner's last four connections.
- **In the town**: a teammate's foreman carries their name (name tag, log, inspector), their crew
  has a name badge on the crews board, and Settings shows a "Team town" note. The demo shows the
  web-app crew as Lina's.

Plain HTTP on a network you trust; the CLI warns and suggests a private network such as
Tailscale across the internet (docs/ASSUMPTIONS.md 57–61).

## Tests

- `test/unit/server/team.test.mjs`: names, keys (tampering, other secrets, dots in names), the
  secret file (0600, reset), per-member limits, the relay (batches, queue cap, retry, recovery),
  the CLI flags, roles from cookies, the owner reserve and the LAN host names.
- `test/integration/team.test.mjs`: two real towns, one sharing to the other; wrong keys, the
  Host-check exemption for the team route only, forged tags stripped from local hooks; the view
  link, a viewer's hello and refused settings.
- `test/unit/core/store.test.mjs`: member sessions and their foreman's name.
- `e2e/features.spec.mjs`: the badge and the foreman's name in the demo (desktop and phone).
