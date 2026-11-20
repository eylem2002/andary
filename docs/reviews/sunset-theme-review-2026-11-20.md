# Review of the sunset-coast look (2026-11-20)

An independent reviewer, who had not seen the work, read commit 6ac971c in its own worktree
and ran `npm run check:fast` (all passed). Verdict: nothing must be fixed before merging.

| # | Finding | Severity | Outcome |
|---|---------|----------|---------|
| 1 | The sea's shore line jumped at the groyne, leaving a straight seam in open water | should-fix | Fixed: the two shore lines blend across x 8.1–12.1 (`water.js`) |
| 2 | Two beach palms stood inside umbrella canopies | should-fix | Fixed: `beachSpots()` puts palms halfway between umbrellas; a unit test checks the spacing for several seeds |
| 3 | In dark mode the switch that is on measured 2.6–2.8:1 against the board (this was already true before the change) | should-fix | Fixed: `--switch-on` is #E0438F on dark paper (4.2–4.6:1) |
| 4 | Browser theme colour and favicon still green | nit | Fixed: sign pink, gradient favicon |
| 5 | Leftover ink colour in a few shadows and labels | nit | Fixed |
| 6 | The assumption named the game and its publisher | nit | Reworded |
| 7 | Stale "limestone"/"golden dome" comments, a long comment line, a ragged report line | nit | Fixed |
| 8 | "Neon only at night" — it starts at dusk | nit | Reworded |

Tests added on the reviewer's suggestion: the N cycle and saved time modes, no colliding shared
tones in `paintMap`, and palm spacing on the beach.
