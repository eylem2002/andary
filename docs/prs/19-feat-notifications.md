# Phone and desktop notifications

Part 19 of 27 · base: `feat/leaderboard`

## What changed

- **On your phone** (`server/notify.mjs`, CONTRACTS §4.10): `andary start --notify` makes a
  private random topic on the free ntfy service (kept in `~/.andary/notify.json`) and prints
  its address to subscribe to in the ntfy app; `--notify-url` (or `ANDARY_NOTIFY_URL`) uses
  your own. Permission requests, waiting for a prompt, a finished turn and Claude Code stopping
  send a short note that never names a project, file or command; at most one of a kind every
  30 seconds and 30 an hour. Settings shows the address with Copy and **Send a test**. The
  unauthenticated `/api/hello` only says whether it is on.
- **On this computer** (`public/js/ui/notifications.js`): Settings → Notifications on this
  computer asks the browser for permission; then, while the town is in a background tab, a
  crew needing permission, finishing its turn or failing becomes a system notification.
  Replayed history never notifies.

## Tests

- `test/unit/server/notify.test.mjs`: what notifies (and that the text never leaks details),
  the ntfy request, rate limits, failures, the saved topic (0600), URL checks, and the browser
  notifications' choices.
- `test/integration/notify.test.mjs`: a real server posts to a stand-in ntfy, answers a test,
  keeps the topic out of `/api/hello`, and prints it on start.
- `e2e/features.spec.mjs` and `e2e/live.spec.mjs`: turning on notifications on this computer;
  the phone topic and the test button in Settings.
