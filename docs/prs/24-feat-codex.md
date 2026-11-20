# Connect OpenAI Codex

Part 24 of 27 · base: `fix/feature-review`

## What changed

Codex sessions now show up in the town, next to Claude Code's (CONTRACTS §4.1, §4.3, §4.12;
ADR 0013):

- `andary install codex` (and `uninstall codex`, `--scope user|project`, `--dry-run`, `--print`)
  writes Andary's hooks to `~/.codex/hooks.json` (or `$CODEX_HOME`, or a project's
  `.codex/hooks.json`), keeping other hooks. What differs between the two agents (file, scopes,
  events, the forwarder's argument) lives in `server/clients.mjs`; the installer, `status` and
  `doctor` handle both.
- The forwarder, run with `codex`, marks its body `"source":"codex"`. The server translates Codex
  payloads at the edge (`server/adapters/`): a multi-file `apply_patch` becomes one Write, Edit
  or MultiEdit per file (so the inspector shows Codex's diffs), `spawn_agent` becomes an Agent
  call, a command with a non-zero exit code becomes a failure (rain), and `Interrupt` ends the
  turn. Permission requests are passed on exactly as Codex sent them, so remote approvals work
  for Codex with the same card and switch.
- In the town a Codex crew has a "Codex" badge, OpenAI models get a cap and a label such as
  "GPT-5.3 Codex".
- Costs stay Claude Code only for now (ASSUMPTIONS 65).

Codex's payloads were taken from its documentation; nothing here talked to a live Codex
(ASSUMPTIONS 63).

## Tests

- `test/unit/server/codex.test.mjs`: the patch reader (add, update with hunks, move, delete,
  CRLF, non-patches) and every translation, plus what passes through unchanged.
- `test/unit/server/installer.test.mjs`, `cli-options.test.mjs`: Codex's file, scopes, command
  and events; other Codex hooks are kept; reports cover both agents.
- `test/integration/codex.test.mjs`: the real forwarder with `codex` → server → browser
  (translated, marked); a Codex permission request answered from the town in Codex's format;
  `andary install codex`, `status` and `uninstall codex` through the CLI.
- `test/unit/core/store.test.mjs`, `shared/catalog.test.mjs`, `e2e/features.spec.mjs`: the
  session's source, the cap and label, the badge.
