# Review of Codex support, the architecture refactor and the usage guide (2026-11-20)

A reviewer who had not seen the work read the diff from `fix/feature-review` to `docs/usage-guide`
(parts 24–26), ran `npm ci && npm run check:fast` on a separate checkout (all green, 800 tests)
and reproduced every finding with a script or a CLI run in a scratch home folder. It had no web
access, so Codex's real payloads could not be checked (see ASSUMPTIONS 62–64).

**No must-fix.** The reviewer noted the first finding would be one if Codex sends commands as
argument lists, which the adapter itself expects, so it was treated as urgent. All findings are
fixed on `fix/codex-review` (part 27), each with a test that fails without its fix.

| # | Finding | Severity | Outcome |
|---|---------|----------|---------|
| 1 | A Codex command sent as an argument list was shown on the approval card as `String(array)`, so `['rm','a,b']` and `['rm','a','b']` looked the same, and the request could still be held and approved from the town | should | Each argument is shell-quoted where needed (`core/text.js` `shellWords`), on the card and in the adapter |
| 2 | Approvals for renamed Codex tools (`apply_patch` → Edit/Write, `spawn_agent` → Agent) never settled on the tool result, so an "answer in your terminal" card stayed until the turn ended; Rubber Stamp missed them | should | The adapter keeps Codex's name in `andary_tool`; the broker and the store match on either name; every `andary_` field from a hook is dropped |
| 3 | A trailing newline after `*** End Patch` added an empty hunk, turning an Edit into a MultiEdit with an empty edit | should | Parsing stops at End Patch; blank lines outside a hunk are ignored |
| 4 | `andary doctor` warned "events twice" for the Claude Code plugin next to Codex hooks, and suggested `andary install` (Claude Code) to a Codex-only user missing the forwarder | should | Only Claude Code settings count against the plugin; the fix names `install codex` when only Codex is connected |
| 5 | `andary replay` dropped the Codex mark from recorded Codex events | should | Recorded Codex events are posted as Codex's; the adapter passes already translated events through |
| 6 | The boundary check missed imports wrapped over several lines, and did not check what the server's shared core modules import | should | Imports are read across lines; a shared core module may only import other shared modules |
| 7 | README said the installer refuses symlinked settings files; it writes through them on purpose (SR-06 was about planted temporary files) | should | README and the final report's SR-06 row corrected |
| 8 | Broken link to CONTRACTS §4 in INTEGRATION.md | nit | Fixed |
| 9 | INTEGRATION.md said `install codex --print` output could be pasted into `config.toml` | nit | Says it is `hooks.json` content, and TOML under `[hooks]` |
| 10 | CLI help and texts assumed Claude Code only; `status` left the scope out of its fix | nit | Mention Codex and `CODEX_HOME`; `status` prints the full command |
| 11 | `core/looks.js` read the address and storage at load (core is meant to have no I/O); a one-line re-export left in `world/env/look.js`; stale comments; an export used only by tests; a typedef named like the DOM's `EventSource` | nit | `public/js/page.js` reads the look once (a new layer rule); the re-export removed; comments fixed; `TownSource` |
| 12 | Codex's Interrupt became a Stop, which earned a growth point | nit | Interrupted turns earn none |
| 13 | ARCHITECTURE said local events count toward usage (usage is Claude Code only, outside `POLICIES`); README said only a permission request waits; `ingest.mjs` had no unit test; adapter tests not where the source is | nit | Docs corrected; `test/unit/server/ingest.test.mjs`; tests moved to `test/unit/server/adapters/` and `test/unit/server/cli/` |

Checked and found sound: a local client cannot set `andary_member`, `andary_source` (or now
`andary_tool`); team events always carry the authenticated member's name; the local pipeline's
order is unchanged and team events still skip notifications, approvals and the relay; the
approval answer is the same signed allow/deny for both agents; the installer only touches its
own marked entries in the chosen agent's file and refuses `--scope local` for Codex; patch paths
are only displayed, never used to open files, and patches are capped (50 files, 20 hunks each,
1 MiB body); every command, flag, variable, shortcut and internal link in the README matched the
code.
