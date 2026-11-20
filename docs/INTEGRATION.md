# Connecting Andary to Claude Code

Andary learns what Claude Code is doing through **hooks**. Claude Code runs a small forwarder
script for every hook event; the forwarder posts the event to the local Andary server; the
server sanitizes it and streams it to the town in your browser over a WebSocket.

```
Claude Code ──hook (stdin JSON)──▶ hook.mjs ──POST /api/hook──▶ server ──WebSocket──▶ browser
                ◀── decision (stdout, PermissionRequest only) ──┘
```

The interfaces are specified in [CONTRACTS.md §4](CONTRACTS.md#4-claude-code--server-the-hook-pipeline).

## Quick start

```sh
npx andary                 # or: node bin/andary.mjs start   (from a checkout)
npx andary install         # register the hooks in ~/.claude/settings.json
```

`start` prints a sign-in link such as `http://127.0.0.1:4747/?token=…` and opens it in your
browser. Start a **new** Claude Code session in any project and its crew walks into town. Running
sessions keep the hooks they started with.

Without Claude Code you can still watch the town: `npx andary demo` opens the built-in
simulation, and `npx andary simulate` sends simulated sessions through the real pipeline.

## Ways to connect

| Route | Command | Settings file | Use it when |
| --- | --- | --- | --- |
| User scope (default) | `andary install` | `~/.claude/settings.json` | Every session on this machine should appear |
| Local scope | `andary install --scope local [--dir <project>]` | `<project>/.claude/settings.local.json` | Only one project, only for you |
| Project scope | `andary install --scope project [--dir <project>]` | `<project>/.claude/settings.json` | Everyone on the project uses Andary at the same `ANDARY_HOME` path (e.g. a dev container). The hook command contains an absolute path, so it rarely suits a shared repository |
| Plugin | `/plugin marketplace add <repo or folder>` then `/plugin install andary@andary` | managed by Claude Code | You prefer Claude Code's plugin manager |
| By hand | `andary install --print` | wherever you paste it | You manage settings with your own tooling |

`--dry-run` shows what `install` or `uninstall` would change without writing anything.
`CLAUDE_CONFIG_DIR` is honoured for the user scope.

### What the installer does

1. Reads the settings file. If it is not valid JSON it stops, says where the error is, and writes
   nothing (the message never quotes the file, which may hold API keys).
2. Removes any earlier Andary entries: commands ending in `# andary`, or commands that run
   `<ANDARY_HOME>/hook.mjs`.
3. Adds one matcher group per event (table below). Unrelated settings and everybody else's hooks
   stay exactly where they were; the file keeps its indentation and line endings.
4. Writes a timestamped backup (`settings.json.andary-backup-<time>`) next to the file, then
   replaces it atomically. A settings file that is a symlink is written through, not replaced.
5. Copies the forwarder to `<ANDARY_HOME>/hook.mjs` (default `~/.andary/hook.mjs`) and
   notes in `<ANDARY_HOME>/installs.json` which hook containers were already there, so that
   `uninstall` removes only what Andary created.

Running `install` again changes nothing (no new backup either). `start` refreshes an installed
forwarder when it comes from an older version.

### Registered events

| Events | Mode | Why |
| --- | --- | --- |
| SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionDenied, Notification, SubagentStart, SubagentStop, Stop, StopFailure, TaskCreated, TaskCompleted, TeammateIdle, PreCompact, PostCompact, PostModelSwitch | `async: true` | Observation only: they never slow Claude down |
| PermissionRequest | synchronous, `timeout: 150` | The town can answer the permission prompt |
| SessionEnd | synchronous, `timeout: 3` | Async hooks may be killed while a session exits |

Every entry is `{"type": "command", "command": "node \"<home>/hook.mjs\" # andary"}` with no
matcher. Not registered on purpose: `WorktreeCreate`/`WorktreeRemove` (a hook there replaces
git's own worktree handling), `MessageDisplay` (fires for every streamed chunk), `Elicitation*`,
`ConfigChange`, `FileChanged`, `Setup`.

### The plugin

The repository is also a Claude Code plugin and a one-plugin marketplace:

- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (the marketplace lists the
  repository root as the plugin source),
- `hooks/hooks.json` registers the same events, running
  `node "${CLAUDE_PLUGIN_ROOT}/hooks/hook.mjs" # andary` in place,
- `commands/town.md` adds `/andary:town`, which starts the server in the background
  (`start --detach`) if needed and opens the town. Only you can run it (the model cannot).

The plugin's forwarder finds the server exactly like the installed copy: `ANDARY_HOME` if set,
otherwise `~/.andary/server.json`. Use either the plugin or settings hooks, not both, or every
event arrives twice; `andary doctor` warns about this.

## The forwarder

`hooks/hook.mjs` (copied to `<ANDARY_HOME>/hook.mjs`) uses Node built-ins only and:

1. notes the time the hook started,
2. reads `server.json`; if there is none, it exits at once,
3. reads the event from stdin (anything that is not JSON is sent as an `Unknown` event with the
   first 4,000 characters),
4. posts `{"v":1,"ts":…,"event":…}` to `http://127.0.0.1:<port>/api/hook` with the hook secret,
   waiting at most 1.5 s (or the approval timeout + 5 s for `PermissionRequest`); payloads over
   the server's 1 MiB limit are trimmed first, so big file writes still show up,
5. prints the decision object if the town returned one, and nothing otherwise,
6. **always exits 0**. A stopped server, a broken file or a slow network never disturb Claude.

It looks for its home folder in this order: `ANDARY_HOME`, the folder it was installed into
(when a `server.json` sits next to it), then `~/.andary`.

## Security model

Andary shows what your sessions do, including prompts, commands and file paths, so it treats
that data as private.

- **Loopback only.** The server binds `127.0.0.1` by default. `--host` with any other address
  prints a loud warning: anyone who can reach the port and obtain the sign-in link could watch
  your sessions and, with remote approvals on, approve tool calls.
- **DNS-rebinding defence.** Every request must carry `Host: 127.0.0.1:<port>`, `localhost:<port>`
  or `[::1]:<port>` (plus the `--host` address, when one is given); anything else gets `403`.
- **Browser sign-in.** Each start creates a new random UI token (32 bytes). Opening the sign-in
  link stores it in a `andary_ui` cookie (`HttpOnly; SameSite=Strict; Path=/`) and redirects to the
  same page without the token, so it does not stay in the address bar or history. A wrong token
  gets a `403` page. Static files need no sign-in: they contain no data.
- **WebSocket.** `/ws` requires the cookie and an `Origin` that is the server's own (non-browser
  clients may leave it out). At most 16 browsers; messages up to 64 KiB; a browser that floods
  messages is disconnected.
- **Hook secret.** Hooks authenticate with a second random value in the `x-andary-secret`
  header, compared in constant time. Requests without it get `401` before they can touch the
  rate limit (~300/s, bursts of 600, then `429`). Bodies over 1 MiB get `413`.
- **Private state file.** `server.json` (port, secret, token) is written with mode `0600` inside a
  `0700` folder and removed when the server stops.
- **Sanitizing.** Before anything is broadcast, kept or recorded: strings are cut at 2,000
  characters (`…[+N chars]`), arrays at 50 items, nesting at 8 levels, and credentials are
  replaced by `[redacted]`: private-key blocks, `sk-…`, Stripe, GitHub (`ghp_…`, `github_pat_…`),
  Slack (`xox?-…`), AWS (`AKIA…`), Google API, npm and JWT tokens, `Bearer …`, basic-auth headers,
  passwords in URLs, `NAME=value` where NAME mentions key/secret/token/password, the same in JSON
  text, and object fields with credential-like names.
- **Nothing on disk by default.** Events stay in memory (the last 2,000, for browsers that join
  late). Only `--record` writes them, to `<ANDARY_HOME>/recordings/*.jsonl` (mode `0600`),
  already sanitized.
- **Quiet logs.** The console shows lifecycle and counts only, never payloads or the secret. The
  startup banner prints the sign-in link: that is its purpose.
- **Headers.** A strict Content-Security-Policy (`default-src 'self'`; scripts only from the
  server plus the hashed import map of every `public/*.html`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Resource-Policy: same-origin`, and a `Permissions-Policy` that turns off camera,
  microphone and geolocation.

## Remote approvals

Off by default. Turn them on in the town (Settings → Remote approvals) or start with
`--remote-approvals`.

- **On, with a browser connected:** a permission prompt waits for the town. Allow or Deny answers
  Claude Code directly (a deny can carry a reason, which Claude sees as
  `Denied from Andary: <reason>`). Claude Code's own deny and ask rules still apply.
- **No answer in time:** after `--approval-timeout` seconds (default 120, at most 140 because
  Claude Code stops waiting for the hook at 150) the hook returns nothing and the usual terminal
  prompt appears.
- **Back to the terminal at once** when remote approvals are switched off, when the last browser
  has been gone for 5 seconds (a page reload does not count), when Claude Code cancels the hook,
  and when the server stops.
- **Off:** prompts still appear in the town as read-only cards ("answer in your terminal"). They
  are marked resolved when the same session, agent and tool reports a result or a denial, or when
  the agent stops or the session ends.

At most 50 prompts wait at once; beyond that the oldest is handed back to the terminal.

## Command reference

| Command | What it does |
| --- | --- |
| `start` (default) | Runs the server in the foreground. `--port` (default 4747, `ANDARY_PORT`, `0` = any free port), `--host`, `--no-open`, `--remote-approvals`, `--approval-timeout <s>`, `--record`, `--detach` (run in the background and return). If a server is already running for this `ANDARY_HOME`, prints its link and exits. |
| `demo` | Like `start`, opening the simulation (`/?demo=1`). |
| `stop` | Stops the running server. |
| `install` / `uninstall` | `--scope user\|project\|local`, `--dir`, `--dry-run`, `--print`. |
| `status` | Server state, sign-in link and where hooks are registered. Exit code 1 when the server is not running. |
| `doctor` | Checks Node, `node` on the PATH, hook registration, the forwarder copy and the server, then sends a test event through the forwarder and waits for it on a WebSocket. |
| `replay <file.jsonl> [--speed N]` | Sends a recording to the running town, keeping its rhythm (long pauses are shortened to 5 s). |
| `simulate [--speed N] [--seed N]` | Runs the UI's simulation in Node and posts its events to the running town. |

## Troubleshooting

Run `andary doctor` first: it checks every link of the chain and prints the fix.

- **Nothing appears in the town.** Start a new Claude Code session after installing; running
  sessions keep the hooks they started with. `/hooks` inside Claude Code lists the hooks it sees.
  The hook command calls `node`, which must be on the PATH of the shell Claude Code uses.
- **The status pill says "Sign in".** The server restarted with a new token. Open the newest link
  (`andary status` prints it again).
- **"Port 4747 is already in use".** Another program has the port: use `--port <n>` or `--port 0`.
- **Every event shows up twice.** Hooks are registered by both the plugin and a settings file, or
  in two settings files: remove one (`andary uninstall --scope …`).
- **Prompts are not held for the town.** Remote approvals are off, or no browser is connected.
- **The forwarder never prints errors** by design. `claude --debug` shows how hooks ran; `doctor`
  shows whether events arrive.

## Platform notes

- **macOS** opens the browser with `open`; **Linux** with `xdg-open` (on a server without a
  desktop, use `--no-open` and open the link elsewhere through an SSH tunnel to 127.0.0.1);
  **Windows** with `cmd /c start`. A failing opener is ignored.
- **Windows.** Claude Code runs hook commands with Git Bash, or PowerShell when Git Bash is not
  installed; the registered command works in both (forward slashes, `#` starts a comment in each).
  File modes do not apply: `~/.andary` is protected by your user profile's permissions.
  `andary stop` ends the server abruptly on Windows, so a `server.json` may stay behind; the
  next start notices that nothing answers and replaces it.
- **WSL and containers.** Run Andary where Claude Code runs. Browsers on the host reach it
  through `localhost` forwarding; the Host check accepts `localhost:<port>`.

## Uninstall

```sh
andary uninstall                 # user scope; add --scope project|local [--dir …] for the others
/plugin uninstall andary@andary   # if you used the plugin
rm -rf ~/.andary                 # forwarder, records and recordings
```

`uninstall` removes only Andary's entries and the containers it created (a settings file it
created is deleted again if nothing else was added to it), and backs up the file first.
