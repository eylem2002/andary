# Fixes from the independent review of Codex, the refactor and the README

Part 27 of 30 · base: `docs/usage-guide`

A reviewer who had not seen parts 24–26 read them, ran the checks and reproduced each finding
([report](../reviews/codex-architecture-review-2026-11-20.md)). No must-fix; 7 should-fix and
several nits, all fixed here with tests.

## What changed

- **Approval cards show an argument list unambiguously.** A Codex command sent as a list
  (`['rm', 'a b']`) was shown like `['rm', 'a', 'b']`; each argument is now quoted the way a shell
  would need it (`rm 'a b'`), on the card and in the town's events (`core/text.js` `shellWords`).
- **Codex approvals answered in the terminal settle.** A renamed call (`apply_patch` → Edit/Write,
  `spawn_agent` → Agent) keeps Codex's name in `andary_tool`; the approval broker and the
  browser's Rubber Stamp count match on it. Every `andary_` field is now the server's to set.
- **Patches:** parsing stops at `*** End Patch`, so a trailing newline no longer adds an empty edit;
  blank lines between files are not context.
- **`andary doctor`:** no false "events twice" warning for the Claude Code plugin next to Codex;
  a missing forwarder's fix says `andary install codex` when only Codex is connected.
- **`andary replay`** sends a recorded Codex event as Codex's, so it keeps its badge.
- **The boundary check reads imports wrapped over several lines** (it missed them before) and
  checks that the core modules the server shares only bring other shared modules with them.
- **README:** the security list described the installer's symlink handling wrongly (it writes
  through a settings link on purpose; what it never follows is a planted temporary file).
- **Nits:** a broken link in INTEGRATION.md; `install codex --print` explained correctly; CLI help
  and texts mention Codex and `CODEX_HOME`; `status` names the scope in its fix; `core/` no longer
  reads the page address or storage (the look is read once in the new `public/js/page.js`, and
  the one-line `world/env/look.js` is gone); the `EventSource` typedef is `TownSource` (no clash
  with the DOM's); an interrupted Codex turn earns no growth point; stale comments; an export
  used only by tests removed; ARCHITECTURE.md and README say what waits and what counts usage.
- **Publishing:** a rehearsal of `scripts/publish-github.sh` against a stand-in GitHub stopped at
  part 24, because its line in ORDER.md has code marks in the description and the script read the
  branch name up to the last one. It now reads up to the first; a test checks that every listed
  branch has its description, numbered in order and based on the branch before it. Nothing was
  pushed: the script checks every description before it pushes.
- **Tests:** `server/ingest.mjs` has its own unit tests; the adapter tests moved to
  `test/unit/server/adapters/` and the CLI tests to `test/unit/server/cli/`, mirroring the source.

## Tests

822 unit and integration tests (800 before). Each fix has a test that fails without it: the
argument-list card, terminal settling (broker, store and end to end through the forwarder),
the trailing newline, the doctor's advice, replay keeping the Codex mark, multi-line imports and
the shared-core rule, the scope in `status`, interrupted turns, the publish script's branch list.
