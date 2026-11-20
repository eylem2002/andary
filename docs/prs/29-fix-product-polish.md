# Product fixes: plugin packaging, first paint, crew edge cases, macOS and Windows CI

Part 29 of 30 · base: `fix/security-hardening`

Fixes the product items left on the final report's list. Done by a separate agent on its own
branch, then stacked on part 28.

## What changed

- **The plugin has no `bin/` folder any more.** Claude Code put the plugin's `bin/` on its
  `PATH`, and claude.ai rejects plugins with one. The CLI moved to `cli/andary.mjs`; package.json,
  the plugin, the layer rules, tests and docs follow. `npm pack` still installs a working
  `andary`.
- **`/andary:town` pre-approves exactly its one command**
  (`Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/andary.mjs" start --detach)`) instead of every `node`
  command. Claude Code fills in `${CLAUDE_PLUGIN_ROOT}` there since 2.1.0; on older versions the
  rule matches nothing and Claude Code asks or refuses, which is safe.
- **First content before the 3D world.** The store and the HUD start first; the 3D modules load
  meanwhile and the world is built after the first crew is drawn (or 800 ms). The director replays
  what the store recorded, so the first crew still arrives by bus.
- **Crew edge cases:** a crew keeps its number for its whole life (the lowest free number when it
  arrives); a crew without a session id ends after 10 idle minutes; two helpers of the same type
  keep their own labels (pairing by when the hooks started, and the Agent result's `agentId`
  always wins); cars and the mail truck stop for anyone in their lane, and agents stand on the
  kerb at doors on roads. `world.js` hands the crowd's lane query to the town, so `env/` and
  `agents/` still never import each other.
- **Split-pane teammates** still appear as their own crew: their hooks carry no documented field
  that links them to their lead (README and CONTRACTS say so).
- **CI on macOS and Windows** for the unit and integration tests (Windows `continue-on-error`
  until it has passed once). `.gitattributes` keeps LF line endings; `andary stop` removes
  `server.json` itself (Windows has no SIGTERM); POSIX-only checks skip on Windows with a reason.
- Tried to reproduce the blank view on High quality: not reproduced in 60–90 s runs checked frame
  by frame; a lost WebGL context recovers by itself. No change.

## Tests

850 unit and integration tests on top of part 28 (838). New: plugin layout and the exact
permission rule; the director replaying recorded changes like a live one; stable crew numbers,
the session-less crew ending, label pairing (three cases that fail on the old code); lane checks,
kerb spots and vehicles yielding. End to end: crews and the log show while the 3D world is held
back, then the town replays them.
