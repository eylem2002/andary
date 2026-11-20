# Fixes from the independent review of the nine features

Part 23 of 30 · base: `feat/team-town`

Two reviewers who had not seen the work read features 1–4 (file diffs, cost meter, weather,
growth) and 5–9 (leaderboard, notifications, ambient sound, town looks, team town). Neither found
a must-fix in 1–4; 5–9 had two. This branch fixes everything they reported, with tests.

## Team town (review of 5–9)

- **View link at a VPN name** (must-fix): `andary start --team --team-host <name>` adds names the
  host answers to; network addresses are read again every 30 s; `team invite --url <name>` says
  when `--team-host` is needed. The Host-check refusal no longer claims "only 127.0.0.1".
- **A big batch stalled the relay** (must-fix): batches stop at 1.5 MB as well as 100 events, an
  event too big for any batch is dropped (and logged), so the host's 2 MB limit is never hit.
- The relay refuses redirects (the key never follows one) and counts a batch delivered only on a
  `{"ok":true}` answer; it removes exactly the events it sent; `dispose()` stops it for good.
- The invite prints `ANDARY_TEAM_KEY=… andary start --share-to …`, so the key stays out of `ps`
  and shell history; a detached server gets the key and the ntfy topic by environment.
- Notifications on this computer skip teammates' crews, and a viewer gets none.
- `andary doctor`'s probes stay home instead of showing up as a teammate's crew.
- The invite and a sharing member's banner say what the view link shows (everything, over HTTP).
- The host takes a token before reading a team request's body and reads at most four at once.
- `hello` always sets `settings.team`, so a restarted town without `--team` stops saying it hosts
  one; `server.json` records `team: true`, and `team invite` warns when the running town is not
  a host. `team invite` picks a private-range address before container bridges.

## Other features

- **Usage reader** (`server/usage.mjs`): a line over 16 MB is skipped instead of stalling the
  file; offsets are kept per real path (two names for one transcript count once); messages are
  remembered across all transcripts and restarts by `message.id` + `requestId` (a resumed
  session's copies count once), and a later line with more output adds the difference;
  transcripts are opened without following links or blocking on a FIFO, and checked as regular
  files on the open descriptor.
- **Prices**: Opus 4 and 4.1 at their older $15/$75 (cache reads $1.50), Opus 4.5+ at $5/$25; an
  empty `cache_creation` breakdown falls back to the total.
- **Landmarks**: the bunting stands on the north avenue's kerb instead of in the lots; the Ferris
  wheel sits on a plinth that meets the sloping sand and stays out of the sea; landmarks no longer
  earned are removed (the demo after a busier live town), and switching modes forgets the other
  town's points, so no false "The town grew" toasts.
- **Weather**: fog gives up after eight minutes (an interrupt sends no hook); the sky follows the
  weather ten times a second instead of every frame, and the reflections follow a greyer sky.
- **Phone notifications**: "Send a test" is limited to one every 30 s and never uses up the
  hour's budget for real notes.
- **Town look**: choosing in the list no longer reloads the page on every arrow key (WCAG
  3.2.2); "Rebuild the town" applies it. Settings shows the look in use (`?look=` included).
- **Ambient sound**: off until the setting says otherwise, its loops are released a few seconds
  after it stops, and the snowy look's snowfall is silent.
- **Accessibility**: the diff dialog keeps the focus when Newer/Older disappears and announces the
  change it moved to; the usage chart's numbers are in a visible "Numbers by day" table; chart and
  progress bars use a `--chart` colour that has at least 3:1 contrast in both themes.
- **Toasts**: a toast with a button (the demo's "How to connect") lasts 15 s and is the last to
  make room for new ones, so a burst of achievements cannot push it away before it is reached.
- Smaller ones: NotebookEdit cells count as written whole; a cut edit says so; demo dates step by
  calendar day (daylight saving); the weather driver is disposed; one rainbow vector is reused.
- **Docs**: usage.json's contents (paths, ids), throttled reads, message counting, the bunting's
  place, the leaderboard's records and the view link's exposure are described as they are.

## Tests

- `test/unit/server/usage.test.mjs`: resumed copies and aliases count once, ids survive a
  restart, a giant line is skipped, a FIFO is refused, a half-written line waits; Opus 4/4.1 and
  4.5 prices, an empty breakdown.
- `test/unit/server/team.test.mjs`: batches by size, oversized and doctor events, `{ok:true}`
  only, no redirects, nothing after dispose, address order, `--team-host`.
- `test/integration/team.test.mjs`: the key by environment, the view link at a `--team-host`
  name, the invite's text and warnings.
- `test/unit/world-env/weather.test.mjs`: fog gives up; landmarks come and go and the wheel's
  plinth stays between the seawall and the sea.
- `test/unit/server/notify.test.mjs`: test notes are limited and outside the hour's budget;
  teammates' crews raise no notification here.
- `test/unit/ui/diff.test.mjs`, `connection.test.mjs`, `leaderboard.test.mjs`: notebook cells,
  cut edits, `settings.team` on hello, the bunting's words.
- `e2e/features.spec.mjs`: the look is chosen first and applied with its button.
