# 0006 — In-memory state only; no database; recording is opt-in

Status: Accepted

## Context

The town shows what is happening now. The brief's database rules (prepared statements,
connection pooling, transactions) assume a database; Andary has nothing that needs one.
Hook payloads contain personal data (prompts, commands, paths).

## Decision

- Keep a bounded ring buffer (last 2,000 sanitised events) in memory so a newly opened tab can
  catch up. Browser-side caps bound the log and per-agent history.
- Write nothing to disk by default. `--record` appends sanitised events to a JSONL file under
  `~/.andary/recordings/` (mode 0600) for `andary replay`.
- No database, so the database requirements are not applicable.

## Consequences

- Restarting the server forgets history. That matches the "live town" purpose.
- Adding persistence later (for example SQLite) would need its own ADR covering the brief's
  database rules.
