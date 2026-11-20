# Local server, hook forwarder, CLI, installer and Claude Code plugin

Part 3 of 13 · base: `ci/github-actions-and-pre-push`

## What changed

How Claude Code reaches the town: a hook forwarder, a local server and a CLI that installs it all.

- **`hooks/hook.mjs`**: Claude Code runs it for each hook event. It reads the server's address
  and secret from `~/.andary/server.json`, posts the payload and **always exits 0** without
  output, so a stopped town never disturbs Claude. The one exception is `PermissionRequest`,
  where it prints the decision when the town gives one.
- **Hook registration** (19 events): observation hooks run with `"async": true`, so they never
  slow Claude down; `PermissionRequest` is synchronous (timeout 150 s); `SessionEnd` gets 3 s.
  `WorktreeCreate`/`WorktreeRemove` are deliberately not registered (they would replace git's
  own worktree handling).
- **Server** (`server/`, Node built-ins only, ADR 0003): static files with gzip and ETags,
  `/api/hook`, `/api/hello`, `/api/health`, and a hand-written RFC 6455 WebSocket feed.
- **Security** (ADR 0004): binds 127.0.0.1; checks the `Host` header (DNS rebinding) and the
  WebSocket `Origin` (cross-site hijacking); per-start UI token exchanged for an `HttpOnly`,
  `SameSite=Strict` cookie; separate hook secret; both in a 0600 file; constant-time compares;
  strict CSP with the import map allowed by hash, plus nosniff, frame denial, COOP/CORP and a
  Permissions-Policy; body-size and rate limits; secrets redacted and long values truncated
  before anything is stored or sent; nothing written to disk unless `--record`.
- **Remote approvals** (ADR 0005, opt-in): a permission prompt is held until someone clicks
  Allow or Deny in the town, or until the timeout (120 s, max 140 s), when the normal terminal
  prompt takes over. Falls back to the terminal when no browser is connected.
- **CLI** `bin/andary.mjs`: `start`, `demo`, `stop`, `install`/`uninstall` (user, project and
  local scope; idempotent; keeps other hooks and settings; timestamped backup; refuses malformed
  JSON), `status`, `doctor` (sends a test event end to end), `replay`, `simulate`.
- **Plugin packaging**: `.claude-plugin/plugin.json`, `marketplace.json`, `hooks/hooks.json`
  (using `${CLAUDE_PLUGIN_ROOT}`) and the `/andary:town` command. `claude plugin validate .`
  passes.
- **docs/INTEGRATION.md**: scopes, plugin route, security model, troubleshooting, uninstall.

## How to try it

```sh
node bin/andary.mjs install --dry-run   # see what would change
node bin/andary.mjs start               # prints the sign-in link
node bin/andary.mjs simulate --speed 2  # feeds it simulated sessions
```

## Tests and results

| Suite | Result |
| --- | --- |
| Unit (`test/unit/server`, 14 files): WebSocket framing, sanitising and redaction, rate limiter, auth helpers, Host/Origin checks, CSP hashes, installer merge/uninstall/backups, approval state machine, static paths | 157 pass |
| Integration (`test/integration`, 5 suites): real server on a free port, hook auth, limits, rebinding, cookie login, WebSocket auth, forwarder end to end, allow/deny/timeout approvals, `--record` | 59 pass |
| WebSocket unit tests with both CPU cores saturated, 6 runs | 6 / 6 pass (no fixed sleeps; sockets always cleaned up) |
| Lint, typecheck, config lint | pass |

The browser test of the approval round trip (`e2e/live.spec.mjs`) arrives with the HUD in part 7.
It passes there: 10 / 10 on desktop and mobile.

## Assumptions

- Default install scope is the user settings file, so every project reports to the town.
- `CLAUDE_CONFIG_DIR` is honoured; uninstall keeps `~/.andary`.
- Command hooks rather than `type: "http"` hooks: an unreachable HTTP hook would report an
  error on every event whenever the town is closed (ADR 0001).

## Open items

- Tested on Linux only; the Windows and macOS paths (browser opening, `stop`) are not exercised.
- `/andary:town` passes plugin validation but was not run inside a live Claude Code session.
