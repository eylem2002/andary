# Leaderboard

Part 18 of 22 · base: `feat/town-growth`

## What changed

`L` or the trophy on the toolbar opens the **Leaderboard**:

- **Your town**: points, the next landmark and how many points it needs, a progress bar
  (`role="progressbar"` with values), and the busy-day streak.
- **Records since Andary started**: the fastest fix (from a crew's first failing test run to
  its next passing one) and who turned the most test runs green (`public/js/core/records.js`,
  pure, fed with the store's events).
- **Busiest agents in town**: the top five by tool calls, then files changed, with their crew
  number and colour.

## Tests

- `test/unit/ui/leaderboard.test.mjs`: fix timing (interrupts, old failures, per crew), the
  streak, the ranking, the words.
- `e2e/features.spec.mjs`: the leaderboard in the demo on desktop and phone, no axe
  violations.
