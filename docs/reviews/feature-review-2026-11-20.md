# Review of the nine new features (2026-11-20)

Two independent reviewers, neither of whom had seen the work, read the features in their own
copies of the repository and ran `npm run check:fast` (all passed). The first read features 1–4
(commits ed0e6e9..20fcee9): no must-fix. The second read features 5–9 (5c6004c..the team town):
two must-fix. The second reviewer showed every finding with a small script or a headless browser.
Everything below is fixed on `fix/feature-review` unless it says otherwise.

## Features 1–4: file diffs, cost meter, weather, growth

| # | Finding | Severity | Outcome |
|---|---------|----------|---------|
| 1 | A transcript line over 16 MB stopped the reader at that offset for good | should-fix | Skipped; test |
| 2 | Two paths to one transcript (a symlink) counted it twice | should-fix | Offsets keyed by real path; test |
| 3 | Copies of a message in another transcript (a resumed session) counted again; the seen-list was per file and lost on restart | should-fix | One bounded list of `message.id` + `requestId` across files, kept in usage.json; more output on a later line adds the difference; test |
| 4 | The file could change between the check and the read, or be a FIFO that blocks | should-fix | Opened with `O_NOFOLLOW` and `O_NONBLOCK`, checked as a regular file on the descriptor; test |
| 5 | Opus 4 and 4.1 priced like Opus 4.5; an empty `cache_creation` lost the cache writes | should-fix | Fixed; tests |
| 6 | The bunting stood in the lots; the wheel's base reached into the sea and floated over the slope | should-fix | Bunting on the avenue's kerb; a plinth that meets the sand, moved inland; test |
| 7 | Landmarks were never removed; demo and live points were compared | should-fix | Removed when no longer earned; progress forgotten on a mode switch; test |
| 8 | Fog stayed after an interrupt or an old replay | should-fix | Gives up after eight minutes; test |
| 9 | The sky was re-applied every frame while it rained | should-fix | Ten times a second; the reflections follow a greyer sky |
| 10 | The diff dialog lost the focus when Newer/Older hid itself, and did not say where it moved | should-fix | Focus kept, change announced |
| 11 | Today's bar in the dark theme was 2.81:1, and only screen readers had the numbers | should-fix | A `--chart` colour (≥ 3:1 in both themes); a visible "Numbers by day" table |
| 12 | Docs said usage.json held numbers only, reads were debounced, and the bunting hung over the avenue | should-fix | Corrected |
| 13 | Nits: the weather driver was never disposed; a vector made every frame; NotebookEdit not "whole"; cut edits not marked; demo dates across daylight saving; temp folders left by tests | nit | Fixed |

## Features 5–9: leaderboard, notifications, ambient sound, town looks, team town

The reviewer found the team town's core sound: keys and view token cannot be forged, only
`POST /api/team` skips the Host check and its key is checked before the body is read, teammates
cannot fake their name or collide with other sessions, their events never reach the usage reader,
the approval broker or the phone notifier, and viewers get nothing of the owner's.

| # | Finding | Severity | Outcome |
|---|---------|----------|---------|
| 1 | The view link was refused at a VPN name, though the invite suggested one; addresses were read once | must-fix | `--team-host <name>`; addresses read every 30 s; the invite says when `--team-host` is needed; test |
| 2 | One batch over the host's 2 MB limit stalled the relay for good | must-fix | Batches stop at 1.5 MB; an event too big for any batch is dropped; test |
| 3 | The relay followed redirects (with the key) and took any 2xx as delivery | should-fix | `redirect: 'error'`; only `{"ok":true}` counts; test |
| 4 | The invite put the key on the command line (ps, shell history); the detached server got the ntfy topic as an argument | should-fix | Key and topic by environment; test |
| 5 | Desktop notifications for teammates' crews, and for everything on a viewer's screen | should-fix | Skipped; test |
| 6 | "Send a test" could use up the hour's phone budget | should-fix | One test every 30 s, outside the budget; test |
| 7 | Arrow keys in "Town look" reloaded the page on every step (WCAG 3.2.2) | should-fix | Choose, then "Rebuild the town"; e2e |
| 8 | `andary doctor`'s probes reached the host as a teammate's crew | should-fix | Not relayed; test |
| 9 | The view link's exposure was not spelled out | should-fix | Said in the invite, the member's banner, README and ASSUMPTIONS 59 |
| 10 | The relay could drop unsent events when the queue was trimmed during a send | nit | Removes exactly what it sent |
| 11 | A key holder could keep many 2 MB uploads open | nit | A token before reading, four uploads at once |
| 12 | `dispose()` did not stop an in-flight send from scheduling another | nit | Fixed; test |
| 13 | Ambient sound started for a moment when it was off; its loops kept running silently | nit | Off until the setting says so; loops released after it stops |
| 14 | ASSUMPTIONS 52 said records were kept since start | nit | Reworded |
| 15 | Settings kept saying "hosts a team" after a restart without `--team`; `team invite` did not notice a non-host | nit | `settings.team` always sent; `server.json` records `team`; the invite warns; test |
| 16 | Settings showed the saved look, not a `?look=` one; snowfall sounded like rain; the invite could pick a container address; the leaderboard bar was 2:1 in the dark theme | nit | Fixed |
