# Cost and token meter

Part 15 of 22 · base: `feat/file-diffs`

## What changed

Each crew shows what it has cost so far; the agent inspector has a **Usage** line; `U`, the
coins button or a crew's cost opens **Usage**: today's total, the last 14 days as bars (with the
numbers in a table for screen readers) and the crews in town.

- **Server** (`server/usage.mjs`, CONTRACTS §4.8): reads token usage from the transcript each
  hook names, only inside `<Claude config>/projects` (symlinks resolved), only what was
  appended, each message once, 16 MB at a time. Day totals and read offsets are kept in
  `~/.andary/usage.json` (0600, numbers and paths only) so a restart counts nothing twice.
  New WebSocket message `usage`; `hello` carries the totals.
- **Prices** (`public/js/core/prices.js`): API list prices checked 2026-11-20, cache reads and
  writes, Haiku 5.5's long-prompt rate. Shown as "estimated at API prices"; tokens only when a
  model's price is unknown.
- **Store**: `usage` per agent and `usageDays`, read defensively.
- **Demo** (`public/js/ui/demo-usage.js`): repeatable made-up numbers and 13 past days,
  labelled as made up.
- The privacy line now says what is on disk: number totals only, no prompts or commands
  without `--record`.

## Tests

- `test/unit/server/usage.test.mjs`: prices, reading lines, the folder check (symlinks,
  `..`, other extensions), counting each message once, partial lines, subagents, saving and
  resuming after a restart.
- `test/unit/ui/usage.test.mjs`: formatting, crew sums, the 14 days, the store, the demo.
- `test/integration/usage.test.mjs`: a real server reads a transcript named by a hook, streams
  it, replays it in `hello`, and ignores a transcript outside the projects folder.
- `e2e/features.spec.mjs`: crew cost and the Usage dialog on desktop and phone, no axe
  violations.
